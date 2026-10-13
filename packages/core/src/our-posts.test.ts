import { describe, expect, it } from "vitest";
import { cleanComment, plainComment, postsFor, stockPhrases } from "./our-posts.js";

describe("cleanComment", () => {
  it("turns dashes into commas", () => {
    expect(cleanComment(" Speed wins — every time – mostly -- trust me ")).toBe(
      "Speed wins, every time, mostly, trust me",
    );
  });
  it("leaves hyphenated words alone", () => {
    expect(cleanComment("A follow-up in 5 minutes")).toBe("A follow-up in 5 minutes");
  });
});

describe("postsFor", () => {
  const posts = [
    { platform: "x", text: "Speed to lead: answer within five minutes or lose them" },
    { platform: "linkedin", text: "Reactivation: old leads answer when the message is short" },
    { platform: "youtube", text: "Webhooks explained for agencies" },
  ];
  it("picks the posts sharing words with theirs, closest first", () => {
    const got = postsFor("our recruiters answer leads within minutes", posts);
    expect(got.map((p) => p.platform)).toEqual(["x", "linkedin"]);
  });
  it("falls back to the newest two", () => {
    expect(postsFor("nothing alike here", posts)).toHaveLength(2);
  });
});

describe("stockPhrases", () => {
  it("names the stock moves", () => {
    expect(stockPhrases("You're right, speed matters.")).toHaveLength(1);
    expect(stockPhrases("Ryan's point on AI tools hits home.")).toHaveLength(1);
    expect(stockPhrases("It's not about the tools, it's about people.")).toHaveLength(1);
    expect(stockPhrases("Speed matters. What's one task you automated?")).toHaveLength(1);
  });
  it("passes a plain comment", () => {
    expect(
      stockPhrases("Vetting is where it breaks. Call them the same day or lose them."),
    ).toEqual([]);
  });
});

describe("plainComment", () => {
  it("asks once more when the first reads stock", async () => {
    const asked: Array<string | null> = [];
    const out = await plainComment(async (note) => {
      asked.push(note);
      return { text: asked.length === 1 ? "Great point. Speed wins." : "Speed wins.", result: 0 };
    }, null);
    expect(out.text).toBe("Speed wins.");
    expect(asked[1]).toContain("Cut:");
  });
});
