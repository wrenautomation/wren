import { describe, expect, it } from "vitest";
import { encodeArgs } from "./encode.js";
import { checkZooms, concatList, type Recording, type Zoom, zoomExpressions } from "./timeline.js";

/** Evaluate an ffmpeg expression the way zoompan would, for the few functions we use. */
function evalExpr(expr: string, vars: Record<string, number>): number {
  const js = expr.replace(/\b(it|iw|ih|zoom)\b/g, (v) => `(${vars[v]})`).replace(/clip\(/g, "c(");
  const c = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  return new Function("c", `return ${js};`)(c) as number;
}

const zoom: Zoom = { start: 2, end: 6, ramp: 1, cx: 2400, cy: 300, z: 2 };

describe("concatList", () => {
  it("shows each frame until the next, the first from 0 and the last until the end", () => {
    const list = concatList(
      [
        { file: "frames/1.jpg", t: 0.2 },
        { file: "frames/2.jpg", t: 1.5 },
      ],
      4,
    );
    expect(list).toBe(
      "ffconcat version 1.0\nfile 'frames/1.jpg'\nduration 1.5000\nfile 'frames/2.jpg'\nduration 2.5000\nfile 'frames/2.jpg'\n",
    );
  });

  it("refuses a recording with no frames", () => {
    expect(() => concatList([], 3)).toThrow(/no frames/);
  });
});

describe("zoomExpressions", () => {
  const { z, x, y } = zoomExpressions([zoom], 2560, 1440);
  const at = (t: number) => {
    const zz = evalExpr(z, { it: t });
    const v = { it: t, iw: 2560, ih: 1440, zoom: zz };
    return { z: zz, x: evalExpr(x, v), y: evalExpr(y, v) };
  };

  it("is the whole frame outside the zoom", () => {
    expect(at(0)).toEqual({ z: 1, x: 0, y: 0 });
    expect(at(7)).toEqual({ z: 1, x: 0, y: 0 });
  });

  it("holds the full zoom between the ramps, kept inside the frame", () => {
    const mid = at(4);
    expect(mid.z).toBe(2);
    // centered on 2400 the view (1280 wide) would pass the right edge, so it stops there
    expect(mid.x).toBe(1280);
    expect(mid.y).toBe(0);
  });

  it("eases: halfway up the ramp is halfway zoomed", () => {
    expect(at(2.5).z).toBeCloseTo(1.5, 5);
    expect(at(5.5).z).toBeCloseTo(1.5, 5);
  });

  it("never shows past the frame's edge", () => {
    for (let t = 0; t <= 7; t += 0.1) {
      const v = at(t);
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.x + 2560 / v.z).toBeLessThanOrEqual(2560 + 1e-6);
      expect(v.y + 1440 / v.z).toBeLessThanOrEqual(1440 + 1e-6);
    }
  });

  it("is a plain full frame with no zooms", () => {
    expect(zoomExpressions([], 2560, 1440)).toEqual({ z: "1", x: "0", y: "0" });
  });
});

describe("checkZooms", () => {
  it("refuses overlaps, zooms out, and zooms too short for their ramps", () => {
    expect(() => checkZooms([zoom, { ...zoom, start: 5, end: 9 }])).toThrow(/overlap/);
    expect(() => checkZooms([{ ...zoom, z: 0.8 }])).toThrow(/below 1/);
    expect(() => checkZooms([{ ...zoom, end: 3 }])).toThrow(/shorter/);
    expect(() => checkZooms([zoom, { ...zoom, start: 6, end: 9 }])).not.toThrow();
  });
});

describe("encodeArgs", () => {
  const rec: Recording = {
    dir: "/w",
    width: 2560,
    height: 1440,
    frames: [{ file: "frames/1.jpg", t: 0 }],
    end: 10,
    zooms: [zoom],
    captions: [
      { text: "one", start: 1, end: 4, png: "/w/captions/1.png" },
      { text: "drawn later", start: 5, end: 6 },
    ],
  };
  const args = encodeArgs(rec, "/w/frames.ffconcat", "/out/v.mp4", {
    width: 1920,
    height: 1080,
    fps: 30,
    crf: 20,
  });
  const graph = args[args.indexOf("-filter_complex") + 1] ?? "";

  it("overlays only captions that were drawn, each faded in and out", () => {
    expect(args.filter((a) => a.endsWith(".png"))).toEqual(["/w/captions/1.png"]);
    expect(graph).toContain("fade=in:st=1.000:d=0.3:alpha=1,fade=out:st=3.700:d=0.3:alpha=1[c1]");
    expect(args[args.indexOf("-map") + 1]).toBe("[v1]");
  });

  it("scales to the output size at a steady rate and cuts at the end", () => {
    expect(graph).toContain("[0:v]fps=30,zoompan=z='");
    expect(graph).toContain(":d=1:s=1920x1080:fps=30");
    expect(args[args.indexOf("-t", args.indexOf("-map")) + 1]).toBe("10.000");
    expect(args.at(-1)).toBe("/out/v.mp4");
  });
});
