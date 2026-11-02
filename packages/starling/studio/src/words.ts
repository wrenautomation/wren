/**
 * Fixing a misheard word before render (designs/2026-10-06-video-editor.md, step 5). Whisper writes
 * "drug fooding" for dogfooding and "Ren" for Wren; these rewrite the transcript's text, never its
 * times. Pure: `setWords` in edit.ts writes the result with a `runs` row.
 */
import type { Word } from "./schema.js";

const EDGE = /^([^\p{L}\p{N}']*)(.*?)([^\p{L}\p{N}']*)$/u;
/** A word's leading punctuation, its letters, its trailing punctuation. */
const parts = (w: string) => {
  const m = EDGE.exec(w) as RegExpExecArray;
  return { lead: m[1] ?? "", core: m[2] ?? "", trail: m[3] ?? "" };
};
const key = (w: string) => parts(w).core.toLowerCase();

/**
 * `right` in the case of the word it replaces: as typed when it has a capital (a name), else
 * capitalized where the original was (a sentence start), upper where the original shouted.
 */
function cased(right: string, original: string): string {
  if (original.length > 1 && original === original.toUpperCase() && /\p{Lu}/u.test(original))
    return right.toUpperCase();
  if (/\p{Lu}/u.test(right)) return right;
  return /^\p{Lu}/u.test(original) ? right.charAt(0).toUpperCase() + right.slice(1) : right;
}

export interface Fixed {
  words: Word[];
  /** How many places changed. */
  n: number;
}

/**
 * Every run of words that reads `wrong` (any case, punctuation aside) becomes `right`. Same word
 * count: word for word, each keeping its times. Another count: one word over the run's span.
 */
export function fixWords(words: readonly Word[], wrong: string, right: string): Fixed {
  const want = wrong.trim().split(/\s+/).map(key).filter(Boolean);
  const put = right.trim().split(/\s+/).filter(Boolean);
  if (!want.length || !put.length) throw new Error("--fix is wrong=right, both with words");
  const out: Word[] = [];
  let n = 0;
  for (let i = 0; i < words.length; ) {
    const run = words.slice(i, i + want.length);
    if (run.length < want.length || run.some((w, j) => key(w.w) !== want[j])) {
      out.push(words[i] as Word);
      i++;
      continue;
    }
    n++;
    const first = run[0] as Word;
    const last = run.at(-1) as Word;
    if (put.length === run.length)
      run.forEach((w, j) => {
        const p = parts(w.w);
        out.push({ ...w, w: `${p.lead}${cased(put[j] as string, p.core)}${p.trail}` });
      });
    else
      out.push({
        w: `${parts(first.w).lead}${cased(put.join(" "), parts(first.w).core)}${parts(last.w).trail}`,
        s: first.s,
        e: last.e,
      });
    i += run.length;
  }
  return { words: out, n };
}

/**
 * The one word said at `at` seconds (raw clock) becomes `text`; the nearest one within a second
 * when `at` falls between words. Its punctuation stays unless `text` brings its own.
 */
export function fixWordAt(words: readonly Word[], at: number, text: string): Fixed {
  const put = text.trim();
  if (!put) throw new Error("no text for the word");
  let i = words.findIndex((w) => at >= w.s && at < w.e);
  if (i < 0) {
    const d = words.map((w) => Math.min(Math.abs(w.s - at), Math.abs(w.e - at)));
    const near = d.indexOf(Math.min(...d));
    if (near < 0 || (d[near] as number) > 1) throw new Error(`no word near ${at}s`);
    i = near;
  }
  const w = words[i] as Word;
  const p = parts(w.w);
  const q = parts(put);
  const next = `${q.lead || p.lead}${q.core}${q.trail || p.trail}`;
  return { words: words.map((x, j) => (j === i ? { ...x, w: next } : x)), n: 1 };
}
