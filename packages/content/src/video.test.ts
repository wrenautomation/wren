import { describe, expect, it } from "vitest";
import { clock, cutSeconds, longOf, markWords, numbered, videoRef } from "./video.js";

describe("videos", () => {
  it("reads numbered outputs in order, from 0 or 1, whatever the separator", () => {
    const files = {
      cutMain: "/v/cut-main.mp4",
      short2: "/v/s2.mp4",
      "short-1": "/v/s1.mp4",
      short10: "/v/s10.mp4",
      thumb_0: "/v/t0.png",
      thumbnail1: "/v/t1.png",
    };
    expect(numbered(files, "short")).toEqual(["/v/s1.mp4", "/v/s2.mp4", "/v/s10.mp4"]);
    expect(numbered(files, "thumb")).toEqual(["/v/t0.png", "/v/t1.png"]);
    expect(longOf({ long: "a", preview: "b" })).toBe("a");
    expect(longOf({ preview: "b" })).toBe("b");
    expect(longOf({})).toBeNull();
  });

  it("strikes words under applied and proposed cuts, never kept ones", () => {
    const words = [
      { w: "so", s: 0, e: 0.4 },
      { w: "um", s: 1, e: 1.2 },
      { w: "like", s: 2, e: 2.3 },
      { w: "this", s: 3, e: 3.4 },
    ];
    const cuts = [
      { from: 0.9, to: 1.3, why: "silence", state: "cut" },
      { from: 1.9, to: 2.4, why: "filler", state: "proposed" },
      { from: 2.9, to: 3.5, why: "manual", state: "kept" },
    ] as const;
    expect(markWords(words, [...cuts]).map((w) => w.cut)).toEqual([null, "cut", "proposed", null]);
    expect(cutSeconds([...cuts])).toBeCloseTo(0.4);
  });

  it("names lengths and refs", () => {
    expect(clock(492.4)).toBe("8:12");
    expect(clock(59.6)).toBe("1:00");
    expect(videoRef(3)).toBe("video:3");
    expect(videoRef(3, 2)).toBe("video:3/short:2");
  });
});
