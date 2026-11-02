import { describe, expect, it } from "vitest";
import { encoderArgs, MATTE, matteFile, planMattes, toInput, toMask } from "./matte.js";
import type { LayoutRange } from "./schema.js";

const pick = (i: number, s: number, e = s + 0.4) => ({ i, w: `w${i}`, s, e });
const plan = (
  picks: ReturnType<typeof pick>[],
  layout: LayoutRange[] = [],
  o: { cam?: boolean; camBox?: boolean; durationS?: number } = {},
) =>
  planMattes({
    picks,
    layout,
    cam: o.cam ?? false,
    camBox: o.camBox ?? false,
    durationS: o.durationS ?? 600,
    fps: 30,
  });

describe("matte windows", () => {
  it("runs from the word's start to 1.2 s after its end, in frames", () => {
    const { windows } = plan([pick(1, 10, 10.5)]);
    expect(windows).toEqual([{ n: 1, source: "main", fromFrame: 300, frames: 51, picks: [1] }]);
  });

  it("caps a window at 3 s and at the end of the video", () => {
    expect(plan([pick(1, 10, 13)]).windows[0]?.frames).toBe(90);
    expect(plan([pick(1, 9.5, 9.8)], [], { durationS: 10 }).windows[0]?.frames).toBe(15);
  });

  it("skips the screen share, and the corner cam when there's a cam", () => {
    const screen: LayoutRange[] = [{ from: 0, to: 20, show: "screen" }];
    expect(plan([pick(1, 10)], screen).skipped[0]?.why).toMatch(/screen share/);
    expect(plan([pick(1, 10)], [], { cam: true }).skipped[0]?.why).toMatch(/corner cam/);
    expect(plan([pick(1, 10)], [], { camBox: true }).skipped[0]?.why).toMatch(/corner cam/);
    // No cam: "corner" is just the recording.
    expect(plan([pick(1, 10)]).windows).toHaveLength(1);
  });

  it("mattes the camera file in the cam layout, skips a window the layout changes in", () => {
    const cam: LayoutRange[] = [{ from: 0, to: 20, show: "cam" }];
    expect(plan([pick(1, 10)], cam, { cam: true }).windows[0]?.source).toBe("cam");
    const change: LayoutRange[] = [
      { from: 0, to: 10.5, show: "cam" },
      { from: 10.5, to: 20, show: "screen" },
    ];
    expect(plan([pick(1, 10)], change, { cam: true }).skipped[0]?.why).toMatch(/layout changes/);
  });

  it("merges windows of one source closer than 0.5 s, drops ones too close once cut", () => {
    // 10..11.6 then 12.3..: 0.7 s apart, past the gap, not merged.
    expect(plan([pick(1, 10), pick(2, 12.3)]).windows).toHaveLength(2);
    // 10..11.6 then 11.9: under 0.6 s after the one before.
    const close = plan([pick(1, 10), pick(2, 11.9)]);
    expect(close.windows).toHaveLength(1);
    expect(close.skipped).toEqual([{ i: 2, why: expect.stringMatching(/under 0.6s/) }]);
  });

  it("stops at the window limit", () => {
    const many = Array.from({ length: MATTE.max + 5 }, (_, k) => pick(k, k * 5));
    const r = plan(many, [], { durationS: 1000 });
    expect(r.windows).toHaveLength(MATTE.max);
    expect(r.skipped).toHaveLength(5);
    expect(r.skipped[0]?.why).toMatch(/over 40/);
  });

  it("names each file by what it holds", () => {
    const w = plan([pick(1, 10, 10.5)]).windows[0];
    expect(w && matteFile(w)).toBe("matte/main-300-51.webm");
  });
});

describe("rembg processing", () => {
  const plane = MATTE.size * MATTE.size;

  it("normalises by the frame's max pixel, then ImageNet mean and std, planar", () => {
    const rgb = new Uint8Array(plane * 3).fill(100);
    rgb[0] = 200; // the max: red of pixel 0 reads 1.0
    const x = toInput(rgb, new Float32Array(plane * 3));
    expect(x[0]).toBeCloseTo((1 - 0.485) / 0.229, 4);
    expect(x[1]).toBeCloseTo((0.5 - 0.485) / 0.229, 4);
    expect(x[plane]).toBeCloseTo((0.5 - 0.456) / 0.224, 4);
    expect(x[2 * plane]).toBeCloseTo((0.5 - 0.406) / 0.225, 4);
  });

  it("stretches the output min to max into an 8-bit mask", () => {
    const raw = new Float32Array(plane).fill(0.2);
    raw[0] = 0.1;
    raw[1] = 0.9;
    const m = toMask(raw, new Uint8Array(plane));
    expect([m[0], m[1], m[2]]).toEqual([0, 255, 32]);
  });

  it("encodes VP9 with alpha, the window's frames exactly, seeked half a frame early", () => {
    const a = encoderArgs(
      "cut.mp4",
      { n: 1, source: "main", fromFrame: 300, frames: 51, picks: [] },
      {
        fps: 30,
        width: 1920,
        height: 1080,
        out: "o.webm",
      },
    );
    expect(a.join(" ")).toContain("-ss 9.9833 -i cut.mp4");
    expect(a.join(" ")).toContain("alphamerge,format=yuva420p");
    expect(a.join(" ")).toContain("-frames:v 51");
    expect(a.join(" ")).toContain("-c:v libvpx-vp9");
    expect(a.join(" ")).toContain("alpha_mode=1");
  });
});
