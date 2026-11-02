import { describe, expect, it } from "vitest";
import type { Word } from "./schema.js";
import { sentenceEdges, shortIssues, snapShorts } from "./sentences.js";

/** Words said one after another from `at`, `step` s each, a 0.05 s gap between. */
function say(text: string, at = 0, step = 0.4): Word[] {
  return text.split(" ").map((w, i) => ({ w, s: at + i * step, e: at + i * step + step - 0.05 }));
}

// 3 sentences of 40 words each: 16 s apiece, 48 s in all.
const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => ["we", "build", "tools", "here"][i % 4]).join(" ");
const words = say(`First ${filler(38)} done. Second ${filler(38)} done. Third ${filler(38)} done.`);
const e = { words, cuts: [], durationS: 60 };
const t = (w: string, i = 0) => words.filter((x) => x.w === w)[i] as Word;

describe("sentenceEdges", () => {
  it("ends on punctuation when the words have it", () => {
    const { starts, ends } = sentenceEdges(say("so we ship. then we rest. ok"));
    expect([...ends]).toEqual([2, 5, 6]);
    expect([...starts].sort()).toEqual([0, 3, 6]);
  });

  it("puts a stop on a filler onto the word before it, and starts after the filler", () => {
    const { starts, ends } = sentenceEdges(say("we ship, um. then rest."));
    expect(ends.has(1)).toBe(true);
    expect(starts.has(3)).toBe(true);
    expect(starts.has(2)).toBe(false);
  });

  it("without punctuation, ends at a pause but never after a word that can't close one", () => {
    const ws = [
      ...say("we ship tools"),
      ...say("then we rest", 2),
      ...say("we go to", 4),
      ...say("bed now", 6),
    ];
    const { ends } = sentenceEdges(ws);
    expect(ends.has(2)).toBe(true); // "tools" then a pause
    expect(ends.has(8)).toBe(false); // "to" can't close a sentence
  });
});

describe("snapShorts", () => {
  it("keeps a Short already on whole sentences", () => {
    const s = { from: t("First").s, to: t("done.", 1).e + 0.02, title: "a" };
    expect(shortIssues(e, [s])).toEqual([]);
    expect(snapShorts(e, [s])).toEqual({ shorts: [s], moved: [] });
  });

  it("moves a mid-sentence start back to the sentence and reports how far", () => {
    const s = { from: t("Second").s + 2, to: t("done.", 2).e + 0.02, title: "b" };
    expect(shortIssues(e, [s])[0]).toMatch(/^shorts\[0\]: starts mid-sentence/);
    const r = snapShorts(e, [s]);
    expect(r.shorts[0]?.from).toBeLessThanOrEqual(t("Second").s);
    expect(r.shorts[0]?.from).toBeGreaterThanOrEqual(t("done.", 0).e);
    expect(r.moved).toEqual([{ n: 1, from: expect.any(Number), to: 0 }]);
    expect(r.moved[0]?.from).toBeLessThan(0);
    expect(shortIssues(e, r.shorts)).toEqual([]);
  });

  it("moves a mid-sentence end to a sentence end that keeps it 20 to 60 s", () => {
    const s = { from: t("First").s, to: t("done.", 1).e - 4, title: "c" };
    const r = snapShorts(e, [s]);
    expect(r.shorts[0]?.to).toBeGreaterThanOrEqual(t("done.", 1).e);
    expect(shortIssues(e, r.shorts)).toEqual([]);
  });

  it("leaves a Short with no sentence edge in reach as it was", () => {
    const long = say(filler(200));
    const s = { from: 10, to: 40, title: "d" };
    const r = snapShorts({ words: long, cuts: [], durationS: 100 }, [s]);
    expect(r.shorts[0]).toEqual(s);
  });

  it("does nothing before the words are in", () => {
    const s = { from: 3, to: 33, title: "e" };
    expect(snapShorts({ words: [], cuts: [], durationS: 60 }, [s]).moved).toEqual([]);
    expect(shortIssues({ words: [], cuts: [], durationS: 60 }, [s])).toEqual([]);
  });
});
