import { describe, expect, it } from "vitest";
import { cutGraph, cutSize, scaleFilter } from "./media.js";

describe("cut pass scale", () => {
  it("keeps a landscape track 1080 high and a portrait one 1080 wide", () => {
    expect(scaleFilter({ width: 1920, height: 1080 })).toBe("scale=-2:1080:flags=lanczos");
    expect(scaleFilter({ width: 2560, height: 1440 })).toBe("scale=-2:1080:flags=lanczos");
    expect(scaleFilter({ width: 1080, height: 1920 })).toBe("scale=1080:-2:flags=lanczos");
    expect(scaleFilter({ width: 720, height: 1280 })).toBe("scale=1080:-2:flags=lanczos");
    // Square counts as landscape.
    expect(scaleFilter({ width: 1080, height: 1080 })).toBe("scale=-2:1080:flags=lanczos");
  });

  it("answers the size it writes, even on both sides", () => {
    expect(cutSize({ width: 2560, height: 1440 })).toEqual([1920, 1080]);
    expect(cutSize({ width: 720, height: 1280 })).toEqual([1080, 1920]);
    expect(cutSize({ width: 1080, height: 1350 })).toEqual([1080, 1350]);
    expect(cutSize({ width: 1440, height: 1080 })).toEqual([1440, 1080]);
  });

  it("puts the track's scale in the graph", () => {
    const keep = [{ s: 0, e: 5 }];
    expect(cutGraph(keep, true, { width: 1080, height: 1920 })).toContain(
      "fps=30,scale=1080:-2:flags=lanczos,format=yuv420p",
    );
    expect(cutGraph(keep, false, { width: 1920, height: 1080 })).toContain(
      "fps=30,scale=-2:1080:flags=lanczos,format=yuv420p",
    );
  });
});
