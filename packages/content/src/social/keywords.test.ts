import { describe, expect, it } from "vitest";
import { saysKeyword, wordsOf } from "./keywords.js";

describe("saysKeyword", () => {
  it("matches whole words in any case, with punctuation and emoji around", () => {
    expect(saysKeyword("LINK!", "link")).toBe(true);
    expect(saysKeyword("pls send the link 🙏", "Link")).toBe(true);
    expect(saysKeyword("free guide please", "free guide")).toBe(true);
    expect(saysKeyword("linked it", "link")).toBe(false);
    expect(saysKeyword("guide free", "free guide")).toBe(false);
    expect(saysKeyword("anything", "!!")).toBe(false);
  });
  it("keeps letters past ASCII", () => {
    expect(wordsOf("Guía, por favor")).toBe("guia por favor");
  });
});
