/**
 * Reels-style caption lines (designs/2026-10-06-video-editor.md, step 5), for the vertical video
 * and Shorts: 2 to 4 words a line, one line on screen at a time. A line ends at a sentence end or a
 * pause; inside a phrase it breaks where it reads best (a comma, a small pause, never after "the"
 * or "to"). A line shows from its first word until a beat after its last, never past the speech.
 * Pure: the Remotion entry imports it as a `.ts` file.
 */
import type { Word } from "./schema.js";

/** How words are grouped into lines: Reels on screen, subtitles in the CC track. */
export interface LineRules {
  minWords: number;
  maxWords: number;
  maxChars: number;
  /** What each character past `maxChars` costs a line (one more line costs 1). */
  overCost: number;
  /** A gap this long ends the line, whatever the words. */
  pauseS: number;
  /** A gap this long is a good place to break inside a phrase. */
  softPauseS: number;
  /** How long a line stays after its last word, if the next doesn't start first. */
  holdS: number;
}

export const REEL: LineRules = {
  minWords: 2,
  maxWords: 4,
  /** About what one line holds at 80 px bold on the 810 px the captions get. */
  maxChars: 18,
  overCost: 1,
  /** A gap this long ends the line, whatever the words. */
  pauseS: 0.45,
  /** A gap this long is a good place to break inside a phrase. */
  softPauseS: 0.2,
  /** How long a line stays after its last word, if the next doesn't start first. */
  holdS: 0.3,
};

export interface Line {
  words: Word[];
  /** On screen from s to e, seconds on the same clock as the words. */
  s: number;
  e: number;
}

/** Words a line shouldn't end on: the phrase goes on past them. */
const LEANS_ON =
  /^(a|an|the|to|of|and|or|but|nor|in|on|at|for|with|from|by|into|onto|about|my|your|our|his|her|their|its|i|if|so|as|than|very|not)$/i;
const bare = (w: string) => w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
const endsSentence = (w: string) => /[.?!…]["')\]]*$/.test(w);
const endsClause = (w: string) => /[,;:–—]["')\]]*$/.test(w);
const chars = (ws: readonly Word[]) => ws.reduce((n, w) => n + w.w.length, ws.length - 1);

/** Hard breaks: after a sentence end or before a pause. A phrase is one beat. */
export function phrases(words: readonly Word[], pauseS: number): Word[][] {
  const out: Word[][] = [];
  let cur: Word[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (!next || endsSentence(w.w) || next.s - w.e >= pauseS) {
      out.push(cur);
      cur = [];
    }
  });
  return out;
}

/** The cheapest split of one phrase into lines (a small DP; ties go to the earliest break). */
function split(p: readonly Word[], o: LineRules): Word[][] {
  const n = p.length;
  if (n <= o.maxWords && chars(p) <= o.maxChars) return [[...p]];
  const lineCost = (from: number, to: number) => {
    const ws = p.slice(from, to);
    let c = 1 + o.overCost * Math.max(0, chars(ws) - o.maxChars);
    if (ws.length < o.minWords) c += 10;
    if (to < n) {
      const last = p[to - 1] as Word;
      const next = p[to] as Word;
      if (LEANS_ON.test(bare(last.w))) c += 6;
      if (endsClause(last.w)) c -= 3;
      if (next.s - last.e >= o.softPauseS) c -= 2;
    }
    return c;
  };
  const best: { cost: number; from: number }[] = [{ cost: 0, from: -1 }];
  for (let to = 1; to <= n; to++) {
    let pick = { cost: Number.POSITIVE_INFINITY, from: -1 };
    for (let from = Math.max(0, to - o.maxWords); from < to; from++) {
      const c = (best[from] as { cost: number }).cost + lineCost(from, to);
      if (c < pick.cost - 1e-9) pick = { cost: c, from };
    }
    best[to] = pick;
  }
  const lines: Word[][] = [];
  for (let to = n; to > 0; to = (best[to] as { from: number }).from)
    lines.unshift(p.slice((best[to] as { from: number }).from, to));
  return lines;
}

export function reelLines(words: readonly Word[], o: LineRules = REEL): Line[] {
  const groups = phrases(words, o.pauseS).flatMap((p) => split(p, o));
  return groups.map((ws, i) => {
    const first = ws[0] as Word;
    const last = ws.at(-1) as Word;
    const next = groups[i + 1]?.[0];
    return {
      words: ws,
      s: first.s,
      e: Math.max(last.e, Math.min(last.e + o.holdS, next?.s ?? Number.POSITIVE_INFINITY)),
    };
  });
}

/** The line on screen at `t`, and which of its words is said (the last one said, through a gap). */
export function lineAt(lines: readonly Line[], t: number): { line: Line; word: number } | null {
  const line = lines.find((l) => t >= l.s && t < l.e);
  if (!line) return null;
  const word = line.words.findIndex((w, i) => t >= w.s && t < (line.words[i + 1]?.s ?? line.e));
  return { line, word };
}

/** The long video's caption pages: up to 7 words, broken at a sentence end or a pause over 0.6 s. */
export function pages<W extends Word>(words: readonly W[]): W[][] {
  const out: W[][] = [];
  let page: W[] = [];
  for (const w of words) {
    const prev = page.at(-1);
    if (page.length && (page.length >= 7 || (prev && w.s - prev.e > 0.6))) {
      out.push(page);
      page = [];
    }
    page.push(w);
    if (/[.?!]$/.test(w.w)) {
      out.push(page);
      page = [];
    }
  }
  if (page.length) out.push(page);
  return out;
}

/**
 * The English subtitles YouTube shows as CC: one line of up to 42 characters (the broadcast
 * limit), broken like the Reels lines, on screen from its first word to its last and no longer.
 */
export const SUBS: LineRules = {
  minWords: 2,
  maxWords: 10,
  maxChars: 42,
  overCost: 20,
  pauseS: 0.6,
  softPauseS: 0.25,
  holdS: 0,
};

/** "00:01:02,345" */
function stamp(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

/**
 * An .srt of `words` (seconds on the video's clock), numbered from 1; "" with no words. A cue
 * ends by the next one's start: Whisper's word times can overlap.
 */
export function srt(words: readonly Word[], o: LineRules = SUBS): string {
  const lines = reelLines(words, o);
  return lines
    .map((l, i) => ({ ...l, e: Math.min(l.e, lines[i + 1]?.s ?? l.e) }))
    .map(
      (l, i) => `${i + 1}\n${stamp(l.s)} --> ${stamp(l.e)}\n${l.words.map((w) => w.w).join(" ")}\n`,
    )
    .join("\n");
}
