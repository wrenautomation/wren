/**
 * A film's facts (designs/2026-10-25-competitor-analyzer.md, Read): the cut count the detectors
 * agree on, how long its shots run, where the cuts cluster, and each shot. Code counts; the
 * labels a shot needs a person for (`type`, `move`, `in`) stay null until vision proves itself
 * against the hand seed (`designs/studies/2026-10-25-launch-films.json`). The same numbers come
 * from a hand shot list, so a seed film and a read one compare on one rule.
 */
import type { WatchFacts } from "@wrenautomation/scribe/video";
import { z } from "zod";
import {
  CUTS_TRUSTS,
  type CutsTrust,
  SHOT_INS,
  SHOT_MOVES,
  SHOT_SOUNDS,
  SHOT_SRCS,
  SHOT_TYPES,
} from "./schema.js";

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export const shotSchema = z.object({
  /** Seconds in. */
  t: z.number().min(0),
  len: z.number().min(0),
  src: z.enum(SHOT_SRCS),
  type: z.enum(SHOT_TYPES).nullable(),
  move: z.enum(SHOT_MOVES).nullable(),
  in: z.enum(SHOT_INS).nullable(),
  /** The text on screen, when read. */
  text: z.string().nullable(),
  sound: z.enum(SHOT_SOUNDS).nullable(),
  note: z.string().optional(),
});
export type Shot = z.infer<typeof shotSchema>;

export const filmFactsSchema = z.object({
  duration_s: z.number().min(0),
  /** Shots less one: hand-counted on a hand film, else the hash detector's. */
  cuts: z.number().int().min(0),
  /** Each detector's count, the evidence for `cuts_trust`. */
  cuts_by_signal: z.record(z.string(), z.number().int().min(0)),
  cuts_trust: z.enum(CUTS_TRUSTS),
  shot_median_s: z.number().min(0),
  shot_p90_s: z.number().min(0),
  /** Cuts in each 10 s of the film, first to last. */
  cuts_per_10s: z.array(z.number().int().min(0)),
  first_product_s: z.number().min(0).nullable(),
  logo_s: z.number().min(0).nullable(),
  cta_s: z.number().min(0).nullable(),
  cta: z.string().nullable().optional(),
  music: z.boolean().nullable(),
  vo: z.boolean().nullable(),
  shots: z.array(shotSchema),
});
export type FilmFacts = z.infer<typeof filmFactsSchema>;

/** A breakdown's shots, when its facts hold a valid list; else none. */
export function filmShots(facts: unknown): Shot[] {
  const list = (facts as { shots?: unknown } | null)?.shots;
  if (!Array.isArray(list)) return [];
  return list.flatMap((s) => {
    const ok = shotSchema.safeParse(s);
    return ok.success ? [ok.data] : [];
  });
}

/** Shots from a cut list: the first starts at 0, the last ends at the film's end. */
export function shotsOf(cuts: readonly number[], durationS: number): Shot[] {
  const starts = [0, ...cuts.filter((c) => c > 0 && c < durationS)];
  return starts.map((t, i) => ({
    t: r2(t),
    len: r2((starts[i + 1] ?? durationS) - t),
    src: "scene",
    type: null,
    move: null,
    in: null,
    text: null,
    sound: null,
  }));
}

/** The shot lengths' median and 90th percentile (nearest rank), and the cuts in each 10 s. */
export function shotStats(shots: readonly Shot[], durationS: number) {
  const lens = shots.map((s) => s.len).sort((a, b) => a - b);
  const at = (q: number) => lens[Math.min(lens.length - 1, Math.round(q * (lens.length - 1)))] ?? 0;
  const median =
    lens.length % 2
      ? at(0.5)
      : ((lens[lens.length / 2 - 1] ?? 0) + (lens[lens.length / 2] ?? 0)) / 2;
  const per10 = Array.from({ length: Math.max(1, Math.ceil(durationS / 10)) }, () => 0);
  for (const s of shots.slice(1)) {
    const i = Math.min(per10.length - 1, Math.floor(s.t / 10));
    per10[i] = (per10[i] ?? 0) + 1;
  }
  return {
    shot_median_s: r1(median),
    shot_p90_s: r1(at(0.9)),
    cuts_per_10s: per10,
  };
}

/**
 * Whether the count holds: against a hand count, hash within 20% of it; with none, hash and
 * adaptive within 2x of each other. ffmpeg's `scene` is kept as evidence, never in the vote (it
 * finds no cut on a dark film).
 */
export function cutsTrust(hash: number, adaptive: number, handCuts?: number | null): CutsTrust {
  if (handCuts != null) return Math.abs(hash - handCuts) <= 0.2 * handCuts ? "ok" : "low";
  if (!hash || !adaptive) return "low";
  return Math.max(hash, adaptive) / Math.min(hash, adaptive) <= 2 ? "ok" : "low";
}

/** The facts of a film the Mac read: the hash detector's shots, no labels. `vo` is whether anyone spoke. */
export function filmFacts(w: WatchFacts, o: { speech: boolean }): FilmFacts {
  const hash = w.cuts_by.hash ?? [];
  const adaptive = w.cuts_by.adaptive ?? [];
  const shots = shotsOf(hash, w.duration_s);
  return {
    duration_s: r1(w.duration_s),
    cuts: shots.length - 1,
    cuts_by_signal: {
      hash: hash.length,
      adaptive: adaptive.length,
      ffmpeg: w.cuts_by.ffmpeg.length,
    },
    cuts_trust: cutsTrust(hash.length, adaptive.length),
    ...shotStats(shots, w.duration_s),
    first_product_s: null,
    logo_s: null,
    cta_s: null,
    music: null,
    vo: o.speech,
    shots,
  };
}

/** One film of the seed study, as its JSON holds it. */
export const seedFilmSchema = z.object({
  url: z.string().url(),
  slug: z.string().min(1),
  brand: z.string().min(1),
  rival: z.boolean(),
  duration_s: z.number().min(0),
  cuts_by_signal: z.record(z.string(), z.number().int().min(0)),
  first_product_s: z.number().min(0).nullable(),
  logo_s: z.number().min(0).nullable(),
  cta_s: z.number().min(0).nullable(),
  cta: z.string().nullable(),
  /** Null on a cuts-only film: nobody looked. */
  hook: z.string().nullable(),
  music: z.boolean().nullable(),
  vo: z.boolean().nullable(),
  /** `hand` when a person labelled its shots; anything else is cuts only. */
  labels: z.string(),
  shots: z.array(shotSchema).min(1),
});
export type SeedFilm = z.infer<typeof seedFilmSchema>;
/** The study file: `{ study, method, films }`; only the films are read. */
export const seedStudySchema = z.object({ films: z.array(seedFilmSchema) });

/** A seed film's facts on the same rule as a read one: its own shots, the numbers recomputed from them. */
export function seedFilmFacts(f: SeedFilm): FilmFacts {
  const hand = f.labels === "hand";
  const signal = (k: string) => f.cuts_by_signal[k] ?? 0;
  const hash = signal("pyscenedetect_hash") || signal("hash");
  const adaptive = signal("pyscenedetect_adaptive") || signal("adaptive");
  const ffmpeg = signal("ffmpeg_scene_0.25") || signal("ffmpeg");
  const cuts = f.shots.length - 1;
  return {
    duration_s: r1(f.duration_s),
    cuts,
    cuts_by_signal: { hash, adaptive, ffmpeg },
    cuts_trust: cutsTrust(hash, adaptive, hand ? cuts : null),
    ...shotStats(f.shots, f.duration_s),
    first_product_s: f.first_product_s,
    logo_s: f.logo_s,
    cta_s: f.cta_s,
    cta: f.cta,
    music: f.music,
    vo: f.vo,
    shots: f.shots,
  };
}
