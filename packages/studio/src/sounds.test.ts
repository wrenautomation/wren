import { describe, expect, it } from "vitest";
import { keepSegments } from "./cuts.js";
import type { Short } from "./schema.js";
import { audioOn, autoSounds, bedVolume, DUCK, dbToGain, duckAt, speech } from "./sounds.js";

const edit = (o: { shorts?: Partial<Short>[] } = {}) => ({
  tracks: { main: { durationS: 60 } },
  layout: [
    { from: 0, to: 10, show: "corner" as const },
    { from: 10, to: 20, show: "screen" as const },
    { from: 20, to: 60, show: "corner" as const },
  ],
  overlays: [{ from: 5 }],
  shorts: (o.shorts ?? [{ from: 30, to: 50, title: "A" }]) as Short[],
});

describe("automatic sounds", () => {
  it("puts one sound on each rule's moment, in time order", () => {
    const s = autoSounds(edit(), { clicks: [3, 3.01, 7], keys: [8, 8.03, 8.1] });
    expect(s).toEqual([
      { at: 3, id: "studio/press" },
      { at: 5, id: "studio/open" },
      { at: 7, id: "studio/press" },
      { at: 8, id: "studio/typing" },
      { at: 8.1, id: "studio/typing" },
      { at: 10, id: "studio/swipe" },
      { at: 20, id: "studio/swipe" },
      { at: 30, id: "studio/start", only: "short" },
    ]);
  });

  it("gives a Short with no card no boom", () => {
    const s = autoSounds(edit({ shorts: [{ from: 30, to: 50, title: "A", card: false }] }));
    expect(s.some((x) => x.id === "studio/start")).toBe(false);
  });
});

describe("sounds on an output's clock", () => {
  const keep = keepSegments([{ from: 4, to: 6, why: "silence", state: "cut" }], 60, 30);
  const o = (which: "long" | "short") => ({
    which,
    clock: (t: number) => {
      const k = keep.find((x) => t >= x.s && t < x.e);
      return k ? t - (k.s === 0 ? 0 : 2) : null;
    },
    words: [],
    fps: 30,
    durationS: 58,
  });

  it("moves each sound past the cuts and drops one inside a cut", () => {
    const a = audioOn(
      [
        { at: 3, id: "studio/press" },
        { at: 5, id: "studio/open" },
        { at: 10, id: "studio/start", only: "short" },
        { at: 12, id: "studio/success", gainDb: 0 },
      ],
      null,
      o("long"),
    );
    expect(a.sounds).toEqual([
      { file: "sfx/studio/press.ogg", from: 90, volume: 0.2 },
      { file: "sfx/studio/success.ogg", from: 300, volume: 0.23 },
    ]);
    expect(a.music).toBeNull();
  });

  it("ducks the bed under speech, unless told not to", () => {
    const words = [
      { s: 1, e: 1.4 },
      { s: 1.6, e: 2 },
      { s: 5, e: 5.5 },
    ];
    const a = audioOn([], { id: "bed-calm" }, { ...o("long"), words });
    expect(a.music?.duck).toEqual([
      [1, 2],
      [5, 5.5],
    ]);
    expect(a.music?.file).toBe("sfx/bed-calm.wav");
    const flat = audioOn([], { id: "bed-calm", duck: false }, { ...o("long"), words });
    expect(flat.music?.duck).toEqual([]);
  });
});

describe("the duck", () => {
  const duck: [number, number][] = [[2, 4]];
  it("falls before speech and comes back after it", () => {
    expect(duckAt(1, duck)).toBe(0);
    expect(duckAt(2 - DUCK.attackS / 2, duck)).toBeCloseTo(0.5);
    expect(duckAt(3, duck)).toBe(1);
    expect(duckAt(4 + DUCK.releaseS / 2, duck)).toBeCloseTo(0.5);
    expect(duckAt(5, duck)).toBe(0);
  });

  it("joins words closer than the join gap", () => {
    expect(
      speech([
        { s: 0, e: 1 },
        { s: 1.5, e: 2 },
        { s: 3, e: 4 },
      ]),
    ).toEqual([
      [0, 2],
      [3, 4],
    ]);
  });

  it("lowers the bed by the duck's dB under speech", () => {
    const m = { file: "sfx/bed-calm.wav", volume: 0.5, duck, duckDb: 8 };
    expect(bedVolume(m, 0)).toBeCloseTo(0.5);
    expect(bedVolume(m, 3)).toBeCloseTo(0.5 * dbToGain(-8));
  });
});
