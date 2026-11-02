import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { keepSegments } from "./cuts.js";
import {
  addCut,
  captionLines,
  cropCentre,
  cropsSchema,
  cropWindow,
  FRAME,
  formatFor,
  inOut,
  moveCutEdge,
  newOverlay,
  overlayAt,
  overlaySchema,
  overlaysOnCut,
  playFrom,
  rewriteLine,
  shortCrop,
  snapTime,
  trimCuts,
} from "./finish.js";
import { coverRect } from "./finish-look.js";
import { cutTracks, FPS, filmstrip, frameAt, probe, sourceProxy } from "./media.js";
import { verticalWindow } from "./props.js";
import type { Cut, Word } from "./schema.js";

const silence = (from: number, to: number): Cut => ({ from, to, why: "silence", state: "cut" });

describe("crop windows", () => {
  it("matches the 9:16 window it replaces", () => {
    expect(cropWindow(1920, 1080, FRAME.vertical)).toEqual(verticalWindow(1920, 1080));
    expect(cropWindow(1920, 1080, FRAME.vertical, { x: 1800 / 1920, y: 0.5 })).toEqual(
      verticalWindow(1920, 1080, 1800),
    );
    expect(cropWindow(720, 1280, FRAME.vertical)).toEqual(verticalWindow(720, 1280));
  });

  it("crops 1:1 and 4:5 and keeps the window inside the picture", () => {
    expect(cropWindow(1920, 1080, FRAME.square)).toEqual([420, 0, 1080, 1080]);
    expect(cropWindow(1920, 1080, FRAME.square, { x: 0, y: 0.5 })).toEqual([0, 0, 1080, 1080]);
    expect(cropWindow(1920, 1080, FRAME.portrait, { x: 1, y: 0.5 })).toEqual([1056, 0, 864, 1080]);
    // A portrait picture into 1:1: full width, moved down.
    expect(cropWindow(1080, 1920, FRAME.square, { x: 0.5, y: 1 })).toEqual([0, 840, 1080, 1080]);
  });

  it("answers the centre a drag really lands on", () => {
    expect(cropCentre(1920, 1080, FRAME.square, { x: 0.99, y: 0.1 })).toEqual({ x: 0.719, y: 0.5 });
  });
});

describe("a crop per Short", () => {
  it("keeps every older crops shape", () => {
    expect(cropsSchema.parse({})).toEqual({});
    expect(cropsSchema.parse({ vertical: { x: 0.2, y: 0.5 }, square: { x: 0.3, y: 0.4 } })).toEqual(
      {
        vertical: { x: 0.2, y: 0.5 },
        square: { x: 0.3, y: 0.4 },
      },
    );
    expect(
      cropsSchema.parse({ shorts: { "2": { x: 0.7, y: 0.5 } }, vertical: { x: 0.2, y: 0.5 } }),
    ).toEqual({ shorts: { "2": { x: 0.7, y: 0.5 } }, vertical: { x: 0.2, y: 0.5 } });
  });

  it("takes a Short by its number only", () => {
    for (const bad of ["0", "13", "two", "1.5", ""])
      expect(cropsSchema.safeParse({ shorts: { [bad]: { x: 0.5, y: 0.5 } } }).success).toBe(false);
    expect(cropsSchema.safeParse({ shorts: { "1": { x: 2, y: 0.5 } } }).success).toBe(false);
    expect(cropsSchema.safeParse({ shorts: { "1": { x: 0.5, y: 0.5, z: 1 } } }).success).toBe(
      false,
    );
  });

  it("falls back from its own crop to the vertical one to none", () => {
    const crops = { vertical: { x: 0.2, y: 0.5 }, shorts: { "2": { x: 0.8, y: 0.4 } } };
    expect(shortCrop(crops, 2)).toEqual({ x: 0.8, y: 0.4 });
    expect(shortCrop(crops, 1)).toEqual({ x: 0.2, y: 0.5 });
    expect(shortCrop({ square: { x: 0.1, y: 0.1 } }, 1)).toBeNull();
    expect(shortCrop(undefined, 1)).toBeNull();
  });
});

describe("a face in a frame", () => {
  it("covers the frame on the face box, or where a crop centres it", () => {
    // A 1080x1920 cam file, its whole picture in a 1080x960 box: scaled to the width.
    expect(coverRect([1080, 1920], null, 1080, 960)).toEqual([0, -480, 1080, 1920]);
    // A box in a wide recording: the box fills the frame.
    const [l, t, w, h] = coverRect([1920, 1080], [1200, 200, 400, 400], 1080, 960);
    expect([w, h]).toEqual([5184, 2916]);
    expect([l, t]).toEqual([(1080 - 1080) / 2 - 1200 * 2.7, (960 - 1080) / 2 - 200 * 2.7]);
    // A crop centres the frame on a point and stays inside the picture.
    expect(coverRect([1920, 1080], null, 1080, 1920, { x: 0.5, y: 0.5 })).toEqual([
      -(1920 * (1920 / 1080) - 1080) / 2,
      0,
      1920 * (1920 / 1080),
      1920,
    ]);
    const edge = coverRect([1920, 1080], null, 1080, 1920, { x: 0, y: 0.5 });
    expect(edge[0]).toBe(0);
    const far = coverRect([1920, 1080], null, 1080, 1920, { x: 1, y: 0.5 });
    expect(far[0]).toBeCloseTo(1080 - 1920 * (1920 / 1080));
  });
});

describe("trims and cut edges", () => {
  const dur = 10;
  it("sets in and out as his cuts, and takes them off again", () => {
    const cuts = [silence(4, 5)];
    const trimmed = trimCuts(cuts, dur, { in: 1.01, out: 8.5 });
    expect(trimmed).toEqual([
      { from: 0, to: 1, why: "manual", state: "cut" },
      silence(4, 5),
      { from: 8.5, to: 10, why: "manual", state: "cut" },
    ]);
    expect(inOut(trimmed, dur)).toEqual({ in: 1, out: 8.5 });
    expect(trimCuts(trimmed, dur, { in: 0, out: 10 })).toEqual(cuts);
  });

  it("moves a trim that a proposed silence cut started", () => {
    const head = trimCuts([silence(0, 0.6)], dur, { in: 2 });
    expect(head).toEqual([{ from: 0, to: 2, why: "manual", state: "cut" }]);
  });

  it("drags a cut's edge on the frame grid, never past its other edge", () => {
    const cuts: Cut[] = [{ from: 2, to: 3, why: "filler", state: "proposed" }];
    expect(moveCutEdge(cuts, 0, "from", 1.512, dur)[0]).toEqual({
      from: 1.5,
      to: 3,
      why: "filler",
      state: "cut",
    });
    expect(moveCutEdge(cuts, 0, "to", 1, dur)[0]?.to).toBeCloseTo(2 + 1 / FPS, 6);
    expect(addCut([], 5, 4, dur)).toEqual([{ from: 4, to: 5, why: "manual", state: "cut" }]);
  });

  it("snaps to a word edge when close, else the frame", () => {
    const words = [{ s: 1.0, e: 1.4 }];
    expect(snapTime(1.05, words, dur)).toBe(1);
    expect(snapTime(2.017, words, dur)).toBeCloseTo(2.033, 3);
    expect(snapTime(12, words, dur)).toBe(10);
  });

  it("plays over a cut", () => {
    const keep = keepSegments([silence(2, 3)], dur);
    expect(playFrom(2.5, keep)).toBe(3);
    expect(playFrom(1, keep)).toBe(1);
    expect(playFrom(10, keep)).toBeNull();
  });
});

describe("text on the video", () => {
  it("moves onto the cut timeline and drops one inside a cut", () => {
    const keep = keepSegments([silence(2, 4)], 10);
    const at = newOverlay(5, 10, "Hi");
    expect(overlaysOnCut([at, { ...at, from: 2.2, to: 3.8 }], keep)).toEqual([
      { ...at, from: 3, to: 6 },
    ]);
  });

  it("fades in and out, sized by the frame", () => {
    const o = { text: "Hi", from: 1, to: 3, x: 0.5, y: 0.25, size: "m" as const };
    expect(overlayAt(o, 0.9, 1080, 1920)).toBeNull();
    expect(overlayAt(o, 3, 1080, 1920)).toBeNull();
    const mid = overlayAt(o, 2, 1080, 1920);
    expect(mid).toMatchObject({ x: 540, y: 480, size: 70, opacity: 1 });
    expect((overlayAt(o, 1.05, 1080, 1920)?.opacity ?? 1) < 1).toBe(true);
  });

  it("refuses text too long, off the frame or too short", () => {
    const ok = { text: "Hi", from: 1, to: 2, x: 0.5, y: 0.5, size: "s" };
    expect(overlaySchema.safeParse(ok).success).toBe(true);
    expect(overlaySchema.safeParse({ ...ok, text: "x".repeat(121) }).success).toBe(false);
    expect(overlaySchema.safeParse({ ...ok, x: 1 }).success).toBe(false);
    expect(overlaySchema.safeParse({ ...ok, to: 1.1 }).success).toBe(false);
  });
});

describe("caption lines", () => {
  const words: Word[] = [
    { w: "We", s: 0, e: 0.2 },
    { w: "ship", s: 0.2, e: 0.5 },
    { w: "today.", s: 0.5, e: 0.9 },
    { w: "Then", s: 2, e: 2.2 },
    { w: "rest.", s: 2.2, e: 2.6 },
  ];

  it("breaks as the render does, named by word and timed raw", () => {
    const lines = captionLines(words, [silence(1, 1.8)], 3);
    expect(lines.map((l) => l.text)).toEqual(["We ship today.", "Then rest."]);
    expect(lines[1]).toMatchObject({ at: [3, 4], s: 2, e: 2.6 });
  });

  it("rewrites a line word for word, or spread over its span", () => {
    expect(rewriteLine(words, [0, 1, 2], "We shipped today.").map((w) => w.w)).toEqual([
      "We",
      "shipped",
      "today.",
      "Then",
      "rest.",
    ]);
    const spread = rewriteLine(words, [3, 4], "Then we rest.");
    expect(spread.slice(3)).toEqual([
      // By length: "Then " is 5 of the 14 characters.
      { w: "Then", s: 2, e: 2.214 },
      { w: "we", s: 2.214, e: 2.343 },
      { w: "rest.", s: 2.343, e: 2.6 },
    ]);
    expect(() => rewriteLine(words, [3, 4], "  ")).toThrow(/needs words/);
    expect(() => rewriteLine(words, [1, 3], "x")).toThrow(/isn't in/);
  });
});

describe("which render a platform takes", () => {
  it("picks the feed shape first, then falls back", () => {
    const all = new Set(["vertical", "square", "portrait"]);
    expect(formatFor("instagram", all)).toBe("vertical");
    expect(formatFor("linkedin", all)).toBe("portrait");
    expect(formatFor("linkedin", new Set(["square", "vertical"]))).toBe("square");
    expect(formatFor("x", all)).toBe("square");
    expect(formatFor("facebook", new Set(["vertical"]))).toBe("vertical");
    expect(formatFor("tiktok", new Set(["square"]))).toBeNull();
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** The middle pixel of a picture, or of frame `n` of a video, as [r, g, b]. */
function rgb(file: string, n?: number): number[] {
  const ss = n ? ["-ss", String((n - 0.5) / FPS)] : [];
  const out = execFileSync("ffmpeg", [
    ...["-v", "error", ...ss, "-i", file],
    ...["-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
  ]);
  return [...out.subarray(0, 3)];
}
const colour = ([r, g, b]: number[]) =>
  (r as number) > 150 && (g as number) < 90 && (b as number) < 90
    ? "red"
    : (g as number) > 100 && (r as number) < 90 && (b as number) < 90
      ? "green"
      : (b as number) > 150 && (r as number) < 90 && (g as number) < 90
        ? "blue"
        : `other ${[r, g, b]}`;

// A tiny synthetic clip: one second each of red, green and blue at 30 fps, with a tone. The colour
// changes at frames 30 and 60, so a frame off by one reads as the wrong colour.
describe.skipIf(!hasFfmpeg)("finishing media from a synthetic clip", () => {
  const dir = mkdtempSync(join(tmpdir(), "finish-"));
  const clip = join(dir, "clip.mp4");
  // In a hook: a skipped describe's body still runs, and CI has no ffmpeg.
  beforeAll(() => {
    execFileSync("ffmpeg", [
      ...["-v", "error", "-y"],
      ...["-f", "lavfi", "-i", "color=c=red:s=320x180:r=30:d=1"],
      ...["-f", "lavfi", "-i", "color=c=green:s=320x180:r=30:d=1"],
      ...["-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=1"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:duration=3"],
      ...["-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a"],
      ...["-c:v", "libx264", "-g", "90", "-pix_fmt", "yuv420p", "-c:a", "aac", clip],
    ]);
  });

  it("makes a playback copy on the frame grid that seeks to the exact frame", async () => {
    const out = await sourceProxy(clip, join(dir, "source.mp4"), "ffmpeg");
    const t = await probe(out, "ffmpeg");
    expect(t.height).toBe(540);
    expect(t.durationS).toBeCloseTo(3, 1);
    expect(colour(rgb(out, 29))).toBe("red");
    expect(colour(rgb(out, 30))).toBe("green");
    expect(colour(rgb(out, 60))).toBe("blue");
  });

  it("grabs the exact cover frame", async () => {
    expect(colour(rgb(await frameAt(clip, 59 / FPS, join(dir, "a.jpg"), "ffmpeg")))).toBe("green");
    expect(colour(rgb(await frameAt(clip, 60 / FPS, join(dir, "b.jpg"), "ffmpeg")))).toBe("blue");
  });

  it("makes the filmstrip in one picture", async () => {
    const out = await filmstrip(clip, join(dir, "strip.jpg"), 3, "ffmpeg");
    const t = await probe(out, "ffmpeg");
    expect([t.width, t.height]).toEqual([1600, 540]);
  });

  it("trims to the exact frames through the cut pass", async () => {
    const main = { ...(await probe(clip, "ffmpeg")), path: clip };
    // In at frame 30 (green), out at frame 75 (blue), the frames between 40 and 50 cut.
    const cuts = trimCuts(addCut([], 40 / FPS, 50 / FPS, 3), 3, { in: 1, out: 2.5 });
    const keep = keepSegments(cuts, 3, FPS);
    const { cutMain } = await cutTracks({ main }, keep, dir, "ffmpeg");
    const t = await probe(cutMain as string, "ffmpeg");
    expect(Math.round(t.durationS * FPS)).toBe(35);
    expect(colour(rgb(cutMain as string, 0))).toBe("green");
    expect(colour(rgb(cutMain as string, 34))).toBe("blue");
  });
});
