import { describe, expect, it, vi } from "vitest";
import { callOnce } from "../action.js";
import { keyOf, patchedSince, QUERIES, writeThrough } from "../data/query.js";
import { tick } from "./clock.js";
import { readForm, readKept, writeForm } from "./journal.js";
import { fakeWriteEnv, memoryStore, refusal } from "./test-kit.js";
import { Writes } from "./writes.js";

/** A press in a tab of its own, its ids req-1, req-2... */
const pressing = () => {
  const w = new Writes(fakeWriteEnv());
  return {
    run: <R>(key: string, fn: (r: string) => Promise<R>) => w.press({ key }, fn),
    busy: (key: string) => w.busy(key),
  };
};

describe("one action per press", () => {
  it("sends a double click once, and both presses get its answer", async () => {
    const once = pressing();
    const call = vi.fn(async (requestId: string) => ({ done: [1], requestId }));
    const first = once.run("approve:1", call);
    const second = once.run("approve:1", call);
    expect(call).toHaveBeenCalledOnce();
    expect(await first).toEqual(await second);
    await Promise.resolve();
    expect(once.busy("approve:1")).toBe(false);
  });

  it("keeps the request id across a lost answer, and starts a new one after an answer", async () => {
    const once = pressing();
    const seen: string[] = [];
    await once
      .run("send:1", async (r) => {
        seen.push(r);
        throw refusal("You're offline, or the portal is.", 0);
      })
      .catch(() => undefined);
    await once.run("send:1", async (r) => void seen.push(r));
    await once.run("send:1", async (r) => void seen.push(r));
    expect(seen).toEqual(["req-1", "req-1", "req-2"]);
  });

  it("starts a new request id after a refusal (he changes the input and sends again)", async () => {
    const once = pressing();
    const seen: string[] = [];
    await once
      .run("send:1", async (r) => {
        seen.push(r);
        throw refusal("needs a subreddit", 400);
      })
      .catch(() => undefined);
    await once.run("send:1", async (r) => void seen.push(r));
    expect(seen).toEqual(["req-1", "req-2"]);
  });
});

describe("write-through", () => {
  const rowText = (text: string) => (_k: string, d: unknown) => {
    const a = d as { rows?: { id: number; text: string }[] };
    return a.rows ? { rows: a.rows.map((r) => (r.id === 1 ? { ...r, text } : r)) } : d;
  };

  it("patches every cached answer in the scope, untouched answers stay the same object", () => {
    const scope = {};
    const other = { total: 3 };
    QUERIES.setQueryData(keyOf(scope, "list"), { rows: [{ id: 1, text: "old" }] });
    QUERIES.setQueryData(keyOf(scope, "stats"), other);
    const elsewhere = { rows: [{ id: 1, text: "old" }] };
    QUERIES.setQueryData(keyOf({}, "list"), elsewhere);
    writeThrough(scope, rowText("new"));
    expect(QUERIES.getQueryData(keyOf(scope, "list"))).toEqual({ rows: [{ id: 1, text: "new" }] });
    expect(QUERIES.getQueryData(keyOf(scope, "stats"))).toBe(other);
    expect(elsewhere.rows[0]?.text).toBe("old");
  });

  it("gives a read that left before the patch the patch too", () => {
    const scope = {};
    const left = tick();
    writeThrough(scope, rowText("saved"));
    const late = patchedSince(scope, "list", { rows: [{ id: 1, text: "old" }] }, left);
    expect(late).toEqual({ rows: [{ id: 1, text: "saved" }] });
    const fresh = patchedSince(scope, "list", { rows: [{ id: 1, text: "newer" }] }, tick());
    expect(fresh).toEqual({ rows: [{ id: 1, text: "newer" }] });
  });
});

describe("kept forms", () => {
  it("come back over the same base, are kept over another (a conflict), and clear when sent", () => {
    const s = memoryStore();
    writeForm(s, "deals:new", { name: "Acme" }, "", 1);
    expect(readForm(s, "deals:new", "", 2)).toEqual({ name: "Acme" });
    writeForm(s, "approve:1", { text: "edited" }, "Claude's draft", 1);
    expect(readForm(s, "approve:1", "a new draft", 2)).toBeNull();
    // Never dropped silently: the words wait, with the base they were typed over.
    expect(readKept(s, "approve:1", 2)).toEqual({
      values: { text: "edited" },
      base: "Claude's draft",
    });
    writeForm(s, "deals:new", null, "", 3);
    expect(readForm(s, "deals:new", "", 4)).toBeNull();
  });
});

describe("callOnce (every useRun action)", () => {
  it("sends a double click on Approve once, with a requestId", async () => {
    const call = vi.fn(async () => ({ done: [5] }));
    const a = callOnce(call, "Drafts/approve", [5], { ids: [5] });
    const b = callOnce(call, "Drafts/approve", [5], { ids: [5] });
    expect(await a).toEqual(await b);
    expect(call).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledWith("Drafts/approve", {
      ids: [5],
      requestId: expect.any(String),
    });
  });
});
