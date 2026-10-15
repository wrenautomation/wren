import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { patchedSince, writeThrough } from "./cache.js";
import { tick } from "./clock.js";
import { forgetSaves, type SaveContext, Saver, type SaverOptions } from "./engine.js";
import { TAB } from "./journal.js";
import { fakeEnv, fakeLocks, handServer, memoryStore, refusal } from "./test-kit.js";

const trimmed = (a: string, b: string) => a.trim() === b.trim();
/** Let promises and due timers run. */
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

function draft(o: Partial<SaverOptions<string>> & { env?: ReturnType<typeof fakeEnv> } = {}) {
  const kit = o.env ?? fakeEnv();
  const srv = handServer<string, SaveContext<string>>();
  const saver = new Saver<string>({
    key,
    server: "v0",
    same: trimmed,
    save: srv.save,
    ...o,
    env: kit.env,
  });
  saver.open();
  return { saver, srv, ...kit };
}
const view = (s: Saver<string>) => s.snapshot();

/** A key per test: a save a test leaves unanswered holds its key's lock. */
let key = "";
let n = 0;
beforeEach(() => {
  n += 1;
  key = `draft:${n}`;
  vi.useFakeTimers();
  forgetSaves();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the save engine", () => {
  it("keeps typing made while a save is out, and saves it next over the new base", async () => {
    const { saver, srv } = draft();
    saver.set("v1");
    await settle(1200);
    expect(srv.calls.map((c) => c.value)).toEqual(["v1"]);
    expect(view(saver).status).toBe("saving");
    saver.set("v1 and more");
    srv.calls[0]?.ok({ value: "v1" });
    await settle();
    // The answer ("v1") is never written into the box.
    expect(view(saver).value).toBe("v1 and more");
    expect(view(saver).status).toBe("edited");
    await settle(1200);
    expect(srv.calls[1]?.value).toBe("v1 and more");
    expect(srv.calls[1]?.ctx.expect).toBe("v1");
  });

  it("coalesces saves queued behind one in flight to the newest", async () => {
    const { saver, srv } = draft();
    saver.set("a");
    const first = saver.flush();
    await settle();
    saver.set("ab");
    const second = saver.flush();
    saver.set("abc");
    const third = saver.flush();
    srv.calls[0]?.ok();
    await settle();
    expect(srv.calls.map((c) => c.value)).toEqual(["a", "abc"]);
    expect(srv.calls[1]?.ctx.expect).toBe("a");
    srv.calls[1]?.ok();
    await settle();
    expect(await Promise.all([first, second, third])).toEqual([true, true, true]);
    expect(srv.calls).toHaveLength(2);
    expect(view(saver).status).toBe("saved");
  });

  it("ignores a read that left before the save answered", async () => {
    const { saver, srv } = draft();
    saver.set("v1");
    void saver.flush();
    await settle();
    const left = tick();
    srv.calls[0]?.ok();
    await settle();
    saver.read("v0", { at: left });
    expect(view(saver)).toMatchObject({ value: "v1", status: "saved", dirty: false });
    // A read that left after it does count: Claude rewrote the draft.
    saver.read("Claude's words", { at: tick() });
    expect(view(saver)).toMatchObject({ value: "Claude's words", dirty: false });
  });

  it("ignores reads that land while a save is out, and its own echo without a tick", async () => {
    const { saver, srv } = draft();
    saver.set("v1");
    void saver.flush();
    await settle();
    saver.read("v1");
    saver.read("v0");
    srv.calls[0]?.ok();
    await settle();
    saver.read("v0");
    expect(view(saver).value).toBe("v1");
  });

  // William, 2026-10-14: edit 1 saved but showed late; edit 2 got scrambled (the saved text
  // written over his typing, then a stale read reverting it); he re-saved edit 1 to lock it in.
  it("William's repro: edit 1 shows saved at once; edit 2 is never scrambled by its echo or a stale read", async () => {
    const scope = {};
    const cacheKey = "drafts:1:0";
    const cached = new Map<string, unknown>([[cacheKey, { text: "v0" }]]);
    const { saver, srv } = draft({
      onSaved: (text) => writeThrough(scope, (_k, d) => ({ ...(d as object), text }), Date.now()),
    });
    // Edit 1, then a read of the record leaves before the save answers.
    saver.set("Edit one.");
    await settle(1200);
    const stale = tick();
    srv.calls[0]?.ok({ value: "Edit one." });
    await settle();
    // Saved the moment the server answered: no re-read needed.
    expect(view(saver).status).toBe("saved");
    // Edit 2 starts; the stale read lands with what was there before edit 1.
    saver.set("Edit one. Edit two ");
    cached.set(cacheKey, patchedSince(scope, cacheKey, { text: "v0" }, stale));
    saver.read("v0", { at: stale });
    expect(view(saver).value).toBe("Edit one. Edit two ");
    expect(cached.get(cacheKey)).toEqual({ text: "Edit one." });
    // Edit 2 saves over edit 1, not over the stale read; edit 1 is never sent again.
    await settle(1200);
    expect(srv.calls.map((c) => c.value)).toEqual(["Edit one.", "Edit one. Edit two "]);
    expect(srv.calls[1]?.ctx.expect).toBe("Edit one.");
    srv.calls[1]?.ok({ value: "Edit one. Edit two" });
    await settle();
    // The trailing space he typed stays in the box.
    expect(view(saver)).toMatchObject({ value: "Edit one. Edit two ", status: "saved" });
  });

  it("puts back typing a reload left over the same base, and saves it", async () => {
    const storage = memoryStore();
    const before = draft({ env: fakeEnv({ storage }) });
    before.saver.set("typed, then the tab died");
    vi.clearAllTimers();
    expect(before.srv.calls).toHaveLength(0);
    // A new page load: the journal entry is all that's left.
    const after = draft({ env: fakeEnv({ storage }) });
    expect(view(after.saver)).toMatchObject({
      value: "typed, then the tab died",
      restored: true,
      dirty: true,
    });
    await settle();
    expect(after.srv.calls.map((c) => c.value)).toEqual(["typed, then the tab died"]);
    expect(after.srv.calls[0]?.ctx.expect).toBe("v0");
    after.srv.calls[0]?.ok();
    await settle();
    expect(storage.map.size).toBe(0);
  });

  it("opens a conflict when the base moved under a restored journal", async () => {
    const storage = memoryStore();
    draft({ env: fakeEnv({ storage }) }).saver.set("mine");
    // That tab dies before its pause ends.
    vi.clearAllTimers();
    const after = draft({ env: fakeEnv({ storage }), server: "Claude rewrote it" });
    expect(view(after.saver)).toMatchObject({
      value: "mine",
      status: "conflict",
      conflict: { mine: "mine", theirs: "Claude rewrote it" },
    });
    await settle(5000);
    expect(after.srv.calls).toHaveLength(0);
    // Keep mine writes over theirs.
    void after.saver.keepMine();
    await settle();
    expect(after.srv.calls[0]?.value).toBe("mine");
    expect(after.srv.calls[0]?.ctx.expect).toBe("Claude rewrote it");
  });

  it("drops a restored journal the server already holds", () => {
    const storage = memoryStore();
    draft({ env: fakeEnv({ storage }) }).saver.set("saved elsewhere");
    vi.clearAllTimers();
    const after = draft({ env: fakeEnv({ storage }), server: "saved elsewhere" });
    expect(view(after.saver)).toMatchObject({ restored: false, dirty: false });
    expect(storage.map.size).toBe(0);
  });

  it("retries offline and 5xx with backoff and on online, with one request id, then saves", async () => {
    const { saver, srv, page } = draft();
    saver.set("v1");
    void saver.flush();
    await settle();
    srv.calls[0]?.fail(refusal("You're offline, or the portal is.", 0));
    await settle();
    expect(view(saver)).toMatchObject({ status: "waiting", value: "v1" });
    await settle(1000);
    expect(srv.calls).toHaveLength(2);
    srv.calls[1]?.fail(refusal("Something went wrong (503).", 503));
    await settle();
    expect(view(saver).status).toBe("waiting");
    // Back online: it goes now, not after the 2 s wait.
    page.fire("online");
    await settle();
    expect(srv.calls).toHaveLength(3);
    srv.calls[2]?.ok();
    await settle();
    expect(view(saver).status).toBe("saved");
    const ids = new Set(srv.calls.map((c) => c.ctx.request));
    expect(ids.size).toBe(1);
  });

  it("retries a save that never answers", async () => {
    const { saver, srv } = draft({ timeout: 5000 });
    saver.set("v1");
    void saver.flush();
    await settle(5000);
    expect(view(saver).status).toBe("waiting");
    await settle(1000);
    expect(srv.calls).toHaveLength(2);
    expect(srv.calls[1]?.ctx.request).toBe(srv.calls[0]?.ctx.request);
  });

  it("turns a refusal for a moved base into a conflict, then Use theirs", async () => {
    const onConflict = vi.fn();
    const { saver, srv, env } = draft({ onConflict });
    saver.set("mine");
    const ok = saver.flush();
    await settle();
    srv.calls[0]?.fail(refusal("the draft changed since; nothing written", 409));
    await settle();
    expect(await ok).toBe(false);
    expect(view(saver)).toMatchObject({
      status: "conflict",
      value: "mine",
      conflict: { mine: "mine", theirs: null },
    });
    expect(onConflict).toHaveBeenCalledOnce();
    saver.read("theirs", { at: tick() });
    expect(view(saver).conflict).toEqual({ mine: "mine", theirs: "theirs" });
    // No autosave while it waits for him.
    saver.set("mine, still typing");
    await settle(5000);
    expect(srv.calls).toHaveLength(1);
    saver.takeTheirs();
    expect(view(saver)).toMatchObject({ value: "theirs", status: "clean", conflict: null });
    expect(env.storage && (env.storage as ReturnType<typeof memoryStore>).map.size).toBe(0);
  });

  it("settles a conflict on its own when theirs is what he typed", async () => {
    const { saver, srv } = draft();
    saver.set("same words");
    void saver.flush();
    await settle();
    srv.calls[0]?.fail(refusal("changed since", 409, "conflict"));
    await settle();
    saver.read("same words", { at: tick() });
    expect(view(saver)).toMatchObject({ status: "saved", conflict: null, dirty: false });
  });

  it("shows a refusal and waits for his change", async () => {
    const { saver, srv } = draft();
    saver.set("x".repeat(300));
    void saver.flush();
    await settle();
    srv.calls[0]?.fail(refusal("300 characters, over 280 for a post", 409));
    await settle();
    expect(view(saver)).toMatchObject({
      status: "failed",
      error: "300 characters, over 280 for a post",
    });
    await settle(10_000);
    expect(srv.calls).toHaveLength(1);
    saver.set("shorter");
    await settle(1200);
    expect(srv.calls[1]?.value).toBe("shorter");
  });

  it("saves at once on pagehide and when the tab hides", async () => {
    const { saver, srv, page } = draft();
    saver.set("closing the tab");
    page.fire("pagehide");
    await settle();
    expect(srv.calls.map((c) => c.value)).toEqual(["closing the tab"]);
    srv.calls[0]?.ok();
    await settle();
    saver.set("switching tabs");
    page.fire("hidden");
    await settle();
    expect(srv.calls[1]?.value).toBe("switching tabs");
  });

  it("saves what's typed when it closes (the record is left)", async () => {
    const { saver, srv, page } = draft();
    saver.set("left the record");
    saver.close();
    await settle();
    expect(srv.calls.map((c) => c.value)).toEqual(["left the record"]);
    expect(page.listening).toBe(0);
  });

  it("runs one save per key at a time across tabs", async () => {
    const locks = fakeLocks();
    const storage = memoryStore();
    const a = draft({ env: fakeEnv({ storage, locks }) });
    const b = draft({ env: fakeEnv({ storage, locks }) });
    a.saver.set("from tab a");
    b.saver.set("from tab b");
    void a.saver.flush();
    void b.saver.flush();
    await settle();
    expect(a.srv.calls).toHaveLength(1);
    expect(b.srv.calls).toHaveLength(0);
    a.srv.calls[0]?.ok();
    await settle();
    expect(b.srv.calls).toHaveLength(1);
    expect(locks.most).toBe(1);
  });

  it("never clears words another tab is still typing", async () => {
    const storage = memoryStore();
    const a = draft({ env: fakeEnv({ storage }) });
    a.saver.set("tab a");
    storage.setItem(
      `wren.unsaved:${key}`,
      JSON.stringify({ base: "v0", version: null, value: "tab b", at: Date.now(), tab: "other" }),
    );
    void a.saver.flush();
    await settle();
    a.srv.calls[0]?.ok();
    await settle();
    expect(JSON.parse(storage.getItem(`wren.unsaved:${key}`) ?? "{}").value).toBe("tab b");
    expect(TAB).not.toBe("other");
  });

  it("sends the version as expect, and a moved version alone is no conflict", async () => {
    const kit = fakeEnv();
    const srv = handServer<string, SaveContext<string>>();
    const saver = new Saver<string>({
      key: "edit:deal:1:name",
      server: "Acme",
      version: "v-1",
      save: srv.save,
      delay: null,
      env: kit.env,
    });
    saver.open();
    saver.set("Acme Co");
    // Another field saved: the version moved, this value didn't.
    saver.read("Acme", { version: "v-2", at: tick() });
    expect(view(saver).status).toBe("edited");
    // No autosave with delay null.
    await settle(5000);
    expect(srv.calls).toHaveLength(0);
    void saver.flush();
    await settle();
    expect(srv.calls[0]?.ctx.expect).toBe("v-2");
    srv.calls[0]?.ok({ version: "v-3" });
    await settle();
    saver.set("Acme Corp");
    void saver.flush();
    await settle();
    expect(srv.calls[1]?.ctx.expect).toBe("v-3");
  });

  it("opens a conflict when someone else's change lands while he types", () => {
    const { saver } = draft();
    saver.set("mine");
    saver.read("someone else's", { at: tick() });
    expect(view(saver)).toMatchObject({
      status: "conflict",
      conflict: { mine: "mine", theirs: "someone else's" },
      value: "mine",
    });
  });

  it("a box opened again over a cached read older than its save shows the save", async () => {
    const before = tick();
    const { saver, srv } = draft();
    saver.set("saved words");
    void saver.flush();
    await settle();
    srv.calls[0]?.ok();
    await settle();
    saver.close();
    const again = draft({ server: "v0", at: before });
    expect(view(again.saver).value).toBe("saved words");
  });
});
