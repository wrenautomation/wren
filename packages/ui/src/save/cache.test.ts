import { describe, expect, it } from "vitest";
import { answersOf, rememberRead, writeThrough } from "./cache.js";
import { tick } from "./clock.js";

describe("rememberRead: two reads out at once", () => {
  it("keeps the one that left later, whichever lands last", () => {
    const scope = {};
    const older = tick();
    const newer = tick();
    expect(rememberRead(scope, "deals", { n: 2 }, newer)).toBe(true);
    expect(rememberRead(scope, "deals", { n: 1 }, older)).toBe(false);
    expect(answersOf(scope).get("deals")).toEqual({ n: 2 });
  });

  it("a later read replaces it", () => {
    const scope = {};
    rememberRead(scope, "deals", { n: 1 }, tick());
    rememberRead(scope, "deals", { n: 3 }, tick());
    expect(answersOf(scope).get("deals")).toEqual({ n: 3 });
  });

  it("a write-through still patches what is kept", () => {
    const scope = {};
    rememberRead(scope, "deal:1", { name: "Old" }, tick());
    writeThrough(scope, (k, d) => (k === "deal:1" ? { name: "New" } : d));
    expect(answersOf(scope).get("deal:1")).toEqual({ name: "New" });
  });
});
