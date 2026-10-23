import { describe, expect, it } from "vitest";
import { foldIo, foldSteps, octPath, octPts, rounded } from "./geometry.js";

describe("octPts", () => {
  it("keeps a straight run straight", () => {
    expect(octPts([0, 10], [100, 10])).toEqual([
      [0, 10],
      [100, 10],
    ]);
    expect(octPts([5, 0], [5, 80])).toEqual([
      [5, 0],
      [5, 80],
    ]);
  });

  it("goes straight, then 45 degrees, then straight", () => {
    const p = octPts([0, 0], [100, 40]);
    expect(p).toHaveLength(4);
    const [, b, c] = p;
    expect(b?.[1]).toBe(0);
    expect(c?.[1]).toBe(40);
    // The diagonal has equal run and rise.
    expect((c?.[0] ?? 0) - (b?.[0] ?? 0)).toBe(40);
  });

  it("works right to left", () => {
    const p = octPts([100, 0], [0, 40]);
    expect(p[p.length - 1]).toEqual([0, 40]);
    expect((p[2]?.[0] ?? 0) < (p[1]?.[0] ?? 0)).toBe(true);
  });
});

describe("rounded", () => {
  it("is empty for no points", () => {
    expect(rounded([])).toBe("");
  });

  it("drops repeated points", () => {
    expect(
      rounded([
        [0, 0],
        [0, 0],
        [10, 0],
      ]),
    ).toBe("M0 0L10 0");
  });

  it("rounds a corner with a quadratic curve and caps the radius to half a leg", () => {
    const d = rounded(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      18,
    );
    expect(d).toContain("Q10 0");
    expect(d).toBe("M0 0L5 0Q10 0 10 5L10 10");
  });
});

describe("octPath", () => {
  it("starts at a and ends at b", () => {
    const d = octPath([10, 20], [200, 90]);
    expect(d.startsWith("M10 20")).toBe(true);
    expect(d.endsWith("L200 90")).toBe(true);
  });
});

describe("fold chip words", () => {
  it("says the steps at rest and in, out and the share under a pointer", () => {
    expect(foldSteps({ steps: 3 })).toBe("3 steps");
    expect(foldIo({ steps: 3, io: [12, 6] })).toBe("12 \u2192 6 \u00b7 50%");
    expect(foldIo({ steps: 3, io: [0, 0] })).toBe("0 \u2192 0");
    expect(foldIo({ steps: 3 })).toBe("3 steps");
  });
});
