import { DEFAULT_LOOK } from "@wren/video";
import { describe, expect, it } from "vitest";
import { captionShown, captionTrack } from "./finish.js";
import {
  CAPTION_LOOK,
  captionWordLook,
  cornerCam,
  longCaption,
  reelCaption,
  reelY,
} from "./finish-look.js";

describe("the look the render and the preview share", () => {
  it("draws in the render's colours and font", () => {
    expect(CAPTION_LOOK).toEqual({
      foreground: DEFAULT_LOOK.foreground,
      accent: DEFAULT_LOOK.accent,
      font: DEFAULT_LOOK.font,
    });
  });

  it("puts the corner camera 40 px from the bottom right of a 1080p frame, and scales it", () => {
    expect(cornerCam(1920, 1080)).toMatchObject({ left: 1540, top: 700, width: 340, height: 340 });
    const half = cornerCam(960, 540);
    expect(half).toMatchObject({ left: 770, top: 350, width: 170, borderRadius: 14 });
  });

  it("sizes the long line by the frame's height and places it where he put it", () => {
    const full = longCaption(1920, 1080, undefined, "f");
    expect(full.size).toBe(54);
    expect(full.box).toMatchObject({ justifyContent: "flex-end", paddingBottom: 90 });
    const small = longCaption(640, 360, 0.5, "f");
    expect(small.size).toBe(18);
    expect(small.box).toMatchObject({ top: 180 - 40, height: 80 });
  });

  it("shrinks a long Reels line and keeps it off the right edge", () => {
    expect(reelCaption(1080, 1267, 10, 18, "f").size).toBe(80);
    expect(reelCaption(1080, 1267, 36, 18, "f").size).toBe(48);
    const preview = reelCaption(270, 316, 10, 18, "f");
    expect(preview.size).toBe(20);
    expect(preview.box).toMatchObject({ left: 27, right: 40.5 });
    expect(reelY(1920, undefined)).toBe(1267);
    expect(reelY(1350, { short: 0.5 })).toBe(675);
  });

  it("draws a stressed word in the serif only in the stress style", () => {
    const st = {
      phase: "said",
      opacity: 1,
      scaleX: 1,
      scale: 1,
      clip: 0,
      fill: 0,
      fillScaleX: 1,
      lit: 1,
    } as const;
    expect(
      captionWordLook("stress", st, { stressed: true, size: 50, accent: "#000" }).word.font,
    ).toMatch(/^italic 800 70px/);
    expect(
      captionWordLook("word", st, { stressed: true, size: 50, accent: "#000" }).word.font,
    ).toBeUndefined();
    expect(
      captionWordLook("sweep", st, { stressed: false, size: 50, accent: "#000" }).fill,
    ).toBeDefined();
  });
});

describe("captionTrack", () => {
  const words = [
    { w: "One", s: 0, e: 0.4 },
    { w: "two", s: 0.5, e: 0.9, stress: true },
    { w: "three.", s: 1, e: 1.4 },
    { w: "Four", s: 5, e: 5.4 },
    { w: "five.", s: 5.5, e: 5.9 },
  ];

  it("breaks the long video into pages on the cut timeline, stress carried", () => {
    const track = captionTrack(
      words,
      [{ from: 2, to: 4.5, why: "manual", state: "cut" }],
      6,
      "long",
    );
    expect(track.lines.map((l) => l.words.map((w) => w.w).join(" "))).toEqual([
      "One two three.",
      "Four five.",
    ]);
    const at = captionShown(track, 0.6);
    expect(at?.words[1]).toMatchObject({ w: "two", stressed: true });
    expect(at?.end).toBeCloseTo(1.7);
    // Raw 5 s is 2.5 s on the cut.
    expect(captionShown(track, 5.1)?.t).toBeCloseTo(2.6);
    // Inside a cut is its edge on the cut (2 s): the first page's hold.
    expect(captionShown(track, 3)?.words[0]?.w).toBe("One");
  });

  it("shows nothing between pages", () => {
    const track = captionTrack(words, [], 6, "short");
    expect(captionShown(track, 3)).toBeNull();
  });
});
