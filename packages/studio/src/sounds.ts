/**
 * Sound on the video (designs/2026-10-24-video-film-file.md, Decision 4): kit sounds at moments,
 * and one music bed that ducks under speech. Pure, so the worker's render hash reads the same
 * props as the Mac's render. The kit's files and manifest are `sfx/` (`kit.ts` reads them).
 *
 * Times on the edit are raw seconds, like every other part; the props move them onto each
 * output's clock, and a sound inside a cut-out pause is dropped, like a word.
 */
import { z } from "zod";
import { bedVolume, DUCK, dbToGain, duckAt } from "./duck.js";
import { FX, type Role, type Take } from "./fx.js";
import type { LayoutRange, Short, Word } from "./schema.js";

/**
 * The effects are earshot's `launch` kit (MIT, made in code; `sfx/make.mjs` renders it once into
 * `sfx/fx/`, listed in `fx.ts`). A sound id is a role (`click`, `whoosh.short`); each role has takes,
 * and the n-th sound of a role in an output plays take n (mod the takes). Music beds are `bed-<name>`
 * (the media bucket, `sfx/kit.json`).
 */
export type { Role };
export { bedVolume, DUCK, dbToGain, duckAt };
export const ROLES = Object.keys(FX) as Role[];
/** What each role is, for the edit pass and `wren video sfx list`. */
export const ROLE_SAYS = {
  tick: "an airy tick, in quick runs",
  "tick.crisp": "a brighter tick",
  tock: "a wooden knock, just before the cut",
  hit: "a short punchy hit on a cut",
  land: "a round low thump just after the cut, for a card or a panel landing",
  "land.light": "a light finger tap",
  pop: "a soft pop as a thing comes in; the most used",
  "whoosh.short": "a fast whoosh for a cut, a move or a zoom",
  "whoosh.long": "a big low whoosh that lands with a thump",
  riser: "a short dark riser into a cut; one or two a video at most",
  swell: "a dark reverse swell into a cut; one a video at most",
  drop: "a short low kick on a cut",
  key: "a key tap, a new take each",
  "key.space": "the space bar",
  "key.return": "the return key, a little louder",
  click: "a small plastic mouse click",
  "click.confirm": "a soft ding: done, sent, a number",
  snap: "a camera shutter for a snap zoom or a whip cut",
  bell: "a glockenspiel note",
  text: "a soft pluck as a line of text resolves",
} as const satisfies Record<Role, string>;
export const BED_ID = /^bed-[a-z0-9-]+$/;
export const isEffect = (id: string): id is Role => Object.hasOwn(FX, id);
/** Where a sound is in the public dir: a take `sfx/fx/<take>.ogg`, or a bed `sfx/<bed>.wav`. */
export const soundFile = (id: string) => (BED_ID.test(id) ? `sfx/${id}.wav` : `sfx/fx/${id}`);

/** The files that sound ids play: every take of a role, a bed's one file. */
export const kitFiles = (ids: Iterable<string>) => [
  ...new Set(
    [...ids].flatMap((id) =>
      isEffect(id) ? FX[id].takes.map((t) => soundFile(t.file)) : [soundFile(id)],
    ),
  ),
];

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
 * Mix levels, with the voice at -14 LUFS. Every bed file is at `BED_LUFS` (`wren video sfx add`
 * levels it). Under a voice the bed plays `BED_DB` down, and `DUCK.db` more under speech; in a
 * promo, with no voice, the music plays at `FX_BED_LUFS.music`. earshot sets each role `bedDb` over
 * that bed: the take's loudest 50 ms goes to `bed + overBed(bedDb)`, never past -1 dBFS at its peak.
 */
export const BED_LUFS = -14;
export const BED_DB = -16;
export const FX_BED_LUFS = { voice: BED_LUFS + BED_DB, music: -24 } as const;
const overBed = (db: number) => 10 * Math.log10(10 ** (db / 10) - 1);
/** The volume (0 to 1) of one take of a role over a bed, plus `gainDb`. */
export const takeVolume = (role: Role, take: Take, bed: number, gainDb = 0) => {
  const g = Math.min(bed + overBed(FX[role].bedDb) - take.l50, -1 - take.peakDb);
  return dbToGain(g + gainDb);
};

const sec = z.number().min(0);
const gain = z.number().min(-60).max(12);
export const soundsSchema = z
  .array(
    z
      .object({
        at: sec,
        id: z.string().refine(isEffect, { message: `a sound role, one of ${ROLES.join(", ")}` }),
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
  { on: "click", id: "click", says: "a small plastic click on each mouse click (Cap)" },
  { on: "key", id: "key", says: "a key tap on each key press (Cap), a new take each" },
  { on: "overlay", id: "pop", says: "a soft pop as each text overlay comes in" },
  {
    on: "layout",
    id: "whoosh.short",
    says: "a fast whoosh on each layout change (corner, cam, screen)",
  },
  {
    on: "card",
    id: "land",
    says: "a low pop-in thump under each Short's title card",
    only: "short",
  },
] as const satisfies readonly { on: string; id: Role; says: string; only?: "short" | "long" }[];

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Times at least `gap` seconds apart, in order: a run closer than its role allows is one sound. */
function spaced(ts: readonly number[], gap: number): number[] {
  const out: number[] = [];
  for (const t of [...ts].sort((a, b) => a - b)) {
    const last = out.at(-1);
    if (last === undefined || t - last >= gap) out.push(t);
  }
  return out;
}
const gapOf = (role: Role) => FX[role].gapMs / 1000;

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
    click: spaced(events.clicks, gapOf("click")),
    key: spaced(events.keys, gapOf("key")),
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

/**
 * A sound as a composition plays it: its file, its first frame, its volume (0 to 1+), and `trim`,
 * frames cut off its start (a take whose sync point is before the output's first frame).
 */
export type PlacedSound = { file: string; from: number; volume: number; trim?: number };

/**
 * Effects on one output's clock: `[t, id, gainDb]` (seconds). Each take's sync point lands on its
 * cue plus the role's offset (clicks lead, whoosh peaks land after); the n-th sound of a role plays
 * take n.
 */
export function placeEffects(
  cues: readonly (readonly [t: number, id: string, gainDb?: number | undefined])[],
  o: { fps: number; bed: number },
): PlacedSound[] {
  const n = new Map<Role, number>();
  return cues.flatMap(([t, id, gainDb]): PlacedSound[] => {
    if (!isEffect(id)) return [];
    const role = FX[id];
    const i = n.get(id) ?? 0;
    n.set(id, i + 1);
    const take = role.takes[i % role.takes.length] as Take;
    const start = Math.round((t + role.offsetMs / 1000 - take.sync) * o.fps);
    return [
      {
        file: soundFile(take.file),
        from: Math.max(0, start),
        volume: r3(takeVolume(id, take, o.bed, gainDb)),
        ...(start < 0 ? { trim: -start } : {}),
      },
    ];
  });
}
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
  const cues = sounds.flatMap((s): [number, string, number | undefined][] => {
    if (s.only && s.only !== o.which) return [];
    const t = o.clock(s.at);
    return t === null || t >= o.durationS ? [] : [[t, s.id, s.gainDb]];
  });
  const placed = placeEffects(
    cues.sort((a, b) => a[0] - b[0]),
    { fps: o.fps, bed: FX_BED_LUFS.voice },
  );
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
