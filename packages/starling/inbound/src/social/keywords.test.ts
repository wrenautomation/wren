import { describe, expect, it } from "vitest";
import { hitOfPayload, pickReply, saysKeyword, tapPayload, wordsOf } from "./keywords.js";

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

describe("pickReply", () => {
  it("picks one version a line, the same for the same comment", () => {
    const reply = "Sent, check your DMs\n\nIn your DMs now\nJust sent it";
    const picks = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((id) => pickReply(reply, id)));
    expect(picks.size).toBeGreaterThan(1);
    expect(pickReply(reply, 5)).toBe(pickReply(reply, 5));
    expect(["Sent, check your DMs", "In your DMs now", "Just sent it"]).toContain(
      pickReply(reply, 5),
    );
    expect(pickReply(null, 1)).toBeNull();
    expect(pickReply("  \n ", 1)).toBeNull();
  });
});

describe("tap payload", () => {
  it("round-trips a hit and refuses anything else", () => {
    expect(hitOfPayload(tapPayload(12))).toBe(12);
    expect(hitOfPayload("kw:")).toBeNull();
    expect(hitOfPayload("GET_STARTED")).toBeNull();
  });
});
