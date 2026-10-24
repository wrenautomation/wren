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

/**
 * The effects are uisfx (npm `uisfx`, CC0 audio): 12 styles, each with the same 78 cues. A sound id
 * is `<style>/<cue>` (`studio/press`), its file `sfx/<style>/<cue>.ogg`. `kit.ts` copies the files
 * in from the package.
 */
export const STYLES = [
  "minimal",
  "soft",
  "glass",
  "arcade",
  "mechanical",
  "organic",
  "dreamy",
  "scifi",
  "rubber",
  "cinematic",
  "studio",
  "zen",
] as const;
export type Style = (typeof STYLES)[number];
/** The style the rules and promos play. One line to change it for every new edit. */
export const STYLE: Style = "studio";

/**
 * Each cue and its volume (0 to 1), from the uisfx manifest: the same cue has the same volume in
 * every style. `kit.test.ts` holds this equal to the manifest; the edit pass reads it where the
 * package is not.
 */
export const CUES = {
  hover: 0.12,
  press: 0.2,
  release: 0.18,
  "double-click": 0.2,
  focus: 0.12,
  "long-press": 0.18,
  select: 0.2,
  deselect: 0.17,
  "toggle-on": 0.2,
  "toggle-off": 0.18,
  check: 0.17,
  uncheck: 0.15,
  delete: 0.22,
  cancel: 0.17,
  undo: 0.18,
  redo: 0.18,
  copy: 0.15,
  paste: 0.17,
  open: 0.18,
  close: 0.17,
  back: 0.17,
  forward: 0.17,
  expand: 0.16,
  collapse: 0.15,
  "drag-start": 0.18,
  drop: 0.22,
  snap: 0.2,
  swipe: 0.14,
  reorder: 0.18,
  "invalid-drop": 0.19,
  send: 0.2,
  receive: 0.2,
  notification: 0.2,
  mention: 0.22,
  typing: 0.065,
  reaction: 0.17,
  success: 0.23,
  error: 0.22,
  warning: 0.22,
  info: 0.16,
  blocked: 0.2,
  retry: 0.18,
  start: 0.19,
  stop: 0.19,
  "progress-step": 0.12,
  complete: 0.24,
  queued: 0.14,
  checkpoint: 0.18,
  loading: 0.1,
  processing: 0.08,
  recording: 0.09,
  connecting: 0.09,
  scanning: 0.075,
  streaming: 0.07,
  play: 0.18,
  pause: 0.17,
  seek: 0.13,
  "volume-change": 0.11,
  "skip-next": 0.16,
  "skip-previous": 0.16,
  connect: 0.2,
  disconnect: 0.19,
  lock: 0.2,
  unlock: 0.2,
  wake: 0.17,
  sleep: 0.15,
  reward: 0.22,
  "level-up": 0.25,
  achievement: 0.26,
  streak: 0.21,
  badge: 0.22,
  bonus: 0.24,
  "add-to-cart": 0.19,
  "remove-from-cart": 0.17,
  checkout: 0.2,
  purchase: 0.22,
  coupon: 0.18,
  refund: 0.2,
} as const;
export type Cue = keyof typeof CUES;

/** An effect id, `<style>/<cue>`; or a music bed, `bed-<name>` (the media bucket, `sfx/kit.json`). */
export const EFFECT_ID = /^([a-z]+)\/([a-z0-9-]+)$/;
export const BED_ID = /^bed-[a-z0-9-]+$/;
const cueOf = (id: string) => EFFECT_ID.exec(id)?.[2] as Cue | undefined;
export const isEffect = (id: string) => {
  const m = EFFECT_ID.exec(id);
  return !!m && (STYLES as readonly string[]).includes(m[1] as string) && (m[2] as string) in CUES;
};
/** Where a sound is in the public dir: `sfx/<style>/<cue>.ogg`, or `sfx/<bed>.wav`. */
export const soundFile = (id: string) => `sfx/${id}.${BED_ID.test(id) ? "wav" : "ogg"}`;

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
 * Mix levels, with the voice at -14 LUFS: an effect plays at its cue's volume (uisfx files peak
 * near -7.5 dBFS), plus its own `gainDb`. The bed sits at `BED_DB` and `DUCK.db` lower under speech.
 */
export const BED_DB = -16;
export const effectVolume = (id: string, gainDb = 0) =>
  (CUES[cueOf(id) as Cue] ?? 0.2) * dbToGain(gainDb);
/** Speech closer than `joinS` is one stretch; the bed falls over `attackS`, comes back over `releaseS`. */
export const DUCK = { db: 8, joinS: 0.6, attackS: 0.15, releaseS: 0.5 } as const;

const sec = z.number().min(0);
const gain = z.number().min(-60).max(12);
export const soundsSchema = z
  .array(
    z
      .object({
        at: sec,
        id: z.string().refine(isEffect, {
          message: `a sound id <style>/<cue>, like ${STYLE}/press; style one of ${STYLES.join(", ")}`,
        }),
        gainDb: gain.optional(),
        only: z.enum(["long", "short"]).optional(),
      })
      .strict(),
  )
  .max(2000);
export const musicSchema = z
  .object({
    id: z.string().regex(BED_ID, "a bed id like bed-calm"),
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
  { on: "click", id: `${STYLE}/press`, says: "a press on each mouse click (Cap)" },
  {
    on: "key",
    id: `${STYLE}/typing`,
    says: "a key tap on each key press (Cap), at most one per 70 ms",
  },
  { on: "overlay", id: `${STYLE}/open`, says: "an open as each text overlay comes in" },
  {
    on: "layout",
    id: `${STYLE}/swipe`,
    says: "a swipe on each layout change (corner, cam, screen)",
  },
  {
    on: "card",
    id: `${STYLE}/start`,
    says: "a start under each Short's title card",
    only: "short",
  },
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
    const volume = r3(effectVolume(s.id, s.gainDb));
    return [{ file: soundFile(s.id), from: Math.round(t * o.fps), volume }];
  });
  return {
    sounds: placed.sort((a, b) => a.from - b.from),
    music: music
      ? {
          file: soundFile(music.id),
          volume: r3(dbToGain(music.gainDb ?? BED_DB)),
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
