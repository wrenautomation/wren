/**
 * William, 2026-10-14: "not writing on every keystroke". What a burst of typing costs: network
 * saves per pause, re-reads per save, storage writes per key (those are fine).
 */
import type { FieldMeta } from "@wren/core/records";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Call } from "./action.js";
import { draftSaving, liveText } from "./draft-save.js";
import { fieldSaving } from "./edits.js";
import { forgetSaves, Saver } from "./save/engine.js";
import { fakeEnv, memoryStore } from "./save/test-kit.js";

const WORDS = "Forty characters of typing, fast enough.";

/** A server that answers each call after `ms`, counting them. */
function counted(ms = 100) {
  const calls: { handler: string; input: Record<string, unknown> }[] = [];
  const call: Call = (handler, input) => {
    calls.push({ handler, input });
    return new Promise((done) => setTimeout(() => done({ run: calls.length }), ms));
  };
  return { calls, call };
}

/** A store that counts its writes. */
function countedStore() {
  const s = memoryStore();
  let writes = 0;
  return {
    store: {
      ...s,
      setItem: (k: string, v: string) => {
        writes += 1;
        s.setItem(k, v);
      },
    },
    writes: () => writes,
  };
}

let n = 0;
beforeEach(() => {
  n += 1;
  vi.useFakeTimers();
  forgetSaves();
});
afterEach(() => vi.useRealTimers());

/** Type `text` one character every `gap` ms. */
async function type(saver: Saver<string>, from: string, text: string, gap = 60) {
  for (let i = 1; i <= text.length; i++) {
    saver.set(from + text.slice(0, i));
    await vi.advanceTimersByTimeAsync(gap);
  }
}

describe("a draft box under a burst of typing", () => {
  function box() {
    const { calls, call } = counted();
    const changed = vi.fn();
    const wrote = vi.fn();
    const { store, writes } = countedStore();
    const saver = new Saver<string>({
      ...draftSaving({
        handler: "Draft/set",
        id: n,
        key: `draft:test:${n}`,
        server: "",
        call,
        changed,
        wrote,
      }),
      env: fakeEnv({ storage: store }).env,
    });
    saver.open();
    return { saver, calls, changed, wrote, writes };
  }

  it("sends one save for 40 characters typed in one go, and reads nothing again", async () => {
    const b = box();
    await type(b.saver, "", WORDS);
    expect(b.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1200 + 100);
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0]?.input).toMatchObject({ text: WORDS, expect: null });
    expect(b.calls[0]?.input.requestId).toEqual(expect.any(String));
    expect(b.changed).not.toHaveBeenCalled();
    expect(b.wrote).toHaveBeenCalledTimes(1);
    expect(b.saver.snapshot().status).toBe("saved");
    // The journal writes on each key: storage, not the network.
    expect(b.writes()).toBe(WORDS.length);
  });

  it("sends one save per pause, two pauses two saves", async () => {
    const b = box();
    await type(b.saver, "", WORDS.slice(0, 20));
    await vi.advanceTimersByTimeAsync(1300);
    await type(b.saver, WORDS.slice(0, 20), WORDS.slice(20));
    await vi.advanceTimersByTimeAsync(1300);
    // Sent trimmed: the trailing space stays in the box.
    expect(b.calls.map((c) => c.input.text)).toEqual([WORDS.slice(0, 20).trim(), WORDS]);
    expect(b.calls[1]?.input.expect).toBe(WORDS.slice(0, 20).trim());
    expect(b.changed).not.toHaveBeenCalled();
  });

  it("typing through a slow save adds one save after it, not one per key", async () => {
    const { calls, call } = counted(3000);
    const saver = new Saver<string>({
      ...draftSaving({
        handler: "Draft/set",
        id: n,
        key: `draft:slow:${n}`,
        server: "",
        call,
        changed: vi.fn(),
      }),
      env: fakeEnv().env,
    });
    saver.open();
    await type(saver, "", WORDS.slice(0, 10));
    await vi.advanceTimersByTimeAsync(1200);
    expect(calls).toHaveLength(1);
    await type(saver, WORDS.slice(0, 10), WORDS.slice(10));
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls.map((c) => c.input.text)).toEqual([WORDS.slice(0, 10), WORDS]);
  });
});

describe("a record field under a burst of typing", () => {
  const field = { key: "name", kind: "text", label: "Name" } as FieldMeta;

  it("sends nothing while he types, one save on Enter, and reads nothing again", async () => {
    const save = vi.fn(async () => undefined);
    const saver = new Saver<string>({
      ...fieldSaving(field, "Acme", save, `edit:deals:${n}:name`),
      env: fakeEnv().env,
    });
    saver.open();
    await type(saver, "Acme", ` ${WORDS}`.slice(0, 40));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).not.toHaveBeenCalled();
    expect(await saver.flush()).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(`Acme ${WORDS}`.slice(0, 44).trim());
  });
});

describe("the live words beside the box", () => {
  it("tell only their readers, once per change", () => {
    const live = liveText();
    const reader = vi.fn();
    live.subscribe(reader);
    for (const ch of WORDS) live.set((live.get() ?? "") + ch);
    live.set(WORDS);
    expect(reader).toHaveBeenCalledTimes(WORDS.length);
  });
});
