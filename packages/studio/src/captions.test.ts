import { describe, expect, it } from "vitest";
import { lineAt, REEL, reelLines } from "./captions.js";
import type { Word } from "./schema.js";

/** Words said one after another, `gap` s apart unless a word says otherwise ("word|0.8"). */
function said(text: string, gap = 0.05, len = 0.25): Word[] {
  let t = 0;
  return text.split(" ").map((tok) => {
    const [w = "", pause] = tok.split("|");
    const s = t;
    t = s + len + (pause ? Number(pause) : gap);
    return { w, s, e: s + len };
  });
}
const texts = (ws: Word[]) => reelLines(ws).map((l) => l.words.map((w) => w.w).join(" "));

describe("reel lines", () => {
  it("keeps 2 to 4 words a line", () => {
    const lines = reelLines(
      said("so we built this thing that cuts every video for us automatically"),
    );
    for (const l of lines) {
      expect(l.words.length).toBeGreaterThanOrEqual(REEL.minWords);
      expect(l.words.length).toBeLessThanOrEqual(REEL.maxWords);
    }
    expect(lines.flatMap((l) => l.words.map((w) => w.w)).join(" ")).toBe(
      "so we built this thing that cuts every video for us automatically",
    );
  });

  it("ends a line at a sentence end and at a pause", () => {
    expect(texts(said("It works. Every time"))).toEqual(["It works.", "Every time"]);
    expect(texts(said("we ship|0.6 on fridays"))).toEqual(["we ship", "on fridays"]);
  });

  it("breaks at a comma or a small pause, never after a word the phrase leans on", () => {
    expect(texts(said("if it breaks, we fix it fast"))).toEqual([
      "if it breaks,",
      "we fix it fast",
    ]);
    const lines = texts(said("I want to show you how the dashboard works for a client"));
    for (const l of lines) expect(l).not.toMatch(/\b(the|to|of|a|and|in)$/);
    expect(texts(said("we put|0.3 the captions on top of the picture"))).toEqual([
      "we put",
      "the captions on top",
      "of the picture",
    ]);
  });

  it("splits a long-lettered line rather than overflow", () => {
    for (const l of reelLines(said("understanding transcription automatically everywhere")))
      expect(l.words.length).toBeLessThanOrEqual(2);
  });

  it("shows a line from its first word until a beat after its last, never into the next", () => {
    const ws = said("hello there|1.0 general kenobi");
    const [a, b] = reelLines(ws);
    expect(a?.s).toBe(0);
    expect(a?.e).toBeCloseTo((ws[1] as Word).e + REEL.holdS);
    expect(b?.s).toBe((ws[2] as Word).s);
    const tight = reelLines(said("one two three four five six", 0.01));
    tight.slice(0, -1).forEach((l, i) => {
      expect(l.e).toBeLessThanOrEqual((tight[i + 1] as typeof l).s);
    });
    // Nothing on screen in a long pause.
    expect(lineAt(reelLines(ws), (ws[1] as Word).e + 0.6)).toBeNull();
  });

  it("highlights the word being said", () => {
    const ws = said("one two three");
    const lines = reelLines(ws);
    expect(lineAt(lines, 0.1)?.word).toBe(0);
    expect(lineAt(lines, (ws[1] as Word).s + 0.01)?.word).toBe(1);
    expect(lineAt(lines, (ws[2] as Word).e + 0.1)?.word).toBe(2);
  });
});
