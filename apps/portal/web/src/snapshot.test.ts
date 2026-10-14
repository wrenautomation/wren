import { describe, expect, it } from "vitest";
import {
  dropSnapshot,
  readSnapshot,
  SNAPSHOT_KEY,
  SNAPSHOT_MAX_AGE_MS,
  writeSnapshot,
} from "./snapshot.js";

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
};

describe("device snapshot", () => {
  it("gives back what the same login kept", () => {
    const s = memory();
    writeSnapshot(s, "sam@example.com", 1000, [
      ["me", { name: "Sam" }],
      ["acme:people", [1, 2]],
    ]);
    expect(readSnapshot(s, "sam@example.com", 2000)).toEqual([
      ["me", { name: "Sam" }],
      ["acme:people", [1, 2]],
    ]);
  });

  it("never shows one login's answers to another, or to nobody", () => {
    const s = memory();
    writeSnapshot(s, "sam@example.com", 1000, [["me", { name: "Sam" }]]);
    expect(readSnapshot(s, "kim@example.com", 2000)).toEqual([]);
    expect(readSnapshot(s, null, 2000)).toEqual([]);
  });

  it("drops a snapshot older than a week", () => {
    const s = memory();
    writeSnapshot(s, "sam@example.com", 0, [["me", {}]]);
    expect(readSnapshot(s, "sam@example.com", SNAPSHOT_MAX_AGE_MS + 1)).toEqual([]);
  });

  it("keeps the newest answers that fit, in their order", () => {
    const s = memory();
    const big = "x".repeat(50);
    writeSnapshot(
      s,
      "sam@example.com",
      1,
      [
        ["old", big],
        ["mid", big],
        ["new", big],
      ],
      130,
    );
    expect(readSnapshot(s, "sam@example.com", 2).map(([k]) => k)).toEqual(["mid", "new"]);
  });

  it("reads broken storage as empty, and a drop wipes it", () => {
    const s = memory();
    s.raw.set(SNAPSHOT_KEY, "{not json");
    expect(readSnapshot(s, "sam@example.com", 1)).toEqual([]);
    writeSnapshot(s, "sam@example.com", 1, [["me", {}]]);
    dropSnapshot(s);
    expect(s.raw.has(SNAPSHOT_KEY)).toBe(false);
  });
});
