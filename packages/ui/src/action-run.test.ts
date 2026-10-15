import { describe, expect, it, vi } from "vitest";
import { type Action, Runner, type RunnerDeps, withExpect } from "./action.js";
import { fakeWriteEnv } from "./save/test-kit.js";
import { Writes } from "./save/writes.js";

/** A server the test answers by hand: each call waits until `ok` or `fail`. */
function server() {
  const calls: {
    handler: string;
    input: Record<string, unknown>;
    ok: (v?: unknown) => void;
    fail: (e: Error) => void;
  }[] = [];
  const call = vi.fn(
    (handler: string, input: Record<string, unknown>) =>
      new Promise<unknown>((ok, fail) => calls.push({ handler, input, ok, fail })),
  );
  return { calls, call };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
function runner(over: Partial<RunnerDeps> = {}) {
  const s = server();
  const toast = { success: vi.fn(), error: vi.fn() };
  const after = vi.fn();
  const forget = vi.fn();
  const writes = new Writes(fakeWriteEnv());
  const r = new Runner({ call: s.call, after, many: "drafts", toast, forget, writes, ...over });
  return { r, s, toast, after, forget, writes };
}

const APPROVE: Action = {
  id: "approve",
  label: "Approve",
  handler: "drafts/approve",
  expect: true,
};
const EDIT: Action = {
  id: "edit",
  label: "Edit",
  handler: "drafts/edit",
  ask: { field: "body", label: "Body" },
};
const SEND: Action = {
  id: "send",
  label: "Send",
  handler: "drafts/send",
  optimistic: "Sending",
  ask: { field: "body", label: "Body" },
};
const ARCHIVE: Action = {
  id: "archive",
  label: "Archive",
  handler: "drafts/archive",
  undo: "drafts/unarchive",
};

describe("Runner: one action per press", () => {
  it("a second submit while the first is out sends nothing", async () => {
    const { r, s } = runner();
    expect(r.run(APPROVE, [1])).toBe("asked");
    void r.submit({ ids: [1] });
    void r.submit({ ids: [1] });
    expect(r.run(APPROVE, [1])).toBeNull();
    await settle();
    expect(s.calls).toHaveLength(1);
  });

  it("go twice on the same press calls once", async () => {
    const { r, s } = runner();
    void r.go(ARCHIVE, [4], { ids: [4] });
    void r.go(ARCHIVE, [4], { ids: [4] });
    await settle();
    expect(s.calls).toHaveLength(1);
  });

  it("an optimistic press is guarded too, and doesn't block another record", async () => {
    const { r, s, writes } = runner();
    void r.go(SEND, [1], { ids: [1] });
    void r.go(SEND, [1], { ids: [1] });
    void r.go(SEND, [2], { ids: [2] });
    await settle();
    expect(s.calls.map((c) => c.input.ids)).toEqual([[1], [2]]);
    expect([...writes.hiddenIn("drafts")]).toEqual(["1", "2"]);
  });
});

describe("Runner: a dialog closes once it worked", () => {
  it("stays open while the call runs, then closes and forgets the typing", async () => {
    const { r, s, forget } = runner();
    r.run(EDIT, [3], "old");
    const done = r.submit({ ids: [3], body: "new" });
    await settle();
    expect(r.snapshot().asked?.action.id).toBe("edit");
    expect(r.snapshot().running).toEqual({ action: "edit", ids: [3] });
    s.calls[0]?.ok({ done: [3] });
    expect(await done).toBe(true);
    expect(r.snapshot().asked).toBeNull();
    expect(r.snapshot().running).toBeNull();
    expect(forget).toHaveBeenCalledWith(EDIT, [3]);
  });

  it("stays open with the refusal's words, and keeps the typing", async () => {
    const { r, s, forget, toast } = runner();
    r.run(EDIT, [3], "old");
    const done = r.submit({ ids: [3], body: "new" });
    await settle();
    s.calls[0]?.fail(new Error("Someone changed this since you opened it."));
    expect(await done).toBe(false);
    expect(r.snapshot().asked?.error).toBe("Someone changed this since you opened it.");
    expect(forget).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("closed before the answer, a refusal shows as a toast", async () => {
    const { r, s, toast } = runner();
    r.run(EDIT, [3]);
    const done = r.submit({ ids: [3], body: "x" });
    r.close();
    await settle();
    s.calls[0]?.fail(new Error("no"));
    await done;
    expect(r.snapshot().asked).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("no");
  });

  it("an optimistic one leaves at once, and opens again with the words if it fails", async () => {
    const { r, s, writes } = runner();
    r.run(SEND, [5], "hi");
    const done = r.submit({ ids: [5], body: "hello" });
    expect(r.snapshot().asked).toBeNull();
    expect(writes.hiddenIn("drafts").has("5")).toBe(true);
    await settle();
    s.calls[0]?.fail(new Error("Mailbox full"));
    expect(await done).toBe(false);
    expect(writes.hiddenIn("drafts").has("5")).toBe(false);
    expect(r.snapshot().asked).toMatchObject({ ids: [5], error: "Mailbox full" });
  });
});

describe("expect: the version the person saw", () => {
  it("rides along on one record when the action asks for it", () => {
    const v = (id: string | number) => (id === 1 ? "2026-10-14T10:00:00.000Z" : null);
    expect(withExpect(APPROVE, [1], { ids: [1] }, v)).toEqual({
      ids: [1],
      expect: "2026-10-14T10:00:00.000Z",
    });
    expect(withExpect(APPROVE, [1, 2], { ids: [1, 2] }, v)).toEqual({ ids: [1, 2] });
    expect(withExpect(ARCHIVE, [1], { ids: [1] }, v)).toEqual({ ids: [1] });
    expect(withExpect(APPROVE, [1], { ids: [1], expect: "mine" }, v)).toMatchObject({
      expect: "mine",
    });
  });

  it("is what the Runner sends", async () => {
    const { r, s } = runner({ versionOf: () => "v7" });
    r.run(APPROVE, [9]);
    void r.submit({ ids: [9] });
    await settle();
    expect(s.calls[0]?.input).toMatchObject({ ids: [9], expect: "v7" });
  });
});

describe("Runner: a set-aside press", () => {
  it("a second press while it waits out its undo is the same one", () => {
    const { r, toast } = runner({ many: "notes-held" });
    const DELETE: Action = { id: "delete", label: "Delete", handler: "notes/delete" };
    expect(r.run(DELETE, [1])).toBe("held");
    expect(r.run(DELETE, [1])).toBeNull();
    expect(toast.success).toHaveBeenCalledOnce();
  });

  it("leaves at once, goes when its deadline passes on a return, and lands once", async () => {
    const { r, s, writes, after } = runner({ many: "notes-held" });
    const DROP: Action = { id: "drop", label: "Drop", handler: "notes/drop" };
    expect(r.run(DROP, [2])).toBe("held");
    expect(writes.hiddenIn("notes-held").has("2")).toBe(true);
    expect(s.calls).toHaveLength(0);
    // The page goes inside the window: it goes now.
    writes.gone();
    await settle();
    expect(s.calls).toHaveLength(1);
    expect(typeof s.calls[0]?.input.requestId).toBe("string");
    s.calls[0]?.ok();
    await settle();
    expect(after).toHaveBeenCalledWith([2]);
  });
});
