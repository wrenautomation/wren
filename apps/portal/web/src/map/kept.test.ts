import { describe, expect, it } from "vitest";
import { keptOf } from "./kept.js";

describe("kept view", () => {
  it("reads nothing from a missing or bad value", () => {
    expect(keptOf(null)).toEqual({});
    expect(keptOf("not json")).toEqual({});
    expect(keptOf("7")).toEqual({});
  });

  it("reads the level, the folds and the panel", () => {
    const raw = JSON.stringify({
      level: 2,
      open: { sales: true, money: false },
      panel: { kind: "track", id: "a_to_b" },
    });
    expect(keptOf(raw)).toEqual({
      level: 2,
      open: { sales: true, money: false },
      panel: { kind: "track", id: "a_to_b" },
    });
  });

  it("drops what it does not know", () => {
    const raw = JSON.stringify({
      level: -1,
      open: { sales: "yes", money: true },
      panel: { kind: "group", id: "x" },
    });
    expect(keptOf(raw)).toEqual({ open: { money: true } });
  });
});
