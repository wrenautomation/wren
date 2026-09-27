import { describe, expect, it } from "vitest";
import { missingExtra, PLATFORM_SPECS, postOf } from "./platforms.js";

describe("platform specs", () => {
  it("reddit needs a subreddit before approval; others need nothing", () => {
    expect(missingExtra(PLATFORM_SPECS.reddit, {})).toEqual(["subreddit"]);
    expect(missingExtra(PLATFORM_SPECS.reddit, { subreddit: "" })).toEqual(["subreddit"]);
    expect(missingExtra(PLATFORM_SPECS.reddit, { subreddit: "startups" })).toEqual([]);
    expect(missingExtra(PLATFORM_SPECS.linkedin, {})).toEqual([]);
  });

  it("a reddit draft's title rides in extra beside the subreddit", () => {
    expect(
      postOf({ text: "b", title: "t", media: null, extra: { subreddit: "startups" } }),
    ).toEqual({ text: "b", extra: { subreddit: "startups", title: "t" } });
  });
});
