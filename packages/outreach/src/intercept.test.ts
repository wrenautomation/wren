import { describe, expect, it } from "vitest";
import { pastedOf, postUrlOf } from "./intercept.js";
import { nameOfVanity } from "./reach-posts.js";

describe("pastedOf", () => {
  it("Reddit: a subreddit, a thread, a short link", () => {
    expect(pastedOf("https://www.reddit.com/r/Recruiting/")).toEqual({
      kind: "place",
      subreddit: "recruiting",
    });
    expect(pastedOf("old.reddit.com/r/sales/comments/1abc2d/some_title/")).toEqual({
      kind: "thread",
      subreddit: "sales",
      id: "t3_1abc2d",
    });
    expect(pastedOf("https://redd.it/1abc2d")).toEqual({
      kind: "thread",
      subreddit: null,
      id: "t3_1abc2d",
    });
    expect(pastedOf("https://www.reddit.com/user/someone").kind).toBe("unknown");
  });

  it("LinkedIn: a post by urn or by its slug, a company, a person", () => {
    expect(pastedOf("https://www.linkedin.com/feed/update/urn:li:activity:7001/")).toEqual({
      kind: "post",
      platform: "linkedin",
      ref: "urn:li:activity:7001",
    });
    expect(
      pastedOf("https://www.linkedin.com/posts/jane-doe_hiring-activity-7002-AbCd?utm_source=x"),
    ).toEqual({ kind: "post", platform: "linkedin", ref: "urn:li:activity:7002" });
    expect(pastedOf("https://www.linkedin.com/company/Sample-Co/posts/")).toEqual({
      kind: "account",
      platform: "linkedin",
      handle: "sample-co",
    });
    expect(pastedOf("https://www.linkedin.com/in/jane-doe-4b1a2/")).toEqual({
      kind: "account",
      platform: "linkedin",
      handle: "in/jane-doe-4b1a2",
    });
  });

  it("X and Instagram: a post or an account; the sites' own pages are neither", () => {
    expect(pastedOf("https://x.com/someone/status/123?s=20")).toEqual({
      kind: "post",
      platform: "x",
      ref: "123",
    });
    expect(pastedOf("twitter.com/i/web/status/456").kind).toBe("post");
    expect(pastedOf("https://x.com/SomeOne")).toEqual({
      kind: "account",
      platform: "x",
      handle: "someone",
    });
    expect(pastedOf("https://x.com/home").kind).toBe("unknown");
    expect(pastedOf("https://www.instagram.com/reel/Debpwm9zvLG/")).toEqual({
      kind: "post",
      platform: "instagram",
      ref: "Debpwm9zvLG",
    });
    expect(pastedOf("https://instagram.com/some.one/")).toEqual({
      kind: "account",
      platform: "instagram",
      handle: "some.one",
    });
    expect(pastedOf("https://www.instagram.com/explore/").kind).toBe("unknown");
  });

  it("anything else says what to paste", () => {
    expect(pastedOf("not a link at all")).toMatchObject({ kind: "unknown" });
    expect(pastedOf("https://example.com/x")).toEqual({
      kind: "unknown",
      why: "paste a Reddit, LinkedIn, X or Instagram link",
    });
  });

  it("links back and names from a LinkedIn link", () => {
    expect(postUrlOf("x", "123")).toBe("https://x.com/i/status/123");
    expect(nameOfVanity("jane-doe-4b1a2")).toBe("jane doe");
  });
});
