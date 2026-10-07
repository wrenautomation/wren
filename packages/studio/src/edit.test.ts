import { describe, expect, it } from "vitest";
import { checkPatch, editPatchSchema, formatsFor } from "./edit.js";
import { shortProps, verticalProps, verticalWindow } from "./props.js";
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
