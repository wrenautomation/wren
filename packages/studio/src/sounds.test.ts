import { describe, expect, it } from "vitest";
import { keepSegments } from "./cuts.js";
import { FX, type FxRole, type Take } from "./fx.js";
import type { Short } from "./schema.js";
import {
  audioOn,
  autoSounds,
  bedVolume,
  DUCK,
  dbToGain,
  duckAt,
  FX_BED_LUFS,
  placeEffects,
  speech,
  takeVolume,
} from "./sounds.js";

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
    // Clicks closer than 85 ms and keys closer than 87 ms are one sound (the kit's run gaps).
    const s = autoSounds(edit(), { clicks: [3, 3.05, 7], keys: [8, 8.05, 8.1] });
    expect(s).toEqual([
      { at: 3, id: "click" },
      { at: 5, id: "pop" },
      { at: 7, id: "click" },
      { at: 8, id: "key" },
      { at: 8.1, id: "key" },
      { at: 10, id: "whoosh.short" },
      { at: 20, id: "whoosh.short" },
      { at: 30, id: "land", only: "short" },
    ]);
  });

  it("gives a Short with no card no boom", () => {
    const s = autoSounds(edit({ shorts: [{ from: 30, to: 50, title: "A", card: false }] }));
    expect(s.some((x) => x.id === "land")).toBe(false);
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
        { at: 3, id: "click" },
        { at: 5, id: "pop" },
        { at: 10, id: "land", only: "short" },
        { at: 12, id: "click", gainDb: -6 },
      ],
      null,
      o("long"),
    );
    expect(a.sounds.map((s) => [s.file, s.from])).toEqual([
      ["sfx/fx/click_1.ogg", 90],
      ["sfx/fx/click_2.ogg", 300],
    ]);
    expect(a.sounds[1]?.volume).toBeCloseTo(
      takeVolume("click", take(FX.click, 1), FX_BED_LUFS.voice, -6),
      3,
    );
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

const take = (r: FxRole, i: number) => r.takes[i] as Take;

describe("placing a take", () => {
  it("lands each take's sync point on its cue plus the role's offset", () => {
    const fps = 1000;
    const [w] = placeEffects([[2, "whoosh.short"]], { fps, bed: -24 });
    const t0 = take(FX["whoosh.short"], 0);
    // A whoosh is aligned on its peak, 37 ms after the cut.
    expect(w?.from).toBe(Math.round((2 + 0.037 - t0.sync) * fps));
    expect(w?.file).toBe(`sfx/fx/${t0.file}`);
  });

  it("plays a new take for each sound of a role, round", () => {
    const n = FX.key.takes.length;
    const keys = placeEffects(
      Array.from({ length: n + 1 }, (_, i) => [i, "key"] as const),
      { fps: 30, bed: -30 },
    );
    expect(keys.map((k) => k.file)).toEqual(
      [...FX.key.takes, FX.key.takes[0]].map((t) => `sfx/fx/${t?.file}`),
    );
  });

  it("trims a take whose sync point falls before the first frame", () => {
    // The riser peaks 0.7 s in: on a cue at 0.2 s its first frames are cut.
    const [r] = placeEffects([[0.2, "riser"]], { fps: 30, bed: -24 });
    expect(r?.from).toBe(0);
    expect(r?.trim).toBeGreaterThan(10);
  });

  it("sets each take over the bed by its role, never past -1 dBFS", () => {
    const t0 = take(FX.pop, 0);
    const db = 20 * Math.log10(takeVolume("pop", t0, -24));
    expect(t0.l50 + db).toBeCloseTo(-24 + 10 * Math.log10(10 ** (FX.pop.bedDb / 10) - 1), 5);
    expect(t0.peakDb + 20 * Math.log10(takeVolume("pop", t0, 0))).toBeCloseTo(-1, 5);
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
