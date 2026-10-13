import { describe, expect, it } from "vitest";
import { cleanComment, postsFor } from "./our-posts.js";

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
