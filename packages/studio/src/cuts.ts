/**
 * Cuts he can trust (designs/2026-10-06-video-editor.md). Pure and deterministic: no model, so the
 * same words, silences, samples and knobs give the same list. A silence cut needs the transcript
 * (no word) and the audio (silencedetect) to agree; air stays on each side of a word, and each
 * edge snaps inward to the quietest 20 ms, so a cut never lands inside a word.
 */
import { z } from "zod";
import type { Cut, Word } from "./schema.js";

export const cutKnobsSchema = z.object({
  /** Shortest silence (both signals) that is cut. */
  minGapS: z.number().min(0.3).max(10).default(0.7),
  /** Kept on each side of a word. */
  airS: z.number().min(0.05).max(2).default(0.2),
  /** silencedetect's threshold: this many dB over the track's measured noise floor. */
  noiseMarginDb: z.number().min(3).max(40).default(12),
  /** How far inward an edge may move to find the quietest 20 ms. */
  snapS: z.number().min(0).max(0.5).default(0.1),
});
export type CutKnobs = z.infer<typeof cutKnobsSchema>;
export const CUT_DEFAULTS: CutKnobs = cutKnobsSchema.parse({});

const FRAME_S = 0.02;
/** A cut longer than this gets a look in `wren video cuts`. */
export const LONG_CUT_S = 2;
/** A cut edge this close to a word counts as touching it. */
const TOUCH_S = 0.05;

export interface Span {
  s: number;
  e: number;
}

/** Mono samples in [-1, 1] at `rate`. */
export interface Pcm {
  samples: Float32Array;
  rate: number;
}

const prefixSquares = (x: Float32Array): Float64Array => {
  const p = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) p[i + 1] = (p[i] as number) + (x[i] as number) ** 2;
  return p;
};

/**
 * The silence threshold for this track: its noise floor (the 10th percentile of 20 ms frame peaks,
 * in dBFS) plus the margin, kept within -70..-20 dB so digital silence or a hot room stays sane.
 * Peaks, not RMS: silencedetect tests each sample, and room noise peaks well over its RMS.
 */
export function noiseThresholdDb(pcm: Pcm, marginDb: number): number {
  const n = Math.round(FRAME_S * pcm.rate);
  const dbs: number[] = [];
  for (let i = 0; i + n <= pcm.samples.length; i += n) {
    let peak = 0;
    for (let j = i; j < i + n; j++) peak = Math.max(peak, Math.abs(pcm.samples[j] as number));
    dbs.push(20 * Math.log10(Math.max(peak, 1e-6)));
  }
  dbs.sort((a, b) => a - b);
  const floor = dbs.length ? (dbs[Math.floor(dbs.length * 0.1)] as number) : -90;
  return Math.min(-20, Math.max(-70, Math.max(floor, -90) + marginDb));
}

/** The centre of the quietest 20 ms window inside [lo, hi]; ties go to the earliest. */
export function quietest(pcm: Pcm, sq: Float64Array, lo: number, hi: number): number {
  const n = Math.round(FRAME_S * pcm.rate);
  const a = Math.max(0, Math.round(lo * pcm.rate));
  const b = Math.min(pcm.samples.length, Math.round(hi * pcm.rate));
  if (b - a < n) return (lo + hi) / 2;
  const step = Math.max(1, Math.round(pcm.rate / 1000));
  let best = a;
  let bestE = Number.POSITIVE_INFINITY;
  for (let i = a; i + n <= b; i += step) {
    const e = (sq[i + n] as number) - (sq[i] as number);
    if (e < bestE - 1e-12) {
      bestE = e;
      best = i;
    }
  }
  return (best + n / 2) / pcm.rate;
}

/**
 * whisper stretches the word next to a pause across it. Where a word starts or ends inside a
 * detected silence, its sound is the loud side, so that edge moves to the silence's edge. A word
 * wholly inside a silence (soft speech) or around one stays as it is, so it still blocks a cut.
 */
export function fitWords(words: readonly Word[], silences: readonly Span[]): Word[] {
  return words.map((w) => {
    let { s, e } = w;
    for (const q of silences) {
      const startsIn = s >= q.s - TOUCH_S && s < q.e;
      const endsIn = e > q.s && e <= q.e + TOUCH_S;
      if (startsIn && !endsIn && q.e < e) s = q.e;
      else if (endsIn && !startsIn && q.s > s) e = q.s;
    }
    return s === w.s && e === w.e ? w : { ...w, s: round3(s), e: round3(e) };
  });
}

/** Where no word is: before the first, between each pair, after the last. */
export function transcriptGaps(words: readonly Word[], durationS: number): Span[] {
  const sorted = [...words].sort((a, b) => a.s - b.s);
  const gaps: Span[] = [];
  let at = 0;
  for (const w of sorted) {
    if (w.s > at) gaps.push({ s: at, e: w.s });
    at = Math.max(at, w.e);
  }
  if (durationS > at) gaps.push({ s: at, e: durationS });
  return gaps;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * The silence pass. A cut is where a transcript gap and a detected silence overlap for at least
 * `minGapS`, less `airS` on each side that touches speech (not at the file's ends), each such edge
 * snapped inward to the quietest 20 ms within `snapS`.
 */
export function silenceCuts(
  words: readonly Word[],
  silences: readonly Span[],
  pcm: Pcm,
  durationS: number,
  knobs: CutKnobs = CUT_DEFAULTS,
): Cut[] {
  const sq = prefixSquares(pcm.samples);
  const cuts: Cut[] = [];
  for (const g of transcriptGaps(words, durationS))
    for (const q of silences) {
      const s = Math.max(g.s, q.s);
      const e = Math.min(g.e, q.e);
      if (e - s < knobs.minGapS) continue;
      const atStart = s <= 0.001;
      const atEnd = e >= durationS - 0.001;
      let from = atStart ? 0 : s + knobs.airS;
      let to = atEnd ? durationS : e - knobs.airS;
      const reach = Math.min(knobs.snapS, (to - from) / 4);
      if (!atStart) from = quietest(pcm, sq, from, from + reach);
      if (!atEnd) to = quietest(pcm, sq, to - reach, to);
      if (to - from >= FRAME_S)
        cuts.push({ from: round3(from), to: round3(to), why: "silence", state: "cut" });
    }
  return cuts.filter((c) => !words.some((w) => w.s < c.to && w.e > c.from));
}

const FILLERS = /^(u+m+|u+h+|e+r+m+|h+m+|a+h+|uhm)$/i;

/** Ums and uhs Whisper did write, as proposals: nothing applies until accepted. */
export function fillerProposals(words: readonly Word[]): Cut[] {
  return words
    .filter((w) => FILLERS.test(w.w.replace(/[^\p{L}]/gu, "")))
    .map((w) => ({ from: round3(w.s), to: round3(w.e), why: "filler", state: "proposed" }));
}

/** Silence cuts from a fresh pass, with every non-silence cut kept as it was; sorted. */
export function withSilence(existing: readonly Cut[], silence: readonly Cut[]): Cut[] {
  return [...existing.filter((c) => c.why !== "silence"), ...silence].sort(
    (a, b) => a.from - b.from || a.to - b.to,
  );
}

/**
 * What stays, on the raw timeline: the gaps between applied cuts, each edge on the output frame
 * grid so audio and video stay the same length through every cut.
 */
export function keepSegments(cuts: readonly Cut[], durationS: number, fps = 30): Span[] {
  const q = (x: number) => Math.round(x * fps) / fps;
  const applied = cuts
    .filter((c) => c.state === "cut")
    .map((c) => ({ s: q(c.from), e: q(c.to) }))
    .sort((a, b) => a.s - b.s);
  const out: Span[] = [];
  let at = 0;
  for (const c of applied) {
    if (c.s > at) out.push({ s: at, e: c.s });
    at = Math.max(at, c.e);
  }
  const end = q(durationS);
  if (end > at) out.push({ s: at, e: end });
  return out.filter((k) => k.e - k.s >= 1 / fps);
}

/** A raw time on the cut timeline; null when it was cut. */
export function toCutTime(t: number, keep: readonly Span[]): number | null {
  let before = 0;
  for (const k of keep) {
    if (t < k.s) return null;
    if (t <= k.e) return before + (t - k.s);
    before += k.e - k.s;
  }
  return null;
}

/** A raw time on the cut timeline; a time inside a cut lands where the next kept part starts. */
export function onCut(t: number, keep: readonly Span[]): number {
  let before = 0;
  for (const k of keep) {
    if (t <= k.e) return before + Math.max(0, t - k.s);
    before += k.e - k.s;
  }
  return before;
}

/** A cut-timeline time back on the raw timeline. */
export function fromCutTime(t: number, keep: readonly Span[]): number {
  let before = 0;
  for (const k of keep) {
    if (t <= before + (k.e - k.s)) return k.s + (t - before);
    before += k.e - k.s;
  }
  return keep.at(-1)?.e ?? t;
}

export interface CutRow {
  n: number;
  cut: Cut;
  lengthS: number;
  before: string;
  after: string;
  flags: string[];
}

/** The review list: each cut with the words either side, its length, and why it needs a look. */
export function reviewCuts(cuts: readonly Cut[], words: readonly Word[]): CutRow[] {
  return cuts.map((cut, i) => {
    const before = words.filter((w) => w.e <= cut.from + TOUCH_S).slice(-4);
    const after = words.filter((w) => w.s >= cut.to - TOUCH_S).slice(0, 4);
    const flags: string[] = [];
    const lengthS = round3(cut.to - cut.from);
    if (lengthS > LONG_CUT_S) flags.push("long");
    // A filler or retake cut holds its words; it touches the ones beside it.
    const inside = (w: Word) => w.s >= cut.from && w.e <= cut.to && cut.why !== "silence";
    if (words.some((w) => !inside(w) && w.s < cut.to + TOUCH_S && w.e > cut.from - TOUCH_S))
      flags.push("touches a word");
    return {
      n: i + 1,
      cut,
      lengthS,
      before: before.map((w) => w.w).join(" "),
      after: after.map((w) => w.w).join(" "),
      flags,
    };
  });
}
