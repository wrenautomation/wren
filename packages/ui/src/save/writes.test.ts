/**
 * The one write path (designs/2026-10-15-one-write-path.md): a press survives a hidden tab, a
 * reload and a lost answer, runs once, and the page ends matching the server.
 */
import { describe, expect, it } from "vitest";
import { memoryStore, refusal } from "./test-kit.js";
import { recordKey, type WireState, type WriteEnv, type WritePageEvent, Writes } from "./writes.js";

/** One browser tab: its clock, its visibility, its session storage, its reminders. */
function tab(storage = memoryStore()) {
  let now = 1_000_000;
  let shown = true;
  let n = 0;
  const fns = new Set<(e: WritePageEvent) => void>();
  const reminders: { at: number; fn: () => void }[] = [];
  const env: WriteEnv = {
    storage,
    now: () => now,
    id: () => {
      n += 1;
      return `req-000${n}`;
    },
    visible: () => shown,
    listen: (fn) => {
      fns.add(fn);
      return () => void fns.delete(fn);
    },
    remind: (ms, fn) => void reminders.push({ at: now + ms, fn }),
  };
  const fire = (e: WritePageEvent) => {
    for (const f of [...fns]) f(e);
  };
  return {
    env,
    storage,
    /** How many reminders wait to run. */
    waiting: () => reminders.length,
    /** Time passes; reminders whose time came run (a hidden tab's may not: `fire` false). */
    pass(ms: number, fire = true) {
      now += ms;
      if (!fire) return;
      for (const r of reminders.splice(0)) if (r.at <= now) r.fn();
    },
    hide() {
      shown = false;
      fire("hidden");
    },
    show() {
      shown = true;
      fire("back");
    },
    leave() {
      shown = false;
      fire("hidden");
      fire("gone");
    },
  };
}

/** A server that holds each call until the test answers it, and runs each request id once. */
function server() {
  const calls: {
    path: string;
    body: Record<string, unknown>;
    ok: (v?: unknown) => void;
    fail: (e: unknown) => void;
  }[] = [];
  const ran = new Map<string, unknown>();
  const send = (path: string, body: Record<string, unknown>) =>
    new Promise<unknown>((ok, fail) => {
      calls.push({
        path,
        body,
        ok: (v) => {
          const id = String(body.requestId);
          if (!ran.has(id)) ran.set(id, v ?? { done: true });
          ok(ran.get(id));
        },
        fail,
      });
    });
  const status = async (_path: string, id: string): Promise<WireState> =>
    ran.has(id) ? { state: "sent", answer: ran.get(id) } : { state: "unknown" };
  return { calls, ran, send, status };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function store(t: ReturnType<typeof tab>, s: ReturnType<typeof server>) {
  const told: string[] = [];
  let reads = 0;
  const w = new Writes(t.env);
  w.use({
    send: s.send,
    status: s.status,
    reread: async () => {
      reads += 1;
    },
    tell: (x) => told.push(`${x.label ?? x.key}:${x.status}${x.error ? `:${x.error}` : ""}`),
  });
  w.start();
  return { w, told, reads: () => reads };
}

const press = (w: Writes, s: ReturnType<typeof server>, text: string, label = "Reply") =>
  w.press(
    {
      key: `inbox/reply:t1:${text}`,
      what: "inbox.reply",
      label,
      records: [recordKey("threads", "t1")],
      input: { body: text },
    },
    (requestId) =>
      w.call("console/call", { body: text, requestId }, (b) => s.send("console/call", b)),
  );

describe("a press", () => {
  it("sends one request id, and a second press while it's out is the same call", async () => {
    const t = tab();
    const s = server();
    const { w } = store(t, s);
    const a = press(w, s, "hello");
    const b = press(w, s, "hello");
    await flush();
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]?.body.requestId).toBe("req-0001");
    s.calls[0]?.ok({ sent: true });
    expect(await a).toEqual({ sent: true });
    expect(await b).toEqual({ sent: true });
    expect(w.lastOn(recordKey("threads", "t1"))?.status).toBe("sent");
  });

  it("hidden mid-call: the outcome is said when the tab shows, and the page reads again", async () => {
    const t = tab();
    const s = server();
    const { w, told, reads } = store(t, s);
    await flush();
    const before = reads();
    const p = press(w, s, "hello");
    await flush();
    t.hide();
    s.calls[0]?.ok({ sent: true });
    await p;
    // Nothing said into a hidden tab.
    expect(told).toEqual([]);
    t.show();
    await flush();
    expect(told).toEqual(["Reply:sent"]);
    expect(reads()).toBeGreaterThan(before);
    expect(w.lastOn(recordKey("threads", "t1"))?.status).toBe("sent");
  });

  it("refused while hidden: the reason is said on return, the words kept to give back", async () => {
    const t = tab();
    const s = server();
    const { w, told } = store(t, s);
    const p = press(w, s, "hello").catch((e: unknown) => e);
    await flush();
    t.hide();
    s.calls[0]?.fail(refusal("LinkedIn refused it: invalid input.", 400));
    await p;
    const last = w.lastOn(recordKey("threads", "t1"));
    expect(last?.status).toBe("failed");
    expect(last?.input).toEqual({ body: "hello" });
    t.show();
    await flush();
    expect(told).toEqual(["Reply:failed:LinkedIn refused it: invalid input."]);
  });

  it("refused while it shows: whoever pressed says it, `tell` doesn't say it twice", async () => {
    const t = tab();
    const s = server();
    const { w, told } = store(t, s);
    const p = press(w, s, "hello").catch((e: unknown) => e);
    await flush();
    s.calls[0]?.fail(refusal("No.", 400));
    await p;
    t.hide();
    t.show();
    await flush();
    expect(told).toEqual([]);
  });

  it("a lost answer keeps the id: pressed again, the server runs it once", async () => {
    const t = tab();
    const s = server();
    const { w } = store(t, s);
    const p = press(w, s, "hello").catch((e: unknown) => e);
    await flush();
    // It ran, but the answer never came back (a 502 from the edge).
    s.ran.set("req-0001", { sent: true });
    s.calls[0]?.fail(refusal("Bad gateway", 502));
    await p;
    expect(w.lastOn(recordKey("threads", "t1"))?.status).toBe("unsure");
    const again = press(w, s, "hello");
    await flush();
    expect(s.calls[1]?.body.requestId).toBe("req-0001");
    s.calls[1]?.ok();
    expect(await again).toEqual({ sent: true });
  });

  it("answers out of order land on their own presses", async () => {
    const t = tab();
    const s = server();
    const { w } = store(t, s);
    const a = press(w, s, "one");
    const b = press(w, s, "two");
    await flush();
    s.calls[1]?.ok({ n: 2 });
    s.calls[0]?.ok({ n: 1 });
    expect(await a).toEqual({ n: 1 });
    expect(await b).toEqual({ n: 2 });
    const keys = w.snapshot().map((x) => `${x.key}=${x.status}`);
    expect(keys).toEqual(["inbox/reply:t1:one=sent", "inbox/reply:t1:two=sent"]);
  });
});

describe("a reload mid-call", () => {
  it("sends the call again under its id, and says how it went", async () => {
    const shared = memoryStore();
    const t1 = tab(shared);
    const s = server();
    const first = store(t1, s);
    void press(first.w, s, "hello").catch(() => undefined);
    await flush();
    expect(s.calls).toHaveLength(1);
    // The page reloads before the answer: the old call's answer is lost with it.
    t1.leave();
    first.w.stop();
    const t2 = tab(shared);
    const second = store(t2, s);
    await flush();
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1]?.body).toEqual({ body: "hello", requestId: "req-0001" });
    s.calls[0]?.ok({ sent: true });
    s.calls[1]?.ok();
    await flush();
    expect(s.ran.size).toBe(1);
    expect(second.w.lastOn(recordKey("threads", "t1"))?.status).toBe("sent");
    expect(second.told).toEqual(["Reply:sent"]);
  });

  it("a call too large to keep says so instead of guessing", async () => {
    const shared = memoryStore();
    const t1 = tab(shared);
    const s = server();
    const first = store(t1, s);
    const big = "x".repeat(60_000);
    void press(first.w, s, big).catch(() => undefined);
    await flush();
    first.w.stop();
    const second = store(tab(shared), s);
    await flush();
    const last = second.w.snapshot()[0];
    expect(last?.status).toBe("failed");
    expect(second.told[0]).toMatch(/reloaded before it was sent/);
  });
});

describe("a call with no press (a hand-drawn page's write)", () => {
  it("gets a request id, and the same call while it's out is one", async () => {
    const t = tab();
    const s = server();
    const { w } = store(t, s);
    const send = (b: Record<string, unknown>) => s.send("people/tag", b);
    const a = w.call("people/tag", { id: 4, tag: "vip" }, send);
    const b = w.call("people/tag", { tag: "vip", id: 4 }, send);
    await flush();
    expect(s.calls).toHaveLength(1);
    expect(typeof s.calls[0]?.body.requestId).toBe("string");
    s.calls[0]?.ok();
    await Promise.all([a, b]);
  });

  it("offline: it goes again on return under the same id", async () => {
    const t = tab();
    const s = server();
    const { w, told } = store(t, s);
    const send = (b: Record<string, unknown>) => s.send("people/tag", b);
    const a = w.call("people/tag", { id: 4 }, send).catch((e: unknown) => e);
    await flush();
    s.calls[0]?.fail(refusal("You're offline.", 0));
    await a;
    t.hide();
    t.show();
    await flush();
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1]?.body.requestId).toBe(s.calls[0]?.body.requestId);
    s.calls[1]?.ok();
    await flush();
    expect(w.snapshot()[0]?.status).toBe("sent");
    // It failed once in his sight: landing later is said.
    expect(told).toEqual(['people/tag {"id":4}:sent']);
  });

  it("a long call asks the server on return; one it never got goes again", async () => {
    const t = tab();
    const s = server();
    const { w } = store(t, s);
    void w.call("people/tag", { id: 5 }, (b) => s.send("people/tag", b)).catch(() => undefined);
    await flush();
    t.hide();
    t.pass(20_000, false);
    t.show();
    await flush();
    // The server says it never got it (unknown): sent again under its id.
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1]?.body.requestId).toBe(s.calls[0]?.body.requestId);
  });
});

describe("a held press (undo)", () => {
  const hold = (w: Writes, s: ReturnType<typeof server>, id: string) =>
    w.hold(
      { key: `drop:${id}`, label: "Drop", records: [recordKey("comments", id)], ms: 10_000 },
      (requestId) =>
        w.call("console/call", { ids: [id], requestId }, (b) => s.send("console/call", b)),
    );

  it("leaves the list at once, comes back on undo, and nothing is sent", async () => {
    const t = tab();
    const s = server();
    const { w } = store(t, s);
    const h = hold(w, s, "c1");
    expect([...w.hiddenIn("comments")]).toEqual(["c1"]);
    expect(h?.undo()).toBe(true);
    expect([...w.hiddenIn("comments")]).toEqual([]);
    t.pass(20_000);
    await flush();
    expect(s.calls).toHaveLength(0);
  });

  it("deadline passed while hidden (timers throttled): it goes on return, undo is too late", async () => {
    const t = tab();
    const s = server();
    const { w, told } = store(t, s);
    const h = hold(w, s, "c1");
    t.hide();
    t.pass(15_000, false);
    expect(s.calls).toHaveLength(0);
    // Undo now: the deadline is the clock's, not a timer's.
    expect(h?.undo()).toBe(false);
    t.show();
    await flush();
    expect(s.calls).toHaveLength(1);
    expect([...w.hiddenIn("comments")]).toEqual(["c1"]);
    s.calls[0]?.ok();
    await flush();
    expect(w.lastOn(recordKey("comments", "c1"))?.status).toBe("sent");
    // Off the list until the page reads it again, then the overlay is done.
    expect([...w.hiddenIn("comments")]).toEqual([]);
    expect(told).toEqual([]);
  });

  it("the page goes inside the window: it goes now (keepalive), and the next load knows", async () => {
    const shared = memoryStore();
    const t = tab(shared);
    const s = server();
    const { w } = store(t, s);
    hold(w, s, "c2");
    t.leave();
    await flush();
    expect(s.calls).toHaveLength(1);
    w.stop();
    // The next load sends it again under its id; the server runs it once.
    const next = store(tab(shared), s);
    await flush();
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1]?.body.requestId).toBe(s.calls[0]?.body.requestId);
    s.calls[0]?.ok();
    s.calls[1]?.ok();
    await flush();
    expect(s.ran.size).toBe(1);
    expect(next.w.lastOn(recordKey("comments", "c2"))?.status).toBe("sent");
  });

  it("refused: back on the list, the reason said", async () => {
    const t = tab();
    const s = server();
    const { w, told } = store(t, s);
    hold(w, s, "c3");
    t.pass(10_000);
    await flush();
    s.calls[0]?.fail(refusal("That comment is gone.", 404));
    await flush();
    expect([...w.hiddenIn("comments")]).toEqual([]);
    expect(told).toEqual(["Drop:failed:That comment is gone."]);
  });

  it("a second press of the same key while held is none", () => {
    const t = tab();
    const s = server();
    const { w } = store(t, s);
    expect(hold(w, s, "c4")).not.toBeNull();
    expect(hold(w, s, "c4")).toBeNull();
  });
});

/** A send server: it takes each call at once and runs each request id once, in its own time. */
function sendServer() {
  const runs = new Map<
    string,
    { state: "sending" | "sent" | "failed"; answer?: unknown; error?: string }
  >();
  const posts: Record<string, unknown>[] = [];
  const send = async (_path: string, body: Record<string, unknown>) => {
    posts.push(body);
    const id = String(body.requestId);
    if (!runs.has(id)) runs.set(id, { state: "sending" });
    return { accepted: true, state: "queued", requestId: id };
  };
  const status = async (_path: string, id: string): Promise<WireState> => {
    const r = runs.get(id);
    if (!r) return { state: "unknown" };
    if (r.state === "sent") return { state: "sent", answer: r.answer };
    if (r.state === "failed") return { state: "failed", error: r.error ?? "" };
    return { state: "sending" };
  };
  const finish = (id: string, out: { answer?: unknown; error?: string }) =>
    runs.set(
      id,
      out.error ? { state: "failed", error: out.error } : { state: "sent", answer: out.answer },
    );
  return { runs, posts, send, status, finish };
}

function sendStore(t: ReturnType<typeof tab>, s: ReturnType<typeof sendServer>) {
  const told: string[] = [];
  let reads = 0;
  const w = new Writes(t.env);
  w.use({
    send: s.send,
    status: s.status,
    reread: async () => {
      reads += 1;
    },
    tell: (x) => told.push(`${x.label ?? x.key}:${x.status}${x.error ? `:${x.error}` : ""}`),
  });
  w.start();
  const go = (text: string) =>
    w.press(
      {
        key: `reply:t1:${text}`,
        what: "inbox.reply",
        label: "Reply",
        records: [recordKey("threads", "t1")],
        input: { body: text },
      },
      (requestId) =>
        w.call("marketing/inboxReply", { body: text, requestId }, (b) =>
          s.send("marketing/inboxReply", b),
        ),
    );
  return { w, told, go, reads: () => reads };
}

describe("a send (accept, then track)", () => {
  it("the server takes it at once; its outcome comes from the server's record", async () => {
    const t = tab();
    const s = sendServer();
    const { w, go } = sendStore(t, s);
    let answer: unknown = null;
    const p = go("hello").then((a) => {
      answer = a;
    });
    await flush();
    expect(s.posts).toHaveLength(1);
    const last = w.lastOn(recordKey("threads", "t1"));
    expect(last?.status).toBe("sending");
    expect(last?.accepted).toBe(true);
    // Still going: asking says so, and nothing is decided.
    t.pass(400);
    await flush();
    expect(answer).toBeNull();
    s.finish("req-0001", { answer: { sent: true } });
    t.pass(800);
    await p;
    expect(answer).toEqual({ sent: true });
    expect(w.lastOn(recordKey("threads", "t1"))?.status).toBe("sent");
  });

  it("a page that went and came back finds its press still at work, until it lands", async () => {
    const t = tab();
    const s = sendServer();
    const { w, go } = sendStore(t, s);
    const p = go("hello");
    await flush();
    // A new page of the same list (its own button state is gone) asks the store.
    expect(w.goingIn("threads")).toEqual({ what: "inbox.reply", ids: ["t1"] });
    expect(w.goingIn("posts")).toBeNull();
    s.finish("req-0001", { answer: { sent: true } });
    t.pass(800);
    await p;
    expect(w.goingIn("threads")).toBeNull();
  });

  it("a send with no words that lands with nobody waiting is still said", async () => {
    const shared = memoryStore();
    const before = tab(shared);
    const s = sendServer();
    const first = new Writes(before.env);
    first.use({ send: s.send, status: s.status, reread: async () => undefined });
    first.start();
    void first
      .press(
        {
          key: "again:9",
          what: "marketing.sendAgain",
          label: "Send again",
          records: [recordKey("sends", 9)],
        },
        (requestId) =>
          first.call("marketing/sendAgain", { requestId }, (b) => s.send("marketing/sendAgain", b)),
      )
      .catch(() => undefined);
    await flush();
    before.leave();
    first.stop();
    const after = tab(shared);
    const second = sendStore(after, s);
    await flush();
    s.finish("req-0001", { answer: { sent: true } });
    after.pass(400);
    await flush();
    await flush();
    expect(second.told).toEqual(["Send again:sent"]);
  });

  it("hidden mid-send, refused while hidden: the reason is said on return", async () => {
    const t = tab();
    const s = sendServer();
    const { w, told, go } = sendStore(t, s);
    const p = go("hello").catch((e: unknown) => e);
    await flush();
    t.hide();
    s.finish("req-0001", { error: "LinkedIn refused it: invalid input." });
    // A hidden tab's timers may not run at all.
    t.pass(60_000, false);
    await flush();
    expect(told).toEqual([]);
    t.show();
    await flush();
    await flush();
    expect(((await p) as Error).message).toBe("LinkedIn refused it: invalid input.");
    const last = w.lastOn(recordKey("threads", "t1"));
    expect(last?.status).toBe("failed");
    expect(last?.input).toEqual({ body: "hello" });
    expect(told).toEqual(["Reply:failed:LinkedIn refused it: invalid input."]);
  });

  it("a reload mid-send: given again under its id, run once, and its outcome lands", async () => {
    const shared = memoryStore();
    const t1 = tab(shared);
    const s = sendServer();
    const first = sendStore(t1, s);
    void first.go("hello").catch(() => undefined);
    await flush();
    t1.leave();
    first.w.stop();
    const t2 = tab(shared);
    const second = sendStore(t2, s);
    await flush();
    expect(s.posts.map((b) => b.requestId)).toEqual(["req-0001", "req-0001"]);
    expect(s.runs.size).toBe(1);
    s.finish("req-0001", { answer: { sent: true } });
    t2.pass(400);
    await flush();
    await flush();
    expect(second.w.lastOn(recordKey("threads", "t1"))?.status).toBe("sent");
    expect(second.told).toEqual(["Reply:sent"]);
  });
});

describe("pushed outcomes and retries", () => {
  it("an outcome pushed over the socket settles the send without asking", async () => {
    const t = tab();
    const s = sendServer();
    let asked = 0;
    const { w, go } = sendStore(t, s);
    w.use({
      status: async (p, id) => {
        asked += 1;
        return s.status(p, id);
      },
    });
    w.pushed(true);
    const p = go("hello");
    await flush();
    w.heard("req-0001", { state: "sent", answer: { sent: true } });
    expect(await p).toEqual({ sent: true });
    expect(w.lastOn(recordKey("threads", "t1"))?.status).toBe("sent");
    expect(asked).toBe(0);
  });

  it("while the server retries, the box has the reason; it clears when it lands", async () => {
    const t = tab();
    const s = sendServer();
    const { w, go } = sendStore(t, s);
    const p = go("hello");
    await flush();
    w.heard("req-0001", {
      state: "sending",
      retry: { count: 2, reason: "LinkedIn answered 503." },
    });
    expect(w.lastOn(recordKey("threads", "t1"))?.retry).toEqual({
      count: 2,
      reason: "LinkedIn answered 503.",
    });
    s.finish("req-0001", { answer: { sent: true } });
    t.pass(400);
    await p;
    const last = w.lastOn(recordKey("threads", "t1"));
    expect(last?.status).toBe("sent");
    expect(last?.retry).toBeNull();
  });

  it("the socket closing asks about every open send at once", async () => {
    const t = tab();
    const s = sendServer();
    const { w, go } = sendStore(t, s);
    w.pushed(true);
    const p = go("hello");
    await flush();
    s.finish("req-0001", { answer: { sent: true } });
    w.pushed(false);
    await flush();
    expect(await p).toEqual({ sent: true });
  });

  it("a landed write is handed to the data layer with its records", async () => {
    const t = tab();
    const s = sendServer();
    const { w, go } = sendStore(t, s);
    const landed: string[][] = [];
    w.use({ landed: (r) => landed.push(r) });
    const p = go("hello");
    await flush();
    w.heard("req-0001", { state: "sent", answer: {} });
    await p;
    expect(landed).toEqual([[recordKey("threads", "t1")]]);
  });
});

describe("a send that takes long", () => {
  it("keeps one reminder, however many returns ask about it", async () => {
    const t = tab();
    const s = sendServer();
    const { w, go } = sendStore(t, s);
    void go("hello").catch(() => undefined);
    await flush();
    const one = t.waiting();
    expect(one).toBe(1);
    for (let i = 0; i < 4; i++) {
      t.hide();
      t.show();
      await flush();
      await flush();
    }
    expect(t.waiting()).toBe(one);
    expect(w.lastOn(recordKey("threads", "t1"))?.status).toBe("sending");
  });

  it("after a reload, a return is not held up until the send lands", async () => {
    const shared = memoryStore();
    const t1 = tab(shared);
    const s = sendServer();
    const first = sendStore(t1, s);
    void first.go("hello").catch(() => undefined);
    await flush();
    t1.leave();
    first.w.stop();
    const t2 = tab(shared);
    const second = sendStore(t2, s);
    await flush();
    await flush();
    // The server has it and is still at it: the first return read the page again regardless.
    expect(second.w.lastOn(recordKey("threads", "t1"))?.status).toBe("sending");
    expect(second.reads()).toBe(1);
    t2.hide();
    t2.show();
    await flush();
    await flush();
    expect(second.reads()).toBe(2);
    // It lands with nobody waiting: the page reads again to show it.
    s.finish("req-0001", { answer: { sent: true } });
    t2.pass(5_000);
    await flush();
    await flush();
    expect(second.w.lastOn(recordKey("threads", "t1"))?.status).toBe("sent");
    expect(second.reads()).toBeGreaterThan(2);
    expect(second.w.goingIn("threads")).toBeNull();
  });

  it("settles a press whose calls all answered but that nothing settled", async () => {
    const shared = memoryStore();
    // A load that ended between its last call's answer and the press settling.
    shared.setItem(
      "wren.writes",
      JSON.stringify([
        {
          id: "old-1",
          key: "reply:t1:x",
          what: "inbox.reply",
          label: "Reply",
          records: [recordKey("threads", "t1")],
          input: null,
          status: "sending",
          error: null,
          at: 1,
          settled: null,
          due: null,
          hide: false,
          read: false,
          told: false,
          page: "gone",
          retried: false,
          accepted: true,
          calls: [
            {
              id: "old-1",
              path: "marketing/inboxReply",
              body: { body: "x" },
              status: "sent",
              error: null,
              at: 1,
              accepted: true,
            },
          ],
        },
      ]),
    );
    const t = tab(shared);
    const { w } = sendStore(t, sendServer());
    await flush();
    await flush();
    expect(w.lastOn(recordKey("threads", "t1"))?.status).toBe("sent");
    expect(w.goingIn("threads")).toBeNull();
    expect(w.pending).toBe(0);
  });

  it("fails honestly when the server has no record and giving it again does not bring one", async () => {
    const t = tab();
    const s = sendServer();
    const { w, go } = sendStore(t, s);
    // The server takes each post and forgets it.
    w.use({ status: async () => ({ state: "unknown" }) });
    let said: unknown = null;
    const p = go("hello").catch((e: unknown) => {
      said = e;
    });
    await flush();
    for (let i = 0; i < 8 && !said; i++) {
      t.pass(5_000);
      await flush();
      await flush();
    }
    await p;
    expect((said as Error).message).toBe("The server has no record of it. Send it again.");
    const last = w.lastOn(recordKey("threads", "t1"));
    expect(last?.status).toBe("failed");
    expect(last?.input).toEqual({ body: "hello" });
    expect(w.goingIn("threads")).toBeNull();
    // It was given again each time, under its one id.
    expect(new Set(s.posts.map((b) => b.requestId))).toEqual(new Set(["req-0001"]));
  });

  it("a send the server is trying again is not at work for a button", async () => {
    const t = tab();
    const s = sendServer();
    const { w, go } = sendStore(t, s);
    const p = go("hello");
    await flush();
    expect(w.goingIn("threads")).toEqual({ what: "inbox.reply", ids: ["t1"] });
    w.heard("req-0001", {
      state: "sending",
      retry: { count: 1, reason: "LinkedIn answered 503." },
    });
    expect(w.goingIn("threads")).toBeNull();
    expect(w.lastOn(recordKey("threads", "t1"))?.status).toBe("sending");
    s.finish("req-0001", { answer: { sent: true } });
    t.pass(5_000);
    await p;
    expect(w.lastOn(recordKey("threads", "t1"))?.status).toBe("sent");
  });

  it("an answer pushed for a send that cannot be given again never throws unhandled", async () => {
    const t = tab();
    const s = sendServer();
    const { w, go } = sendStore(t, s);
    w.use({
      send: async (path, body) => {
        if (s.posts.length) throw new Error("offline");
        return s.send(path, body);
      },
    });
    void go("hello").catch(() => undefined);
    await flush();
    w.heard("req-0001", { state: "unknown" });
    await flush();
    expect(w.lastOn(recordKey("threads", "t1"))?.status).toBe("sending");
  });
});
