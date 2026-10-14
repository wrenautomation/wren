/**
 * Punctuation for a transcript Whisper gave without any (`wren video words <id> --punctuate`): a
 * model adds full stops, commas and capitals, and only the text of each word changes. A word the
 * model changed (beyond punctuation and case), dropped or added keeps its own text, so the times,
 * the cuts and the stressed words stay where they were. Shorts then snap to real sentences
 * (`sentences.ts`) and the captions read like video with punctuation.
 */
import type { Word } from "./schema.js";
import type { StressModel } from "./stress.js";

/** Words an ask: the gateway's upstream answers within 20 s. */
export const PUNCTUATE_CHUNK = 250;

const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

export function punctuatePrompt(words: readonly Word[]): string {
  return [
    "Below is part of a spoken transcript with no punctuation.",
    "Add sentence punctuation (. , ? !) and capitals where a careful editor would.",
    "Keep every word, in order, spelled exactly as it is, fillers (um, uh) included.",
    "Change nothing else: no words added, removed, merged or split.",
    "Answer only the punctuated text.",
    "",
    words.map((w) => w.w).join(" "),
  ].join("\n");
}

/**
 * The model's text laid back onto `words`: each word takes the model's token when the two are the
 * same word once case and punctuation are dropped. Where they part (a dropped, added or changed
 * word), the next 4 on either side are searched for the match; a word with none keeps its text.
 */
export function alignPunctuation(
  words: readonly Word[],
  text: string,
): { words: Word[]; changed: number } {
  const said = text.split(/\s+/).filter((t) => bare(t));
  const out = words.map((w) => ({ ...w }));
  let changed = 0;
  let j = 0;
  for (let i = 0; i < out.length && j < said.length; ) {
    const w = out[i] as Word;
    const t = said[j] as string;
    if (bare(t) === bare(w.w)) {
      if (t !== w.w) {
        w.w = t;
        changed++;
      }
      i++;
      j++;
      continue;
    }
    const ahead = [1, 2, 3, 4].find((d) => bare(out[i + d]?.w ?? "") === bare(t));
    const back = [1, 2, 3, 4].find((d) => bare(said[j + d] ?? "") === bare(w.w));
    if (ahead !== undefined && (back === undefined || ahead <= back)) i += ahead;
    else if (back !== undefined) j += back;
    else {
      i++;
      j++;
    }
  }
  return { words: out, changed };
}

/** Every word punctuated, `PUNCTUATE_CHUNK` an ask. */
export async function punctuate(
  model: StressModel,
  words: readonly Word[],
): Promise<{ words: Word[]; changed: number; asked: number }> {
  const out: Word[] = [];
  let changed = 0;
  let asked = 0;
  for (let from = 0; from < words.length; from += PUNCTUATE_CHUNK) {
    const chunk = words.slice(from, from + PUNCTUATE_CHUNK);
    const { text } = await model.complete(punctuatePrompt(chunk), { maxTokens: 8000 });
    asked++;
    const r = alignPunctuation(chunk, text);
    // An ask ends wherever the chunk does, so the model may close a sentence there that goes on:
    // the stop stays only when the next ask opens with a capital.
    const last = out.at(-1);
    const next = r.words[0];
    if (last && next && /^\p{Ll}/u.test(next.w)) last.w = last.w.replace(/[.?!]+$/, "");
    out.push(...r.words);
    changed += r.changed;
  }
  return { words: out, changed, asked };
}

/** True when the transcript has no sentence ends at all: the one `--punctuate` is for. */
export const unpunctuated = (words: readonly Word[]) =>
  words.length > 0 && !words.some((w) => /[.?!]["'”’)\]]*$/.test(w.w.trim()));
