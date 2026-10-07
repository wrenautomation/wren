import { describe, expect, it } from "vitest";
import { PLATFORM_SPECS, postOf, wordsUnfit } from "./platforms.js";

describe("platform specs", () => {
  it("a reddit draft's title rides in extra beside the subreddit", () => {
    expect(
      postOf({
        platform: "reddit",
        text: "b",
        title: "t",
        media: null,
        extra: { subreddit: "startups" },
      }),
    ).toEqual({ text: "b", extra: { subreddit: "startups", title: "t" } });
  });

  it("parses the draft's fields: a stray key drops, a bad one throws", () => {
    const draft = { platform: "reddit" as const, text: "b", title: "t", media: null };
    expect(postOf({ ...draft, extra: { subreddit: "startups", flairId: "x" } }).extra).toEqual({
      subreddit: "startups",
      title: "t",
    });
    expect(() => postOf({ ...draft, extra: { subreddit: "two words" } })).toThrow("Subreddit");
  });
});

describe("post links", () => {
  it("goes last on its own line, dropped past the cap", () => {
    const draft = { platform: "linkedin" as const, title: null, media: null, extra: {} };
    expect(postOf({ ...draft, text: "hi \n" }, "w.com/go/li/1").text).toBe("hi\n\nw.com/go/li/1");
    const full = "a".repeat(PLATFORM_SPECS.linkedin.maxChars - 3);
    expect(postOf({ ...draft, text: full }, "w.com/go/li/1").text).toBe(full);
  });
});

describe("x caps", () => {
  it("a single post goes long on Premium; a thread's posts stay at 280", () => {
    expect(PLATFORM_SPECS.x.maxChars).toBe(25_000);
    const single = { platform: "x" as const, extra: {} };
    expect(wordsUnfit(single, "a".repeat(2000))).toBeNull();
    expect(wordsUnfit(single, "a".repeat(25_001))).toMatch(/over 25000/);
    const thread = { platform: "x" as const, extra: { kind: "thread" } };
    expect(wordsUnfit(thread, ["a".repeat(281), "b", "c"].join("\n\n---\n\n"))).toMatch(/over 280/);
  });

  it("a long single post keeps its link and stays one post", () => {
    const text = "a".repeat(2000);
    const post = postOf(
      { platform: "x", text, title: null, media: null, extra: {} },
      "w.com/go/x/1",
    );
    expect(post.text).toBe(`${text}\n\nw.com/go/x/1`);
  });
});
