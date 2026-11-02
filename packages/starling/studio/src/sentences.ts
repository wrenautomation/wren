/**
 * Shorts that start and end on whole sentences (William, 2026-10-14: "as long as they start and
 * end on coherent sentences"). A transcript with punctuation ends a sentence on `.`, `?` or `!`.
 * One without (some Whisper runs) ends one at a pause or a filler, never after a word that can't
 * close a sentence ("the", "to", "and") or before one that can't open it ("of", "is"). Pure: the
 * same words, cuts and Shorts give the same answer, so it runs on every write.
 */
import { keepSegments, onCut, type Span, toCutTime } from "./cuts.js";
import { FPS } from "./media.js";
import { SHORT_S } from "./props.js";
import type { Cut, Short, Word } from "./schema.js";

export const SENTENCE = {
  /** No punctuation: a pause this long (Whisper's stretched word edges counted) ends a sentence. */
  pauseS: 0.6,
  /** How far a Short's end may move to find a sentence edge. */
  reachS: 20,
  /** Air kept before the first word and after the last, inside the gap to the next word. */
  padS: 0.15,
  /** An edge this far into a neighbouring word still counts as clear of it. */
  slackS: 0.05,
} as const;

const END = /[.?!…]["'”’)\]]*$/;
const FILLER = /^(u+m+|u+h+|e+r+m+|h+m+|m+h*m+|a+h+)$/;
const NO_END = new Set(
  (
    "a an the to of and or but nor i my your our their his her its is are was were be been am " +
    "with for in on at from by into onto as than that's it's i'm you're we're they're if because " +
    "which who whose where when while would could should will can just very really this these " +
    "those some any every no not so want gonna going have has had do does get make about what how"
  ).split(" "),
);
const NO_START = new Set("to of are is was were than been be am".split(" "));

const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
const isFiller = (w: Word) => FILLER.test(bare(w.w));
/** About how long a word takes to say; Whisper often stretches one over the pause beside it. */
const natural = (w: Word) => 0.12 + 0.075 * bare(w.w).length;
const stretch = (w: Word) => Math.max(0, w.e - w.s - natural(w));

/** The words that play (not under an applied cut), in order. */
export function keptWords(words: readonly Word[], keep: readonly Span[]): Word[] {
  return words.filter((w) => toCutTime((w.s + w.e) / 2, keep) !== null);
}

/**
 * Where sentences start and end, as indexes into `words` (the words that play). A filler is never
 * a start or an end: the sentence ends before it and the next starts after it.
 */
export function sentenceEdges(words: readonly Word[]): { starts: Set<number>; ends: Set<number> } {
  const punctuated = words.some((w) => END.test(w.w.trim()));
  const ends = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as Word;
    if (isFiller(w)) continue;
    let j = i + 1;
    while (j < words.length && isFiller(words[j] as Word)) j++;
    const next = words[j];
    if (!next) ends.add(i);
    else if (punctuated) {
      // "right, um." ends on "right": the stop can sit on the filler.
      if (words.slice(i, j).some((x) => END.test(x.w.trim()))) ends.add(i);
    } else if (!NO_END.has(bare(w.w)) && !NO_START.has(bare(next.w))) {
      const pause = next.s - w.e + stretch(w) + 0.5 * stretch(next);
      if (j > i + 1 || pause >= SENTENCE.pauseS) ends.add(i);
    }
  }
  const starts = new Set<number>();
  const startAfter = (i: number) => {
    let j = i + 1;
    while (j < words.length && isFiller(words[j] as Word)) j++;
    if (j < words.length) starts.add(j);
  };
  startAfter(-1);
  for (const i of ends) startAfter(i);
  return { starts, ends };
}

/** The words a span holds: by their middles, like `clipWords` and the Short's captions. */
function inside(words: readonly Word[], from: number, to: number): [number, number] | null {
  const f = words.findIndex((w) => (w.s + w.e) / 2 >= from);
  let l = -1;
  for (let i = words.length - 1; i >= 0; i--)
    if (((words[i] as Word).s + (words[i] as Word).e) / 2 < to) {
      l = i;
      break;
    }
  return f < 0 || l < f ? null : [f, l];
}

type Edges = ReturnType<typeof sentenceEdges>;

/** Whisper can overlap two words; an edge between them then sits on the word's own edge. */
const clearBefore = (words: readonly Word[], f: number, from: number) => {
  const w = words[f] as Word;
  return (
    from >= Math.min(words[f - 1]?.e ?? 0, w.s) - SENTENCE.slackS && from <= w.s + SENTENCE.slackS
  );
};
const clearAfter = (words: readonly Word[], l: number, to: number, durationS: number) => {
  const w = words[l] as Word;
  return (
    to <= Math.max(words[l + 1]?.s ?? durationS, w.e) + SENTENCE.slackS &&
    to >= w.e - SENTENCE.slackS
  );
};

/** What's wrong with one span's edges, in words he reads; [] when it opens and closes on sentences. */
function spanIssues(
  words: readonly Word[],
  edges: Edges,
  s: { from: number; to: number },
  durationS: number,
): string[] {
  const span = inside(words, s.from, s.to);
  if (!span) return ["holds no words"];
  const [f, l] = span;
  const near = (a: number, b: number) =>
    words
      .slice(Math.max(0, a), b)
      .map((w) => w.w)
      .join(" ");
  const out: string[] = [];
  if (!edges.starts.has(f) || !clearBefore(words, f, s.from))
    out.push(`starts mid-sentence ("${near(f - 3, f)} | ${near(f, f + 3)}")`);
  if (!edges.ends.has(l) || !clearAfter(words, l, s.to, durationS))
    out.push(`ends mid-sentence ("${near(l - 2, l + 1)} | ${near(l + 1, l + 4)}")`);
  return out;
}

export interface EditWords {
  words: readonly Word[];
  cuts: readonly Cut[];
  durationS: number;
}

/**
 * Each Short that doesn't open and close on a sentence, as `shorts[i]: why`; `only` limits the
 * ones looked at. No words: none.
 */
export function shortIssues(
  e: EditWords,
  shorts: readonly Pick<Short, "from" | "to">[],
  only: (s: Pick<Short, "from" | "to">, i: number) => boolean = () => true,
): string[] {
  if (!e.words.length) return [];
  const keep = keepSegments(e.cuts, e.durationS, FPS);
  const words = keptWords(e.words, keep);
  const edges = sentenceEdges(words);
  return shorts.flatMap((s, i) =>
    only(s, i) ? spanIssues(words, edges, s, e.durationS).map((why) => `shorts[${i}]: ${why}`) : [],
  );
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * One Short moved to the nearest sentence start and end (least total movement) that keeps it 20
 * to 60 s once cut. An edge already on a sentence keeps its time. Unchanged when nothing fits
 * within `reachS`: the check then refuses it.
 */
function snapOne(
  words: readonly Word[],
  edges: Edges,
  keep: readonly Span[],
  s: Short,
  durationS: number,
): Short {
  const span = inside(words, s.from, s.to);
  if (!span) return s;
  const [f, l] = span;
  const startAt = (j: number) =>
    j === f && clearBefore(words, f, s.from)
      ? s.from
      : r2(
          Math.min(
            (words[j] as Word).s,
            Math.max(words[j - 1]?.e ?? 0, (words[j] as Word).s - SENTENCE.padS),
          ),
        );
  const endAt = (i: number) =>
    i === l && clearAfter(words, l, s.to, durationS)
      ? s.to
      : r2(
          Math.max(
            (words[i] as Word).e,
            Math.min(words[i + 1]?.s ?? durationS, (words[i] as Word).e + SENTENCE.padS),
          ),
        );
  const starts = [...edges.starts]
    .map((j) => ({ j, t: startAt(j) }))
    .filter((c) => Math.abs(c.t - s.from) <= SENTENCE.reachS);
  const ends = [...edges.ends]
    .map((i) => ({ i, t: endAt(i) }))
    .filter((c) => Math.abs(c.t - s.to) <= SENTENCE.reachS);
  let best: { from: number; to: number; cost: number } | null = null;
  for (const a of starts)
    for (const b of ends) {
      if (b.i < a.j) continue;
      const len = onCut(b.t, keep) - onCut(a.t, keep);
      if (len < SHORT_S.min || len > SHORT_S.max) continue;
      const cost = Math.abs(a.t - s.from) + Math.abs(b.t - s.to);
      if (!best || cost < best.cost) best = { from: a.t, to: b.t, cost };
    }
  return best ? { ...s, from: best.from, to: best.to } : s;
}

export interface Moved {
  /** 1-based, as the CLI and the page name Shorts. */
  n: number;
  /** Seconds each edge moved (negative: earlier). */
  from: number;
  to: number;
}

/**
 * Every Short snapped to whole sentences (`snapOne`), with the ones that moved. No words (not
 * transcribed yet): unchanged.
 */
export function snapShorts(
  e: EditWords,
  shorts: readonly Short[],
): { shorts: Short[]; moved: Moved[] } {
  if (!e.words.length) return { shorts: [...shorts], moved: [] };
  const keep = keepSegments(e.cuts, e.durationS, FPS);
  const words = keptWords(e.words, keep);
  const edges = sentenceEdges(words);
  const out = shorts.map((s) => snapOne(words, edges, keep, s, e.durationS));
  const moved = out.flatMap((s, i) => {
    const was = shorts[i] as Short;
    return s.from !== was.from || s.to !== was.to
      ? [{ n: i + 1, from: r2(s.from - was.from), to: r2(s.to - was.to) }]
      : [];
  });
  return { shorts: out, moved };
}
