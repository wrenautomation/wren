/** Field kinds' address form: what a filter param reads as, and what its chip says. */
import type { FieldMeta } from "@wren/core/records";
import { describe, expect, it } from "vitest";
import {
  dateOf,
  exact,
  filterParts,
  filterShape,
  presetStart,
  readFilter,
  relative,
  widthOf,
  wilson,
} from "./fields.js";

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
  it("reads open and closed ranges, numbers as numbers and days as their local bounds", () => {
    expect(readFilter(score, "10..50")).toEqual({ gte: 10, lte: 50 });
    expect(readFilter(score, "..50")).toEqual({ lte: 50 });
    expect(readFilter(score, "x..")).toBeUndefined();
    expect(readFilter(seen, "2026-09-01..2026-09-02")).toEqual({
      gte: new Date(2026, 8, 1).toISOString(),
      lte: new Date(new Date(2026, 8, 3).getTime() - 1).toISOString(),
    });
  });
  it("reads a date preset from the start of its first day", () => {
    const at = new Date(2026, 9, 7, 15, 30);
    expect(readFilter(seen, "7d", at)).toEqual({ gte: new Date(2026, 9, 1).toISOString() });
    expect(presetStart("today", at)).toEqual(new Date(2026, 9, 7));
    expect(presetStart("30d", at)).toEqual(new Date(2026, 8, 8));
    expect(presetStart("month", at)).toEqual(new Date(2026, 9, 1));
    expect(readFilter(score, "7d")).toBeUndefined();
  });
  it("reads words and set-or-empty only where the field allows them", () => {
    expect(readFilter(title, "~acme")).toEqual({ contains: "acme" });
    expect(readFilter(title, "-")).toEqual({ empty: true });
    expect(readFilter(now, "+")).toBeUndefined();
  });
});

describe("filterShape and filterParts", () => {
  it("pick the control from the ops", () => {
    expect([now, score, title].map(filterShape)).toEqual(["states", "range", "words"]);
    expect(filterShape(field({ ops: ["empty"] }))).toBe("set");
  });
  it("say what's set in words, operator apart", () => {
    const at = new Date(2026, 9, 7);
    expect(filterParts(now, "moved")).toEqual({ op: "is", value: "Moved" });
    expect(filterParts(now, "moved,there")).toEqual({
      op: "is any of",
      value: "Moved, Still there",
    });
    expect(filterParts(score, "10..")).toEqual({ op: "at least", value: "10" });
    expect(filterParts(score, "..5000")).toEqual({ op: "at most", value: "5,000" });
    expect(filterParts(score, "1..2")).toEqual({ op: "between", value: "1 and 2" });
    expect(filterParts(seen, "2026-10-01..", at)).toEqual({ op: "after", value: "Oct 1" });
    expect(filterParts(seen, "..2025-12-31", at)).toEqual({ op: "before", value: "Dec 31, 2025" });
    expect(filterParts(seen, "7d")).toEqual({ op: "in", value: "last 7 days" });
    expect(filterParts(title, "~acme")).toEqual({ op: "has", value: "“acme”" });
    expect(filterParts(title, "-")).toEqual({ op: "is", value: "empty" });
    expect(filterParts(title, "+")).toEqual({ op: "has", value: "a value" });
  });
  it("count many picked states when their names run long", () => {
    const many = field({
      kind: "choice",
      ops: ["in"],
      states: {
        a: { label: "Registered advisers", tone: "neutral" },
        b: { label: "Staffing agencies", tone: "neutral" },
      },
    });
    expect(filterParts(many, "a,b")).toEqual({ op: "is any of", value: "2" });
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
    expect(relative(new Date(t - 547 * 86_400_000), t)).toBe("1 year ago");
    expect(relative(new Date(t - 86_400_000), t)).toBe("1 day ago");
  });

  it("widens a column till its head, states and dates fit", () => {
    expect(widthOf(field({ label: "Sent" }))).toBe(144);
    expect(widthOf(field({ label: "Sent" }), true)).toBe(173);
    expect(
      widthOf(
        field({ label: "Failures in a row", column: { align: "start", width: "s", max: 200 } }),
      ),
    ).toBe(161);
    expect(
      widthOf(
        field({ kind: "date", label: "At", column: { align: "start", width: "s", max: 200 } }),
      ),
    ).toBe(125);
    const states = { follow_ups: { label: "Follow-ups only", tone: "neutral" as const } };
    expect(widthOf(field({ kind: "status", label: "State", states }))).toBe(147);
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
