import { describe, expect, it } from "vitest";
import { awakeableId, childId, newInvocationId, parseAwakeableId, Rand } from "./ids.js";
import { retryDelay } from "./store.js";
import { millis } from "./turn.js";

describe("ids", () => {
  it("child id is a pure function of parent and seq", () => {
    expect(childId("inv_a", 3)).toBe(childId("inv_a", 3));
    expect(childId("inv_a", 3)).not.toBe(childId("inv_a", 4));
    expect(childId("inv_a", 3)).toMatch(/^inv_[0-9a-z]{26}$/);
  });
  it("new ids differ and carry Restate's prefix", () => {
    const a = newInvocationId();
    expect(a).toMatch(/^inv_[0-9a-z]{26}$/);
    expect(newInvocationId()).not.toBe(a);
  });
  it("awakeable ids round-trip", () => {
    const inv = newInvocationId();
    expect(parseAwakeableId(awakeableId(inv, 7))).toEqual({ invocation: inv, seq: 7 });
    expect(parseAwakeableId("sign_1abc")).toBeUndefined();
  });
});

describe("Rand", () => {
  it("same seed, same sequence; other seed, other sequence", () => {
    const a = new Rand("inv_x");
    const b = new Rand("inv_x");
    const c = new Rand("inv_y");
    const xs = [a.random(), a.random(), a.uuidv4()];
    expect([b.random(), b.random(), b.uuidv4()]).toEqual(xs);
    expect(c.random()).not.toBe(xs[0]);
  });
  it("random is in [0, 1) and uuidv4 has version and variant bits", () => {
    const r = new Rand("inv_z");
    for (let i = 0; i < 1000; i++) {
      const v = r.random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(r.uuidv4()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("retryDelay", () => {
  it("defaults to Restate's: 500 ms doubling, capped at 1 min", () => {
    expect(retryDelay(undefined, 1)).toBe(500);
    expect(retryDelay(undefined, 2)).toBe(1000);
    expect(retryDelay(undefined, 30)).toBe(60_000);
  });
  it("takes the handler's policy", () => {
    const p = { initialInterval: { seconds: 1 }, exponentiationFactor: 3, maxInterval: 5000 };
    expect(retryDelay(p, 1)).toBe(1000);
    expect(retryDelay(p, 2)).toBe(3000);
    expect(retryDelay(p, 3)).toBe(5000);
  });
});

describe("millis", () => {
  it("reads numbers and durations", () => {
    expect(millis(undefined)).toBeUndefined();
    expect(millis(1.9)).toBe(1);
    expect(millis({ minutes: 1, seconds: 2, milliseconds: 3 })).toBe(62_003);
  });
});
