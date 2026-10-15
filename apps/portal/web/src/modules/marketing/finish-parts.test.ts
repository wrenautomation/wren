import { describe, expect, it } from "vitest";
import {
  addLayout,
  boxProblem,
  newShort,
  parseTime,
  spanProblem,
  timeText,
} from "./finish-parts.js";

describe("finish parts", () => {
  it("reads and writes times to a tenth", () => {
    expect(timeText(65.54)).toBe("1:05.5");
    expect(timeText(0)).toBe("0:00.0");
    expect(parseTime("1:05.5")).toBe(65.5);
    expect(parseTime("65.5")).toBe(65.5);
    expect(parseTime(" 0:09 ")).toBe(9);
    expect(parseTime("1:75")).toBeNaN();
    expect(parseTime("soon")).toBeNaN();
    expect(parseTime(timeText(42.3))).toBe(42.3);
  });

  it("says why a row can't be saved", () => {
    expect(spanProblem([{ from: 1, to: 5 }], 10)).toBeNull();
    expect(spanProblem([{ from: Number.NaN, to: 5 }], 10)).toMatch(/Row 1: write times/);
    expect(
      spanProblem(
        [
          { from: 1, to: 5 },
          { from: 6, to: 12 },
        ],
        10,
      ),
    ).toMatch(/Row 2: inside/);
    expect(spanProblem([{ from: 5, to: 5 }], 10)).toMatch(/end is before the start/);
  });

  it("makes a Short from the picked part, else 30 s from the playhead", () => {
    expect(newShort(3, [10, 20], 60)).toEqual({ from: 10, to: 20, title: "" });
    expect(newShort(3, null, 60)).toEqual({ from: 3, to: 33, title: "" });
    expect(newShort(50, null, 60)).toEqual({ from: 50, to: 60, title: "" });
  });

  it("cuts back or splits the layout ranges a new one overlaps", () => {
    const rows = [
      { from: 0, to: 10, show: "cam" as const },
      { from: 20, to: 30, show: "screen" as const },
    ];
    expect(addLayout(rows, { from: 5, to: 25, show: "corner" })).toEqual([
      { from: 0, to: 5, show: "cam" },
      { from: 5, to: 25, show: "corner" },
      { from: 25, to: 30, show: "screen" },
    ]);
    expect(addLayout(rows, { from: 22, to: 24, show: "cam" })).toEqual([
      { from: 0, to: 10, show: "cam" },
      { from: 20, to: 22, show: "screen" },
      { from: 22, to: 24, show: "cam" },
      { from: 24, to: 30, show: "screen" },
    ]);
    expect(addLayout(rows, { from: 0, to: 40, show: "cam" })).toEqual([
      { from: 0, to: 40, show: "cam" },
    ]);
  });

  it("checks the face box against the recording", () => {
    expect(boxProblem([960, 480, 288, 216], [1280, 720])).toBeNull();
    expect(boxProblem([1, 2, 3], [1280, 720])).toMatch(/Four whole numbers/);
    expect(boxProblem([0, 0, 8, 8], [1280, 720])).toMatch(/too small/);
    expect(boxProblem([1200, 0, 200, 200], [1280, 720])).toMatch(/goes past/);
  });
});
