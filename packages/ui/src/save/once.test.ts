import { describe, expect, it, vi } from "vitest";
import { callOnce } from "../action.js";
import { answersOf, onWrite, patchedSince, writeThrough } from "./cache.js";
import { tick } from "./clock.js";
import { readForm, writeForm } from "./journal.js";
import { Once } from "./once.js";
import { memoryStore, refusal } from "./test-kit.js";

const ids = () => {
  let n = 0;
  return () => {
    n += 1;
    return `req-${n}`;
  };
};

describe("one action per press", () => {
  it("sends a double click once, and both presses get its answer", async () => {
    const once = new Once(ids());
    const call = vi.fn(async (requestId: string) => ({ done: [1], requestId }));
    const first = once.run("approve:1", call);
    const second = once.run("approve:1", call);
    expect(call).toHaveBeenCalledOnce();
    expect(await first).toEqual(await second);
    expect(once.busy("approve:1")).toBe(false);
  });

  it("keeps the request id across a lost answer, and starts a new one after an answer", async () => {
    const once = new Once(ids());
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
    const once = new Once(ids());
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

  it("patches what's cached and what's mounted, untouched answers stay the same object", () => {
    const scope = {};
    const answers = answersOf(scope);
    const other = { total: 3 };
    answers.set("list", { rows: [{ id: 1, text: "old" }] });
    answers.set("stats", other);
    const told = vi.fn();
    const off = onWrite(scope, told);
    writeThrough(scope, rowText("new"));
    expect(answers.get("list")).toEqual({ rows: [{ id: 1, text: "new" }] });
    expect(answers.get("stats")).toBe(other);
    expect(told).toHaveBeenCalledOnce();
    off();
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
  it("come back over the same base, drop over another, and clear when sent", () => {
    const s = memoryStore();
    writeForm(s, "deals:new", { name: "Acme" }, "", 1);
    expect(readForm(s, "deals:new", "", 2)).toEqual({ name: "Acme" });
    writeForm(s, "approve:1", { text: "edited" }, "Claude's draft", 1);
    expect(readForm(s, "approve:1", "a new draft", 2)).toBeNull();
    expect(s.map.has("wren.form:approve:1")).toBe(false);
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
