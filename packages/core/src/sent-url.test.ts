import { describe, expect, it } from "vitest";
import { whereSent } from "./sent-url.js";

describe("whereSent", () => {
  it.each([
    [
      "youtube",
      "https://www.youtube.com/watch?v=abc",
      "Ugz1",
      "https://www.youtube.com/watch?v=abc&lc=Ugz1",
    ],
    [
      "reddit",
      "https://www.reddit.com/r/smallbusiness/comments/1abc/some_title/",
      "t1_xyz",
      "https://www.reddit.com/r/smallbusiness/comments/1abc/comment/xyz/",
    ],
    ["x", "https://x.com/someone/status/1", "1789", "https://x.com/i/status/1789"],
    [
      "linkedin",
      "https://www.linkedin.com/feed/update/urn:li:activity:1/",
      "urn:li:comment:9",
      "https://www.linkedin.com/feed/update/urn:li:activity:1/",
    ],
    ["instagram", "https://www.instagram.com/sam/", null, "https://www.instagram.com/sam/"],
    ["reddit", null, "t1_xyz", null],
  ] as const)("%s %s %s", (platform, place, ref, want) => {
    expect(whereSent(platform, place, ref)).toBe(want);
  });
});
