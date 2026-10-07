import { describe, expect, it } from "vitest";
import { PLATFORM_SPECS, postLink, postOf } from "./platforms.js";

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
  const id = "3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f";

  it("off without a site, and none where a link costs reach", () => {
    expect(postLink(undefined, { id, platform: "youtube" })).toBeNull();
    expect(postLink("wrenautomation.com", { id, platform: "x" })).toBeNull();
    expect(postLink("wrenautomation.com", { id, platform: "reddit" })).toBeNull();
    expect(postLink("wrenautomation.com", { id, platform: "instagram" })).toBeNull();
  });

  it("names the platform and the draft, bare host", () => {
    expect(postLink("https://wrenautomation.com/", { id, platform: "youtube" })).toBe(
      "wrenautomation.com/go/yt/3f2a9c1e",
    );
    expect(postLink("wrenautomation.com", { id, platform: "linkedin" })).toBe(
      "wrenautomation.com/go/li/3f2a9c1e",
    );
  });

  it("goes last on its own line, dropped past the cap", () => {
    const draft = { platform: "linkedin" as const, title: null, media: null, extra: {} };
    expect(postOf({ ...draft, text: "hi \n" }, "w.com/go/li/1").text).toBe("hi\n\nw.com/go/li/1");
    const full = "a".repeat(PLATFORM_SPECS.linkedin.maxChars - 3);
    expect(postOf({ ...draft, text: full }, "w.com/go/li/1").text).toBe(full);
  });
});
