import { describe, expect, it } from "vitest";
import { offsetOf, pageAt, pagesOf, type Slot, slotsOf, spanOf } from "./pager.js";

describe("pagesOf", () => {
  it("counts whole pages and keeps one for an empty list", () => {
    expect(pagesOf(0)).toBe(1);
    expect(pagesOf(50)).toBe(1);
    expect(pagesOf(51)).toBe(2);
    expect(pagesOf(612)).toBe(13);
    expect(pagesOf(30, 10)).toBe(3);
  });
});

describe("pageAt", () => {
  it("reads a whole number from 1, else the first page", () => {
    expect(pageAt(null)).toBe(1);
    expect(pageAt("")).toBe(1);
    expect(pageAt("0")).toBe(1);
    expect(pageAt("-3")).toBe(1);
    expect(pageAt("2.5")).toBe(1);
    expect(pageAt("abc")).toBe(1);
    expect(pageAt("7")).toBe(7);
  });
});

describe("offsetOf and spanOf", () => {
  it("skips the pages before and names the rows held", () => {
    expect(offsetOf(1)).toBe(0);
    expect(offsetOf(3)).toBe(100);
    expect(spanOf(1, 50)).toEqual([1, 50]);
    expect(spanOf(13, 12)).toEqual([601, 612]);
    expect(spanOf(1, 0)).toEqual([0, 0]);
  });
});

describe("slotsOf", () => {
  const show = (s: Slot[]) => s.map((x) => (x === "before" || x === "after" ? "…" : x)).join(" ");

  it("shows every page while they fit", () => {
    expect(show(slotsOf(1, 1))).toBe("1");
    expect(show(slotsOf(3, 5))).toBe("1 2 3 4 5");
    expect(show(slotsOf(4, 9))).toBe("1 2 3 4 5 6 7 8 9");
  });

  it("opens with the first pages and a gap before the last", () => {
    expect(show(slotsOf(1, 12))).toBe("1 2 3 4 5 6 7 … 12");
    expect(show(slotsOf(5, 12))).toBe("1 2 3 4 5 6 7 … 12");
  });

  it("slides a window of two either side through the middle", () => {
    expect(show(slotsOf(6, 12))).toBe("1 … 4 5 6 7 8 … 12");
    expect(show(slotsOf(7, 20))).toBe("1 … 5 6 7 8 9 … 20");
  });

  it("ends with the last pages and a gap after the first", () => {
    expect(show(slotsOf(8, 12))).toBe("1 … 6 7 8 9 10 11 12");
    expect(show(slotsOf(12, 12))).toBe("1 … 6 7 8 9 10 11 12");
  });

  it("keeps the same count on every page, so the bar holds still", () => {
    for (const around of [1, 2])
      for (let at = 1; at <= 30; at++) expect(slotsOf(at, 30, around)).toHaveLength(2 * around + 5);
  });

  it("never hides a single page behind a gap, and never repeats one", () => {
    for (const pages of [10, 11, 25])
      for (let at = 1; at <= pages; at++) {
        const s = slotsOf(at, pages, 1);
        const nums = s.filter((x): x is number => typeof x === "number");
        expect(new Set(nums).size).toBe(nums.length);
        expect(nums).toContain(1);
        expect(nums).toContain(pages);
        expect(nums).toContain(at);
        s.forEach((x, i) => {
          if (typeof x === "number") return;
          const lo = s[i - 1] as number;
          const hi = s[i + 1] as number;
          expect(hi - lo).toBeGreaterThan(2);
        });
      }
  });

  it("a window of one for a phone", () => {
    expect(show(slotsOf(1, 12, 1))).toBe("1 2 3 4 5 … 12");
    expect(show(slotsOf(6, 12, 1))).toBe("1 … 5 6 7 … 12");
    expect(show(slotsOf(12, 12, 1))).toBe("1 … 8 9 10 11 12");
  });

  it("clamps a page out of range", () => {
    expect(show(slotsOf(99, 12, 1))).toBe("1 … 8 9 10 11 12");
    expect(show(slotsOf(0, 12, 1))).toBe("1 2 3 4 5 … 12");
  });
});
