/**
 * Adapted from heygen-com/hyperframes `skills/embedded-captions/SKILL.md` @5c7f631 (Apache-2.0);
 * changed: only its spacing rule (at most one hero per beat, never two on screen at once, at least
 * 0.6 s apart), with a beat as our phrase and a pick shown from its start to `holdS` after its end.
 * See packages/studio/NOTICE.
 *
 * Stressed words (designs/2026-10-06-video-editor.md, step 6): the 1-3 words a minute that carry the
 * point, as indexes into the edit's `words`. They drive the `stress` caption style and the words
 * drawn behind the speaker. A model proposes them (`wren video stress`); he adds, drops or toggles
 * them. Pure: the prompt, the parser and the spacing rule; `setStress` in edit.ts writes them.
 */
import { phrases, REEL } from "./captions.js";
import type { Word } from "./schema.js";

export const STRESS = {
  /** Picks a model may make per minute of speech. */
  perMinute: 3,
  /** Air between one pick's last frame on screen and the next one's first. */
  gapS: 0.6,
  /** A pick stays this long after its word ends (behind the speaker, and its matte window). */
  holdS: 1.2,
  /** Words sent to the model per ask. */
  chunk: 300,
} as const;

/** The beat (phrase) each word is in, by word index. */
export function beatsOf(words: readonly Word[]): number[] {
  const out: number[] = [];
  phrases(words, REEL.pauseS).forEach((p, b) => {
    for (const _ of p) out.push(b);
  });
  return out;
}

/** When pick `i` is on screen: from its start to `holdS` after its end. */
export const shownOf = (w: Word) => ({ from: w.s, to: w.e + STRESS.holdS });

/** Why pick `j` can't sit with pick `i`, or null when it can. */
export function clash(words: readonly Word[], beats: readonly number[], i: number, j: number) {
  if (beats[i] === beats[j]) return "same beat";
  const a = shownOf(words[i] as Word);
  const b = shownOf(words[j] as Word);
  if (b.from < a.to + STRESS.gapS && a.from < b.to + STRESS.gapS)
    return `under ${STRESS.gapS}s from the word at ${a.from.toFixed(1)}s`;
  return null;
}

/**
 * Keep picks that follow the rule, earliest-listed first (the model lists the strongest first):
 * one per beat, no two on screen at once, `gapS` apart, and with `perMinute`, at most that many in
 * any minute. Answers the kept indexes in time order.
 */
export function spaceStress(
  words: readonly Word[],
  picks: readonly number[],
  o: { perMinute?: number } = {},
): number[] {
  const beats = beatsOf(words);
  const kept: number[] = [];
  const perMin = new Map<number, number>();
  for (const i of picks) {
    const w = words[i];
    if (!w || kept.includes(i)) continue;
    if (kept.some((k) => clash(words, beats, k, i))) continue;
    const minute = Math.floor(w.s / 60);
    if (o.perMinute && (perMin.get(minute) ?? 0) >= o.perMinute) continue;
    perMin.set(minute, (perMin.get(minute) ?? 0) + 1);
    kept.push(i);
  }
  return kept.sort((a, b) => a - b);
}

/** Problems with a list someone set (the page, `wren video set`): bad indexes, then clashes. */
export function checkStress(words: readonly Word[], stress: readonly number[]): string[] {
  const bad: string[] = [];
  const beats = beatsOf(words);
  const seen = new Set<number>();
  stress.forEach((i, n) => {
    if (!Number.isInteger(i) || i < 0 || i >= words.length)
      bad.push(`stress[${n}]: no word ${i} (${words.length} words)`);
    else if (seen.has(i)) bad.push(`stress[${n}]: word ${i} twice`);
    seen.add(i);
  });
  if (bad.length) return bad;
  const sorted = [...stress].sort((a, b) => a - b);
  sorted.forEach((j, n) => {
    for (const i of sorted.slice(0, n)) {
      const why = clash(words, beats, i, j);
      if (why) bad.push(`"${(words[j] as Word).w}" at ${(words[j] as Word).s.toFixed(1)}s: ${why}`);
    }
  });
  return bad;
}

/** The word said at `at` seconds, else the nearest within a second. */
export function wordAt(words: readonly Word[], at: number): number {
  const i = words.findIndex((w) => at >= w.s && at < w.e);
  if (i >= 0) return i;
  let best = -1;
  let d = 1;
  words.forEach((w, j) => {
    const dj = Math.min(Math.abs(w.s - at), Math.abs(w.e - at));
    if (dj < d || (best < 0 && dj === d)) {
      d = dj;
      best = j;
    }
  });
  if (best < 0) throw new Error(`no word near ${at}s`);
  return best;
}

const core = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** The words `from` to `to` as the model reads them: `[index]word`, a line per phrase. */
export function stressPrompt(words: readonly Word[], from: number, to: number): string {
  const beats = beatsOf(words);
  const lines: string[] = [];
  let line: string[] = [];
  for (let i = from; i < to; i++) {
    if (line.length && beats[i] !== beats[i - 1]) {
      lines.push(line.join(" "));
      line = [];
    }
    line.push(`[${i}]${(words[i] as Word).w}`);
  }
  if (line.length) lines.push(line.join(" "));
  const minutes = Math.max(
    1,
    Math.round((((words[to - 1] as Word).e - (words[from] as Word).s) / 60) * 10) / 10,
  );
  const most = Math.max(1, Math.round(minutes * STRESS.perMinute));
  return [
    "Below is part of a talking-head video's transcript. Each word has its index in [brackets];",
    "each line is one phrase.",
    `Pick the words that carry the point: about 1 to ${STRESS.perMinute} a minute (at most ${most} here).`,
    "Good picks: numbers, outcomes, names, the one word a viewer should remember from the phrase.",
    "Never a filler, a pronoun or a small word (the, to, and, it). At most one word per phrase.",
    "List the strongest first.",
    'Answer only JSON: {"stress": [{"i": <index>, "w": "<the word>"}]}',
    "",
    ...lines,
  ].join("\n");
}

/**
 * The model's picks as word indexes, strongest first. Reads `{"stress": [{i, w}]}`, a bare list of
 * those, or a list of numbers. An index whose word doesn't match `w` moves to the nearest word
 * within 3 that does (models miscount); one with no match anywhere near is dropped, as is anything
 * outside [from, to).
 */
export function parseStress(
  text: string,
  words: readonly Word[],
  from = 0,
  to = words.length,
): number[] {
  const json = /[[{][\s\S]*[\]}]/.exec(text)?.[0];
  if (!json) return [];
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { stress?: unknown }).stress)
      ? (data as { stress: unknown[] }).stress
      : [];
  const out: number[] = [];
  for (const item of list) {
    const i =
      typeof item === "number"
        ? item
        : item && typeof item === "object"
          ? Number((item as { i?: unknown }).i)
          : Number.NaN;
    const said = item && typeof item === "object" ? (item as { w?: unknown }).w : undefined;
    if (!Number.isInteger(i)) continue;
    let at = i;
    if (typeof said === "string" && core(said)) {
      const want = core(said);
      at =
        [0, -1, 1, -2, 2, -3, 3].map((d) => i + d).find((j) => core(words[j]?.w ?? "") === want) ??
        -1;
    }
    if (at >= from && at < to && !out.includes(at)) out.push(at);
  }
  return out;
}

/**
 * Picks carried across a transcript change (a word fix that merged words): each to the new word
 * covering its old word's middle. Dropped when no word covers it.
 */
export function remapStress(
  before: readonly Word[],
  after: readonly Word[],
  stress: readonly number[],
): number[] {
  if (before.length === after.length) return [...stress];
  const out = new Set<number>();
  for (const i of stress) {
    const w = before[i];
    if (!w) continue;
    const mid = (w.s + w.e) / 2;
    const j = after.findIndex((x) => mid >= x.s && mid <= x.e);
    if (j >= 0) out.add(j);
  }
  return [...out].sort((a, b) => a - b);
}

/** What `proposeStress` needs of a model: `@wren/llm`'s client fits. */
export interface StressModel {
  complete(prompt: string, o?: { system?: string; maxTokens?: number }): Promise<{ text: string }>;
}

/**
 * Ask the model for the stressed words of what's left after the cuts: `chunk` words an ask, each
 * pick checked against its words, then spaced (`spaceStress`, at most `perMinute` a minute) on the
 * cut timeline. `cut`: each kept word on the cut timeline with its index in the edit's words.
 * Answers indexes into the edit's words.
 */
export async function proposeStress(
  model: StressModel,
  cut: readonly { i: number; w: Word }[],
): Promise<{ stress: number[]; asked: number; offered: number }> {
  const words = cut.map((c) => c.w);
  const picks: number[] = [];
  let asked = 0;
  for (let from = 0; from < words.length; from += STRESS.chunk) {
    const to = Math.min(words.length, from + STRESS.chunk);
    const { text } = await model.complete(stressPrompt(words, from, to), { maxTokens: 8000 });
    asked++;
    picks.push(...parseStress(text, words, from, to));
  }
  const kept = spaceStress(words, picks, { perMinute: STRESS.perMinute });
  return {
    stress: kept.map((j) => (cut[j] as { i: number }).i),
    asked,
    offered: picks.length,
  };
}
