import { describe, expect, it } from "vitest";
import { ownDraftOf, splitPosts } from "./write.js";

describe("own words", () => {
  it("splits a batch on a line of dashes", () => {
    expect(splitPosts("one\n---\ntwo\n\n  ----  \nthree\n---\n")).toEqual(["one", "two", "three"]);
    expect(splitPosts("a - b -- c")).toEqual(["a - b -- c"]);
  });

  it("keeps the words on platforms that take text alone", () => {
    expect(ownDraftOf("linkedin", "  Hello.\n\nMore.  ")).toEqual({
      text: "Hello.\n\nMore.",
      title: null,
    });
  });

  it("takes Reddit's title from the first line unless one is given", () => {
    expect(ownDraftOf("reddit", "What we learned\nBody here.")).toEqual({
      text: "Body here.",
      title: "What we learned",
    });
    expect(ownDraftOf("reddit", "Body only.", "A title")).toEqual({
      text: "Body only.",
      title: "A title",
    });
    expect(ownDraftOf("reddit", "One line")).toEqual({
      reason: "Reddit needs a title and a body",
    });
  });

  it("refuses what a platform can't post", () => {
    expect(ownDraftOf("youtube", "text")).toEqual({ reason: "YouTube needs a video" });
    expect(ownDraftOf("linkedin", "x".repeat(3001))).toMatchObject({
      reason: expect.stringMatching(/over 3000/),
    });
  });
});
