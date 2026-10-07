import { describe, expect, it } from "vitest";
import {
  isThread,
  threadPosts,
  threadText,
  threadUnfit,
  withLink,
  xLength,
  xPostMax,
} from "./thread.js";

describe("thread", () => {
  it("splits on a line of dashes and joins back", () => {
    const text = "One.\n---\nTwo.\n\n  ---  \n\nThree.\n---\n";
    expect(threadPosts(text)).toEqual(["One.", "Two.", "Three."]);
    expect(threadPosts(threadText(["One.", " Two. ", "", "Three."]))).toEqual([
      "One.",
      "Two.",
      "Three.",
    ]);
    expect(threadPosts("Just one --- inline")).toEqual(["Just one --- inline"]);
  });

  it("caps one post by the account's subscription", () => {
    expect(xPostMax("None")).toBe(280);
    expect(xPostMax("Basic")).toBe(280);
    expect(xPostMax("Premium")).toBe(25_000);
    expect(xPostMax("PremiumPlus")).toBe(25_000);
  });

  it("counts a link as 23, like X", () => {
    expect(xLength("abc")).toBe(3);
    expect(xLength("see https://example.com/a/very/long/path?x=1")).toBe(4 + 23);
    expect(xLength("é👍")).toBe(2);
  });

  it("puts the link on the last post and refuses what X would", () => {
    const posts = ["First.", "Second.", "Third."];
    expect(withLink(posts, "https://x.test/go")).toEqual([
      "First.",
      "Second.",
      "Third.\n\nhttps://x.test/go",
    ]);
    expect(threadUnfit(posts, "https://x.test/go")).toBeNull();
    expect(threadUnfit(posts.slice(0, 2))).toMatch(/3 to 7 posts/);
    expect(threadUnfit(Array(8).fill("p"))).toMatch(/3 to 7 posts/);
    expect(threadUnfit(["https://a.test first", "b", "c"])).toMatch(/first post carries no link/);
    const full = "x".repeat(270);
    expect(threadUnfit(["a", "b", full])).toBeNull();
    expect(threadUnfit(["a", "b", full], "https://x.test/go")).toMatch(
      /post 3 is 295 characters with its link, over 280/,
    );
    expect(isThread({ platform: "x", extra: { kind: "thread" } })).toBe(true);
    expect(isThread({ platform: "x", extra: {} })).toBe(false);
  });
});
