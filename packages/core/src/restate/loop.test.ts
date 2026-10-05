import type * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import {
  errorText,
  formatDelay,
  lastPass,
  loopState,
  retryDelayMs,
  setLastPass,
  writeLoop,
} from "./loop.js";

describe("retryDelayMs", () => {
  it("starts at 15s, doubles per failure in a row, stops at the cap", () => {
    const cap = 8 * 60_000;
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((n) => retryDelayMs(n, cap))).toEqual([
      15_000, 30_000, 60_000, 120_000, 240_000, 480_000, 480_000, 480_000,
    ]);
    expect(retryDelayMs(3, 3_000)).toBe(3_000);
  });
});

describe("errorText", () => {
  it("names the query and the root cause, never the SQL or params", () => {
    const cause = Object.assign(new Error("sorry, too many clients already"), {
      name: "PostgresError",
    });
    const err = Object.assign(
      new Error('Failed query: insert into "runs" ("id") values ($1)\nparams: 9f1c'),
      { query: 'insert into "runs" ("id") values ($1)', cause },
    );
    expect(errorText(err)).toBe('insert "runs": PostgresError: sorry, too many clients already');
  });
  it("is the same text when only the params differ", () => {
    const a = Object.assign(new Error("params: a"), { query: 'update "messages" set x = $1' });
    const b = Object.assign(new Error("params: b"), { query: 'update "messages" set x = $1' });
    expect(errorText(a)).toBe(errorText(b));
    expect(errorText(a)).toBe('update "messages": query failed');
  });
  it("keeps a plain error as name and message", () => {
    expect(errorText(new TypeError("boom"))).toBe("TypeError: boom");
    expect(errorText("nope")).toBe("nope");
  });
});

describe("formatDelay", () => {
  it("says seconds under a minute", () => {
    expect([15_000, 59_000, 60_000, 480_000].map(formatDelay)).toEqual([
      "15 s",
      "59 s",
      "1 min",
      "8 min",
    ]);
  });
});

/** An object context over a Map, counting journaled state calls. */
function fakeObject(state: Record<string, unknown>) {
  const store = new Map(Object.entries(state));
  const calls: string[] = [];
  const ctx = {
    key: "k",
    get: async (k: string) => {
      calls.push(`get ${k}`);
      return store.has(k) ? store.get(k) : null;
    },
    set: (k: string, v: unknown) => {
      calls.push(`set ${k}`);
      store.set(k, structuredClone(v));
    },
    clear: (k: string) => {
      calls.push(`clear ${k}`);
      store.delete(k);
    },
  } as unknown as restate.ObjectContext;
  return { ctx, store, calls };
}

describe("loop state", () => {
  const pass = {
    stats: null,
    error: null,
    failures: 0,
    delayMs: 1000,
    now: "2026-01-01T00:00:00Z",
  };

  it("a pass reads the one key once and writes it once", async () => {
    const { ctx, calls } = fakeObject({ loop: { running: true, generation: 3, last: null } });
    expect((await loopState(ctx)).generation).toBe(3);
    expect(await lastPass(ctx)).toBeNull();
    await setLastPass(ctx, pass);
    expect(await lastPass(ctx)).toEqual(pass);
    expect(calls).toEqual(["get loop", "set loop"]);
  });

  it("takes over the three legacy keys and clears them on its first write", async () => {
    const { ctx, store, calls } = fakeObject({ running: true, generation: 2, last: pass });
    expect(await loopState(ctx)).toEqual({ running: true, generation: 2, last: pass });
    await writeLoop(ctx, { running: false });
    await setLastPass(ctx, { ...pass, failures: 1 });
    expect(Object.fromEntries(store)).toEqual({
      loop: { running: false, generation: 2, last: { ...pass, failures: 1 } },
    });
    expect(calls.filter((c) => c.startsWith("clear"))).toHaveLength(3);
  });

  it("a key never written reads as stopped, generation 0", async () => {
    const { ctx, calls } = fakeObject({});
    expect(await loopState(ctx)).toEqual({ running: false, generation: 0, last: null });
    await writeLoop(ctx, { running: true, generation: 1 });
    expect(calls.filter((c) => c.startsWith("clear"))).toHaveLength(0);
  });
});
