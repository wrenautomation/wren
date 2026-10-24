/**
 * Sound on the video (designs/2026-10-24-video-film-file.md, Decision 4): kit sounds at moments,
 * and one music bed that ducks under speech. Pure, so the worker's render hash reads the same
 * props as the Mac's render. The kit's files and manifest are `sfx/` (`kit.ts` reads them).
 *
 * Times on the edit are raw seconds, like every other part; the props move them onto each
 * output's clock, and a sound inside a cut-out pause is dropped, like a word.
 */
import { z } from "zod";
import type { LayoutRange, Short, Word } from "./schema.js";

/** What a kit sound is for; a kit id is `<kind>-<n>`. */
export const SOUND_KINDS = [
  "click",
  "key",
  "pop",
  "ding",
  "error",
  "glitch",
  "hit",
  "swish",
  "whoosh",
  "riser",
  "boom",
  "bed",
] as const;
export type SoundKind = (typeof SOUND_KINDS)[number];

/**
 * The ids in the repo's kit (`sfx/kit.json`; `kit.test.ts` holds them equal), for the edit pass
 * prompt, which runs where the files are not. Bucket sounds are checked at render.
 */
export const KIT_IDS = [
  "boom-1",
  "click-1",
  "click-2",
  "click-3",
  "ding-1",
  "ding-2",
  "ding-3",
  "error-1",
  "glitch-1",
  "hit-1",
  "hit-2",
  "key-1",
  "key-2",
  "key-3",
  "pop-1",
  "pop-2",
  "pop-3",
  "riser-1",
  "swish-1",
  "whoosh-1",
  "whoosh-2",
] as const;

/** A kit id: a kind, a dash, a number or name (`click-1`, `bed-calm`). */
export const SOUND_ID = /^[a-z]+-[a-z0-9-]+$/;
/** Where a kit sound is in the public dir: every kit file is `sfx/<id>.wav`. */
export const soundFile = (id: string) => `sfx/${id}.wav`;
export const kindOf = (id: string) => id.split("-")[0] as SoundKind;

/** One sound at a moment. `only`: in the long video or the Shorts alone; unset: both. */
export interface Sound {
  at: number;
  id: string;
  gainDb?: number | undefined;
  only?: "long" | "short" | undefined;
}
/** The music bed: loops under the whole output, `duck` lowers it under speech. */
export interface Music {
  id: string;
  gainDb?: number | undefined;
  duck?: boolean | undefined;
}

/**
 * Mix levels in dB on files that peak at -6 dBFS (`sfx/build.sh`), with the voice at -14 LUFS:
 * effects near -24 LUFS, the bed near -30 and `DUCK.db` lower under speech. Ear-tuned; a sound's
 * own `gainDb` wins.
 */
export const GAIN_DB: Record<SoundKind, number> = {
  click: -12,
  key: -18,
  pop: -14,
  ding: -14,
  error: -14,
  glitch: -16,
  hit: -12,
  swish: -16,
  whoosh: -16,
  riser: -18,
  boom: -10,
  bed: -16,
};
/** Speech closer than `joinS` is one stretch; the bed falls over `attackS`, comes back over `releaseS`. */
export const DUCK = { db: 8, joinS: 0.6, attackS: 0.15, releaseS: 0.5 } as const;

const sec = z.number().min(0);
const gain = z.number().min(-60).max(12);
const kitId = (like: string) =>
  z
    .string()
    .regex(SOUND_ID, `a kit id like ${like}`)
    .refine((id) => (SOUND_KINDS as readonly string[]).includes(kindOf(id)), {
      message: `a kit id starts with a kind: ${SOUND_KINDS.join(", ")}`,
    });
export const soundsSchema = z
  .array(
    z
      .object({
        at: sec,
        id: kitId("click-1"),
        gainDb: gain.optional(),
        only: z.enum(["long", "short"]).optional(),
      })
      .strict(),
  )
  .max(2000);
export const musicSchema = z
  .object({
    id: kitId("bed-calm"),
    gainDb: gain.optional(),
    duck: z.boolean().optional(),
  })
  .strict()
  .nullable();

export const dbToGain = (db: number) => 10 ** (db / 20);

/** What a recording tells about its moments: Cap's clicks and key presses, raw seconds. */
export interface RecordingEvents {
  clicks: number[];
  keys: number[];
}

/**
 * The automatic sounds (Decision 4), one rule per row, the same for every edit. A rule names what
 * it reads from the edit, the kit sound and the outputs it is for. The edit pass and he may add or
 * remove; his `wren video set` of `sounds` locks them.
 */
export const SOUND_RULES = [
  { on: "click", id: "click-1", says: "a click on each mouse click (Cap)" },
  { on: "key", id: "key-1", says: "a key tap on each key press (Cap), at most one per 70 ms" },
  { on: "overlay", id: "pop-1", says: "a pop as each text overlay comes in" },
  { on: "layout", id: "swish-1", says: "a swish on each layout change (corner, cam, screen)" },
  { on: "card", id: "boom-1", says: "a low boom under each Short's title card", only: "short" },
] as const satisfies readonly { on: string; id: string; says: string; only?: "short" | "long" }[];

/** Key taps closer than this are one: fast typing would be a buzz. */
const KEY_GAP_S = 0.07;

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Times at least `gap` apart, in order. */
function spaced(ts: readonly number[], gap: number): number[] {
  const out: number[] = [];
  for (const t of [...ts].sort((a, b) => a - b)) {
    const last = out.at(-1);
    if (last === undefined || t - last >= gap) out.push(t);
  }
  return out;
}

/** Where the layout changes: each range's edges, but not the very start or end. */
function layoutChanges(layout: readonly LayoutRange[], durationS: number): number[] {
  const edges = layout
    .flatMap((l) => [l.from, l.to])
    .filter((t) => t > 0.05 && t < durationS - 0.05);
  return spaced(edges, 0.3);
}

/** The automatic sounds for an edit, by `SOUND_RULES`, in time order. */
export function autoSounds(
  edit: {
    tracks: { main: { durationS: number } };
    layout: readonly LayoutRange[];
    overlays?: readonly { from: number }[] | undefined;
    shorts: readonly Short[];
  },
  events: RecordingEvents = { clicks: [], keys: [] },
): Sound[] {
  const at: Record<(typeof SOUND_RULES)[number]["on"], number[]> = {
    click: spaced(events.clicks, 0.05),
    key: spaced(events.keys, KEY_GAP_S),
    overlay: (edit.overlays ?? []).map((o) => o.from),
    layout: layoutChanges(edit.layout, edit.tracks.main.durationS),
    card: edit.shorts.filter((s) => s.card !== false).map((s) => s.from),
  };
  return SOUND_RULES.flatMap((rule) =>
    at[rule.on].map(
      (t): Sound => ({ at: r3(t), id: rule.id, ...("only" in rule ? { only: rule.only } : {}) }),
    ),
  ).sort((a, b) => a.at - b.at);
}

/** A sound as a composition plays it: its file, its first frame and its volume (0 to 1+). */
export type PlacedSound = { file: string; from: number; volume: number };
export type AudioProps = {
  sounds: PlacedSound[];
  /** The bed: its file, its volume, and the speech it ducks under (seconds on the output's clock). */
  music: { file: string; volume: number; duck: [number, number][]; duckDb: number } | null;
};

/**
 * The edit's sounds and bed on one output's clock. `clock(t)`: a raw time on that clock, null
 * where it was cut out. `which`: the long family (long and the cropped formats) or a Short.
 */
export function audioOn(
  sounds: readonly Sound[],
  music: Music | null | undefined,
  o: {
    which: "long" | "short";
    clock: (raw: number) => number | null;
    words: readonly Pick<Word, "s" | "e">[];
    fps: number;
    durationS: number;
  },
): AudioProps {
  const placed = sounds.flatMap((s): PlacedSound[] => {
    if (s.only && s.only !== o.which) return [];
    const t = o.clock(s.at);
    if (t === null || t >= o.durationS) return [];
    const db = s.gainDb ?? GAIN_DB[kindOf(s.id)] ?? -16;
    return [{ file: soundFile(s.id), from: Math.round(t * o.fps), volume: r3(dbToGain(db)) }];
  });
  return {
    sounds: placed.sort((a, b) => a.from - b.from),
    music: music
      ? {
          file: soundFile(music.id),
          volume: r3(dbToGain(music.gainDb ?? GAIN_DB.bed)),
          duck: music.duck === false ? [] : speech(o.words),
          duckDb: DUCK.db,
        }
      : null,
  };
}

/** The stretches someone speaks: words closer than `DUCK.joinS` joined. */
export function speech(words: readonly Pick<Word, "s" | "e">[]): [number, number][] {
  const out: [number, number][] = [];
  for (const w of [...words].sort((a, b) => a.s - b.s)) {
    const last = out.at(-1);
    if (last && w.s - last[1] <= DUCK.joinS) last[1] = Math.max(last[1], w.e);
    else out.push([r3(w.s), r3(w.e)]);
  }
  return out.map(([s, e]) => [r3(s), r3(e)]);
}

/**
 * How far the bed is ducked at `t`, 0 (full) to 1 (all of `duckDb` down): down over `attackS`
 * before speech starts, back up over `releaseS` after it ends.
 */
export function duckAt(t: number, duck: readonly [number, number][]): number {
  let k = 0;
  for (const [s, e] of duck) {
    if (t >= s && t <= e) return 1;
    if (t < s && s - t < DUCK.attackS) k = Math.max(k, 1 - (s - t) / DUCK.attackS);
    if (t > e && t - e < DUCK.releaseS) k = Math.max(k, 1 - (t - e) / DUCK.releaseS);
  }
  return k;
}

/** The bed's volume at `t`: its level, less the duck. */
export const bedVolume = (m: NonNullable<AudioProps["music"]>, t: number) =>
  m.volume * dbToGain(-m.duckDb * duckAt(t, m.duck));
