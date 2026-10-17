import { describe, expect, it } from "vitest";
import { itemLink, usableUrl } from "./touch-link.js";

const POST = "urn:li:activity:7000000000000000001";
const enc = encodeURIComponent;

describe("itemLink", () => {
  it("LinkedIn: a comment on a post by its numeric id", () => {
    const urn = `urn:li:comment:(${POST},7100)`;
    expect(itemLink("linkedin", "comment", { externalId: "7100", post: POST })).toBe(
      `https://www.linkedin.com/feed/update/${POST}/?commentUrn=${enc(urn)}`,
    );
  });
  it("LinkedIn: a whole comment URN, post taken from it", () => {
    const urn = `urn:li:comment:(${POST},7100)`;
    expect(itemLink("linkedin", "comment", { externalId: urn })).toBe(
      `https://www.linkedin.com/feed/update/${POST}/?commentUrn=${enc(urn)}`,
    );
  });
  it("LinkedIn: post taken from the row's url", () => {
    const url = `https://www.linkedin.com/feed/update/${POST}/`;
    expect(itemLink("linkedin", "comment", { externalId: "7100", url })).toContain(
      `/feed/update/${POST}/?commentUrn=`,
    );
  });
  it("LinkedIn: a reply names the comment it answers", () => {
    const parent = `urn:li:comment:(${POST},7100)`;
    const reply = `urn:li:comment:(${POST},7101)`;
    expect(itemLink("linkedin", "reply", { externalId: "7101", post: POST, parent: "7100" })).toBe(
      `https://www.linkedin.com/feed/update/${POST}/?commentUrn=${enc(parent)}&replyUrn=${enc(reply)}`,
    );
  });
  it("LinkedIn: no link without a post or with a profile url", () => {
    expect(itemLink("linkedin", "comment", { externalId: "7100" })).toBeNull();
    expect(
      itemLink("linkedin", "connect", { url: "https://www.linkedin.com/in/sam-rivera/" }),
    ).toBeNull();
  });
  it("LinkedIn: a DM opens its thread when the url is one", () => {
    const url = "https://www.linkedin.com/messaging/thread/2-abc123==/";
    expect(itemLink("linkedin", "dm", { url })).toBe(url);
    expect(itemLink("linkedin", "dm", { url: "https://www.linkedin.com/in/sam/" })).toBeNull();
  });
  it("Reddit: t1_ and t3_ ids and bare ids", () => {
    const want = "https://www.reddit.com/comments/abc123/_/def456/";
    expect(itemLink("reddit", "comment", { externalId: "t1_def456", post: "t3_abc123" })).toBe(
      want,
    );
    expect(itemLink("reddit", "reply", { externalId: "def456", post: "abc123" })).toBe(want);
  });
  it("Reddit: post taken from the thread url", () => {
    expect(
      itemLink("reddit", "comment", {
        externalId: "t1_def456",
        url: "https://www.reddit.com/r/test/comments/abc123/a_title/",
      }),
    ).toBe("https://www.reddit.com/comments/abc123/_/def456/");
  });
  it("Reddit: no link without a comment id", () => {
    expect(itemLink("reddit", "comment", { post: "abc123" })).toBeNull();
  });
  it("X: a status by its id", () => {
    expect(itemLink("x", "comment", { externalId: "1800000000000000001" })).toBe(
      "https://x.com/i/status/1800000000000000001",
    );
    expect(itemLink("x", "comment", { externalId: "not-an-id" })).toBeNull();
  });
  it("Facebook: <post>_<comment>", () => {
    expect(itemLink("facebook", "comment", { externalId: "111_222" })).toBe(
      "https://www.facebook.com/111_222",
    );
    expect(itemLink("facebook", "comment", { externalId: "222" })).toBeNull();
  });
  it("Instagram: only from a permalink, never a numeric media id", () => {
    expect(
      itemLink("instagram", "comment", {
        externalId: "17800000000000001",
        url: "https://www.instagram.com/p/Cxyz_123/",
      }),
    ).toBe("https://www.instagram.com/p/Cxyz_123/c/17800000000000001/");
    expect(
      itemLink("instagram", "comment", {
        externalId: "17800000000000001",
        url: "https://www.instagram.com/p/17800000000000009/",
      }),
    ).toBeNull();
  });
  it("YouTube: a comment id on its video", () => {
    expect(itemLink("youtube", "comment", { externalId: "UgxAbC123", post: "dQw4w9WgXcQ" })).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&lc=UgxAbC123",
    );
  });
  it("kinds with no page and unknown platforms give null", () => {
    expect(itemLink("x", "like", { externalId: "1800000000000000001" })).toBeNull();
    expect(itemLink("x", "follow", {})).toBeNull();
    expect(itemLink("tiktok", "comment", { externalId: "1" })).toBeNull();
  });
});

describe("usableUrl", () => {
  it("drops the numeric Instagram media form", () => {
    expect(usableUrl("https://www.instagram.com/p/17800000000000009/")).toBeNull();
    expect(usableUrl("https://www.instagram.com/p/Cxyz_123/")).toBe(
      "https://www.instagram.com/p/Cxyz_123/",
    );
    expect(usableUrl("")).toBeNull();
    expect(usableUrl(null)).toBeNull();
  });
});
