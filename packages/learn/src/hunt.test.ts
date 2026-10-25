import { describe, expect, it } from "vitest";
import { type Find, phrasesOf, rankFinds } from "./hunt.js";

const find = (url: string, views: number | null, title = url): Find => ({
  url,
  title,
  creator: null,
  views,
  publishedAt: null,
  duration: null,
});

describe("the hunt's search", () => {
  it("searches a topic one phrase at a time", () => {
    expect(phrasesOf("launch film, product film,, demo film, launch film")).toEqual([
      "launch film",
      "product film",
      "demo film",
    ]);
    expect(phrasesOf("")).toEqual([]);
  });

  it("merges the searches, each link once, most viewed first, unknown views last", () => {
    const ranked = rankFinds([
      [find("a", 100), find("b", null), find("c", 5000)],
      [find("a", 120, "a again"), find("d", 7)],
    ]);
    expect(ranked.map((f) => f.url)).toEqual(["c", "a", "d", "b"]);
    expect(ranked[1]?.title).toBe("a again");
  });
});
