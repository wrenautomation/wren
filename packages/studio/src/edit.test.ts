import { describe, expect, it } from "vitest";
import { checkPatch, editPatchSchema, formatsFor } from "./edit.js";
import { longProps, shortProps, verticalProps, verticalWindow } from "./props.js";
import type { Cut, VideoEdit } from "./schema.js";

const short = (from: number, to: number) => ({ from, to, title: "t" });
const check = (shorts: ReturnType<typeof short>[], cuts: Cut[] = []) =>
  checkPatch(editPatchSchema.parse({ shorts }), 300, cuts);

describe("shorts check", () => {
  it("takes none, or 2 to 4 of 20 to 60 s", () => {
    expect(check([])).toEqual([]);
    expect(check([short(0, 20), short(100, 160)])).toEqual([]);
    expect(check([short(0, 30), short(40, 70), short(80, 110), short(120, 150)])).toEqual([]);
  });

  it("refuses 1 or 5 picks", () => {
    expect(check([short(0, 30)])).toEqual(["shorts: 1 picked; want 2 to 4"]);
    expect(check([0, 1, 2, 3, 4].map((i) => short(i * 40, i * 40 + 30)))[0]).toMatch(/5 picked/);
  });

  it("refuses under 20 s or over 60 s", () => {
    expect(check([short(0, 19), short(30, 91)])).toEqual([
      "shorts[0]: 19.0s once cut; want 20 to 60",
      "shorts[1]: 61.0s once cut; want 20 to 60",
    ]);
  });

  it("measures after the cuts, the patch's own cuts first", () => {
    const cut: Cut = { from: 5, to: 15, why: "silence", state: "cut" };
    // 30 s raw, 20 s once the 10 s cut is out: fine; 25 s raw becomes 15 s: refused.
    expect(check([short(0, 30), short(100, 130)], [cut])).toEqual([]);
    expect(check([short(0, 25), short(100, 130)], [cut])).toEqual([
      "shorts[0]: 15.0s once cut; want 20 to 60",
    ]);
    const patch = editPatchSchema.parse({ shorts: [short(0, 25), short(100, 130)], cuts: [] });
    expect(checkPatch(patch, 300, [cut])).toEqual([]);
    // A proposed cut is not applied, so it does not shorten the clip.
    expect(check([short(0, 25), short(100, 130)], [{ ...cut, state: "proposed" }])).toEqual([]);
  });
});

describe("shortProps", () => {
  it("moves the clip onto the cut timeline and its words to its start", () => {
    const edit = {
      id: 1,
      title: "v",
      tracks: { main: { path: "/m.mp4", durationS: 100, width: 1920, height: 1080, fps: 30 } },
      cuts: [{ from: 10, to: 20, why: "silence", state: "cut" }],
      words: [
        { w: "before", s: 5, e: 6 },
        { w: "in", s: 31, e: 32 },
      ],
      layout: [],
      captions: { on: true, style: "word" },
      shorts: [short(30, 60)],
      files: { cutMain: "/d/cut-main.mp4" },
    } as unknown as VideoEdit;
    const p = shortProps(edit, 1);
    expect(p.startFrame).toBe(20 * 30);
    expect(p.durationInFrames).toBe(30 * 30);
    expect(p.words).toEqual([{ w: "in", s: 1, e: 2 }]);
    expect(p.face.file).toBeNull();
    expect(() => shortProps(edit, 2)).toThrow(/no 2/);
  });
});

describe("formats", () => {
  it("defaults by the recording's shape", () => {
    expect(formatsFor({ width: 1920, height: 1080 })).toEqual(["long"]);
    expect(formatsFor({ width: 1080, height: 1920 })).toEqual(["vertical"]);
    expect(formatsFor({ width: 1080, height: 1080 })).toEqual(["long"]);
  });

  it("set takes one or both, each once", () => {
    expect(editPatchSchema.parse({ formats: ["long", "vertical"] }).formats).toEqual([
      "long",
      "vertical",
    ]);
    expect(editPatchSchema.safeParse({ formats: [] }).success).toBe(false);
    expect(editPatchSchema.safeParse({ formats: ["long", "long"] }).success).toBe(false);
    expect(editPatchSchema.safeParse({ formats: ["square"] }).success).toBe(false);
  });
});

describe("verticalProps", () => {
  const edit = (tracks: object, files: object) =>
    ({
      id: 1,
      title: "v",
      tracks,
      cuts: [],
      words: [],
      layout: [],
      captions: { on: true, style: "word" },
      shorts: [],
      files,
    }) as unknown as VideoEdit;
  const track = (width: number, height: number) => ({
    path: "/m.mp4",
    durationS: 10,
    width,
    height,
    fps: 30,
  });

  it("fills the frame with a portrait recording", () => {
    const p = verticalProps(edit({ main: track(720, 1280) }, { cutMain: "/d/cut-main.mp4" }));
    expect(p.picture).toEqual({
      file: "cut-main.mp4",
      size: [1080, 1920],
      window: [0, 0, 1080, 1920],
    });
  });

  it("crops a landscape one 9:16 on the cam box, else the centre, inside the frame", () => {
    expect(verticalWindow(1920, 1080)).toEqual([656, 0, 608, 1080]);
    expect(verticalWindow(1920, 1080, 1800)).toEqual([1312, 0, 608, 1080]);
    const boxed = verticalProps(
      edit(
        { main: track(3840, 2160), camBox: [3200, 1600, 480, 480] },
        { cutMain: "/d/cut-main.mp4" },
      ),
    );
    // The box (1600..1840 at 1080p) is near the right edge: the window stops at it.
    expect(boxed.picture.window).toEqual([1312, 0, 608, 1080]);
  });

  it("takes the camera file when there is one, the recording still the sound", () => {
    const p = verticalProps(
      edit(
        { main: track(1920, 1080), cam: { ...track(1280, 720), offsetS: 0 } },
        { cutMain: "/d/cut-main.mp4", cutCam: "/d/cut-cam.mp4" },
      ),
    );
    expect(p.main).toBe("cut-main.mp4");
    expect(p.picture.file).toBe("cut-cam.mp4");
    expect(p.picture.window).toEqual([656, 0, 608, 1080]);
  });
});

describe("captions and stress (step 6)", () => {
  it("takes a style from the list and behind on or off", () => {
    expect(editPatchSchema.parse({ captions: { on: true, style: "pill", behind: true } })).toEqual({
      captions: { on: true, style: "pill", behind: true },
    });
    expect(editPatchSchema.safeParse({ captions: { on: true, style: "neon" } }).success).toBe(
      false,
    );
    expect(editPatchSchema.safeParse({ stress: [1.5] }).success).toBe(false);
  });

  /** A word every 0.4 s, a sentence every 5 words. */
  const words = Array.from({ length: 100 }, (_, i) => ({
    w: i % 5 === 4 ? `w${i}.` : `w${i}`,
    s: i * 0.4,
    e: i * 0.4 + 0.3,
  }));

  it("refuses a stressed word that's cut, or too close once cut", () => {
    const check = (stress: number[], cuts: Cut[] = []) =>
      checkPatch(editPatchSchema.parse({ stress }), 40, cuts, words);
    expect(check([2, 20])).toEqual([]);
    const cut = (from: number, to: number) => ({ from, to, why: "silence", state: "cut" }) as Cut;
    expect(check([2, 20], [cut(0.7, 1.1)])[0]).toMatch(/is cut/);
    // Cutting 1.6..7.6 brings word 20 (8.0 s) right after word 2 (0.8 s).
    expect(check([2, 20], [cut(1.6, 7.6)])[0]).toMatch(/under 0.6s.*once cut/);
    expect(check([2, 500])[0]).toMatch(/no word 500/);
  });

  it("puts the stressed words behind only where a matte holds them", () => {
    const edit = {
      id: 1,
      title: "v",
      tracks: { main: { path: "/m.mp4", durationS: 40, width: 1920, height: 1080, fps: 30 } },
      cuts: [{ from: 0, to: 1, why: "silence", state: "cut" }],
      words,
      layout: [],
      captions: { on: true, style: "stress", behind: true },
      stress: [5, 20],
      shorts: [],
      files: { cutMain: "/d/cut-main.mp4" },
    } as unknown as VideoEdit;
    const matte = { n: 1, source: "main" as const, fromFrame: 30, frames: 45, picks: [5] };
    const p = longProps(edit, [{ ...matte, file: "matte/main-30-45.webm" }]);
    // Words 0..2 are cut: word 5 is index 2 on the cut, word 20 index 17.
    expect(p.stress).toEqual([2, 17]);
    expect(p.behind).toEqual([
      {
        w: "w5",
        s: 1,
        e: 1.3,
        to: 2.5,
        matte: { file: "matte/main-30-45.webm", src: "cut-main.mp4", fromFrame: 30, frames: 45 },
        // No zone: the usual spot.
        place: { text: "w5", x: 960, y: 430, size: 260 },
      },
    ]);
    // He fills the whole frame: nothing reads, so the word is skipped and reported.
    const skipped: string[] = [];
    const full = { grid: 4, occ: "1".repeat(16) };
    const none = longProps(edit, [{ ...matte, file: "matte/main-30-45.webm", zone: full }], {
      skip: (w, format) => skipped.push(`${w.w}@${w.s} ${format}`),
    });
    expect(none.behind).toEqual([]);
    expect(skipped).toEqual(["w5@1 long"]);
    expect(longProps({ ...edit, captions: { on: true, style: "stress" } }, [])).toMatchObject({
      behind: [],
    });
  });
});
