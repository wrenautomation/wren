import { describe, expect, it } from "vitest";
import { checkPatch, editPatchSchema } from "./edit.js";
import { shortProps } from "./props.js";
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
