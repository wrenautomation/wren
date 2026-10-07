import { describe, expect, it } from "vitest";
import { PLATFORM_SPECS, postOf } from "./platforms.js";

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
