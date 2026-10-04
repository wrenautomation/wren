/** Field kinds' address form: what a filter param reads as, and what its chip says. */
import type { FieldMeta } from "@wren/core/records";
import { describe, expect, it } from "vitest";
import { dateOf, exact, filterLabel, filterShape, readFilter, relative, wilson } from "./fields.js";

const field = (over: Partial<FieldMeta>): FieldMeta => ({
  key: "f",
  kind: "text",
  label: "F",
  ops: [],
  sortable: false,
  searchable: false,
  column: null,
  ...over,
});
const now = field({
  kind: "status",
  ops: ["in"],
  states: {
    moved: { label: "Moved", tone: "good" },
    there: { label: "Still there", tone: "neutral" },
  },
});
const score = field({ kind: "score", ops: ["eq", "gte", "lte", "empty"] });
const seen = field({ kind: "date", ops: ["gte", "lte", "empty"] });
const title = field({ ops: ["eq", "in", "contains", "empty"] });

describe("readFilter", () => {
  it("reads states, dropping unknown ones", () => {
    expect(readFilter(now, "moved,nope,there")).toEqual(["moved", "there"]);
    expect(readFilter(now, "nope")).toBeUndefined();
  });
  it("reads open and closed ranges, numbers as numbers and dates as text", () => {
    expect(readFilter(score, "10..50")).toEqual({ gte: 10, lte: 50 });
    expect(readFilter(score, "..50")).toEqual({ lte: 50 });
    expect(readFilter(score, "x..")).toBeUndefined();
    expect(readFilter(seen, "2026-09-01..")).toEqual({ gte: "2026-09-01" });
  });
  it("reads words and set-or-empty only where the field allows them", () => {
    expect(readFilter(title, "~acme")).toEqual({ contains: "acme" });
    expect(readFilter(title, "-")).toEqual({ empty: true });
    expect(readFilter(now, "+")).toBeUndefined();
  });
});

describe("filterShape and filterLabel", () => {
  it("pick the control from the ops", () => {
    expect([now, score, title].map(filterShape)).toEqual(["states", "range", "words"]);
    expect(filterShape(field({ ops: ["empty"] }))).toBe("set");
  });
  it("say what's set in words", () => {
    expect(filterLabel(now, "moved,there")).toBe("Moved, Still there");
    expect(filterLabel(score, "10..")).toBe("10 or more");
    expect(filterLabel(title, "-")).toBe("is empty");
  });
});

describe("rates and times", () => {
  it("gives a Wilson range inside 0 to 1", () => {
    const [lo, hi] = wilson(5, 50);
    expect(lo).toBeGreaterThan(0.03);
    expect(hi).toBeLessThan(0.22);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
  it("says a time relative to now", () => {
    const t = Date.UTC(2026, 9, 3);
    expect(relative(new Date(t - 3 * 86_400_000), t)).toBe("3 days ago");
    expect(relative(new Date(t), t)).toBe("just now");
  });
});

describe("dateOf and exact", () => {
  it("reads a bare day as that day, shown without a time", () => {
    const d = dateOf("2024-07-27");
    expect(d && exact(d)).toBe("Jul 27, 2024");
    const utc = dateOf("2024-07-27 00:00:00+00");
    expect(utc && exact(utc)).toBe("Jul 27, 2024");
  });
});
