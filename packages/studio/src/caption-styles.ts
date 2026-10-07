/**
 * Adapted from heygen-com/hyperframes `registry/components/caption-pill-karaoke` (pill),
 * `caption-highlight` (sweep), `caption-emoji-pop` (pop), `caption-clip-wipe` (wipe) and
 * `caption-editorial-emphasis` (stress) @5c7f631 (Apache-2.0); changed: GSAP tweens rewritten as
 * pure easing of the time since a word starts; one word state for every style instead of a
 * timeline per component; no emoji, keyword colours or exits; `pop` squeezes each word in (theirs
 * pops the group); `pill` is dark with white said words; our line breakers group the words.
 * See packages/studio/NOTICE.
 *
 * Caption styles (designs/2026-10-06-video-editor.md, step 6): how one caption word looks at a time.
 * Pure, on the frame clock: every value is a function of the seconds since the word started, so any
 * frame renders alone. The Remotion entry draws what these answer.
 */

export const CAPTION_STYLES = ["word", "pill", "sweep", "pop", "wipe", "stress"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

/** The caption settings on the edit. `behind`: stressed words drawn behind the speaker. */
export interface Captions {
  on: boolean;
  style: string;
  behind?: boolean | undefined;
}

export const isCaptionStyle = (s: string): s is CaptionStyle =>
  (CAPTION_STYLES as readonly string[]).includes(s);

/** Seconds each style's entrance takes, from their components. */
export const ENTRY_S = {
  /** pill: the said colour fades in this long, starting `pillLead` early. */
  pill: 0.1,
  pillLead: 0.05,
  /** sweep: the accent grows in behind the word; it fades out this long from the word's end. */
  sweep: 0.15,
  sweepOut: 0.1,
  /** pop: 4 frames at 30 fps. */
  pop: 4 / 30,
  wipe: 0.3,
  stress: 0.1,
} as const;

/** Unsaid wipe words, and words done saying in wipe, sit at this opacity. */
export const DIM = 0.5;

export const power2Out = (x: number) => 1 - (1 - x) ** 2;
export const power3Out = (x: number) => 1 - (1 - x) ** 3;
export const power2In = (x: number) => x * x;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 0 before `from`, 1 after `from + dur`, eased between. */
const ease = (t: number, from: number, dur: number, f: (x: number) => number) =>
  f(clamp01((t - from) / dur));

export type Phase = "before" | "entering" | "said" | "done";

export interface WordState {
  phase: Phase;
  /** The word's own opacity. */
  opacity: number;
  /** Horizontal squeeze (pop), 1 = none. */
  scaleX: number;
  /** Whole-word scale (stress's settle), 1 = none. */
  scale: number;
  /** How much of the word is clipped from the right (wipe), 0 = all shown. */
  clip: number;
  /** The accent behind the word: its opacity and horizontal grow from the left. */
  fill: number;
  fillScaleX: number;
  /** 0 = the unsaid colour, 1 = the said colour (pill), mixed between. */
  lit: number;
}

const BASE: Omit<WordState, "phase"> = {
  opacity: 1,
  scaleX: 1,
  scale: 1,
  clip: 0,
  fill: 0,
  fillScaleX: 1,
  lit: 1,
};

/**
 * One word at `t`. `w` is the word's own span; `until` is when the next word of its line starts
 * (or the line ends), so a word stays "said" through a pause. `first`: the line's first word,
 * which pill shows lit from the line's start.
 */
export function wordState(
  style: string,
  w: { s: number; e: number },
  t: number,
  until: number,
  o: { first?: boolean } = {},
): WordState {
  const entry = style in ENTRY_S ? ENTRY_S[style as keyof typeof ENTRY_S] : 0;
  const phase: Phase =
    t < w.s ? "before" : t < w.s + entry ? "entering" : t < Math.max(until, w.s) ? "said" : "done";
  switch (style) {
    case "pill": {
      // Karaoke: unsaid words grey; each turns white as it's said and stays white.
      const lit = o.first ? 1 : ease(t, w.s - ENTRY_S.pillLead, ENTRY_S.pill, (x) => x);
      return { ...BASE, phase, lit };
    }
    case "sweep": {
      // The accent grows in from the left at the word's start and fades at its end.
      const grow = ease(t, w.s, ENTRY_S.sweep, power2Out);
      const fade = ease(t, w.e, ENTRY_S.sweepOut, power2In);
      const on = t >= w.s && t < w.e + ENTRY_S.sweepOut;
      return {
        ...BASE,
        phase,
        fill: on ? grow * (1 - fade) : 0,
        fillScaleX: on ? grow + 0.02 * fade : 0,
      };
    }
    case "pop": {
      // Hidden until said, then squeezes in from 70% width.
      const p = ease(t, w.s, ENTRY_S.pop, power3Out);
      return { ...BASE, phase, opacity: p, scaleX: 0.7 + 0.3 * p };
    }
    case "wipe": {
      // Wipes in left to right as it's said; dims once the next word starts.
      const p = ease(t, w.s, ENTRY_S.wipe, power2Out);
      const dim = ease(t, until, 0.2, (x) => x);
      return { ...BASE, phase, clip: 1 - p, opacity: 1 - (1 - DIM) * dim };
    }
    case "stress": {
      // Each word fades in and settles from 112% as it's said; the words stay as the line fills.
      const p = ease(t, w.s, ENTRY_S.stress, power2Out);
      return { ...BASE, phase, opacity: p, scale: 1.12 - 0.12 * p };
    }
    default: {
      // word: the said word on the accent, from its start until the next word starts.
      const on = t >= w.s && t < Math.max(until, w.e);
      return { ...BASE, phase, fill: on ? 1 : 0 };
    }
  }
}

/**
 * The big word behind the speaker: in from its start (opacity and a settle from 115%, power3), out
 * over the last 0.3 s of its window. Same frame clock as the captions.
 */
export function bigWordState(
  t: number,
  s: number,
  end: number,
): { opacity: number; scale: number } {
  if (t < s || t >= end) return { opacity: 0, scale: 1 };
  const inP = ease(t, s, 0.25, power3Out);
  const outP = ease(t, end - 0.3, 0.3, power2In);
  return { opacity: inP * (1 - outP), scale: 1.15 - 0.15 * inP + 0.04 * outP };
}
