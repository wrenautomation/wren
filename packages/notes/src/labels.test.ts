import { describe, expect, it } from "vitest";
import { TaskRefusal } from "./boards.js";
import { LABEL_MAX, LABELS_MAX, labelsOf } from "./tasks.js";

describe("labelsOf", () => {
  it("cleans free text: trimmed, lowercase, one space, no repeats", () => {
    expect(labelsOf(["  Sales ", "sales", "Q4  Plan", ""])).toEqual(["sales", "q4 plan"]);
  });

  it("splits a string at ; , and line breaks", () => {
    expect(labelsOf("Sales; q4, Plan\nops")).toEqual(["sales", "q4", "plan", "ops"]);
    expect(labelsOf(["a;b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("is empty for nothing", () => {
    expect(labelsOf(null)).toEqual([]);
    expect(labelsOf(undefined)).toEqual([]);
    expect(labelsOf("")).toEqual([]);
    expect(labelsOf([])).toEqual([]);
  });

  it("refuses a long label and too many", () => {
    expect(() => labelsOf(["x".repeat(LABEL_MAX + 1)])).toThrow(TaskRefusal);
    expect(labelsOf(["x".repeat(LABEL_MAX)])).toHaveLength(1);
    const many = Array.from({ length: LABELS_MAX + 1 }, (_, i) => `l${i}`);
    expect(() => labelsOf(many)).toThrow(TaskRefusal);
    expect(labelsOf(many.slice(0, LABELS_MAX))).toHaveLength(LABELS_MAX);
  });
});
