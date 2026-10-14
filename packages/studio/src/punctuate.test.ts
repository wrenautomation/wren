import { describe, expect, it } from "vitest";
import { alignPunctuation, punctuate, unpunctuated } from "./punctuate.js";
import type { Word } from "./schema.js";
import type { StressModel } from "./stress.js";

const words = (text: string): Word[] => text.split(" ").map((w, i) => ({ w, s: i, e: i + 0.8 }));

describe("alignPunctuation", () => {
  it("takes the model's punctuation and case, keeping the times", () => {
    const r = alignPunctuation(words("so we ship it then we rest"), "So we ship it. Then we rest.");
    expect(r.words.map((w) => w.w).join(" ")).toBe("So we ship it. Then we rest.");
    expect(r.words.map((w) => w.s)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(r.changed).toBe(4);
  });

  it("keeps a word the model changed, and finds its place again after a dropped one", () => {
    const r = alignPunctuation(words("um we ship gonna rest"), "We ship. Going to rest.");
    expect(r.words.map((w) => w.w)).toEqual(["um", "We", "ship.", "gonna", "rest."]);
  });
});

describe("punctuate", () => {
  it("asks per chunk and drops a stop the next chunk carries on from", async () => {
    const asks: string[] = [];
    const model: StressModel = {
      complete: async (prompt: string) => {
        asks.push(prompt);
        const text = prompt.split("\n").at(-1) as string;
        return { text: `${text}.` };
      },
    };
    const ws = words(Array.from({ length: 300 }, () => "go").join(" "));
    const r = await punctuate(model, ws);
    expect(r.asked).toBe(2);
    expect(r.words[249]?.w).toBe("go");
    expect(r.words[299]?.w).toBe("go.");
  });
});

describe("unpunctuated", () => {
  it("is true only for words with no sentence end at all", () => {
    expect(unpunctuated(words("we ship it"))).toBe(true);
    expect(unpunctuated(words("we ship it."))).toBe(false);
    expect(unpunctuated([])).toBe(false);
  });
});
