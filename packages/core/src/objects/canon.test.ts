import { describe, expect, it } from "vitest";
import { PLATFORMS } from "../content/index.js";
import {
  CANON_PLATFORMS,
  CanonError,
  canonRef,
  fromUrl,
  normalUrl,
  preferRef,
  redditCommentRef,
  redditPostRef,
} from "./canon.js";

describe("every platform has a rule", () => {
  it("covers core's platform list", () => {
    expect([...CANON_PLATFORMS].sort()).toEqual([...PLATFORMS].sort());
  });

  it("reads an API id as itself, trimmed", () => {
    for (const p of [
      "youtube",
      "x",
      "instagram",
      "threads",
      "facebook",
      "tiktok",
      "google_business",
    ]) {
      expect(canonRef(p, "post", "  12345  ")).toBe("12345");
      expect(canonRef(p, "comment", "c-9")).toBe("c-9");
    }
  });

  it("refuses an unknown platform, an empty spelling and a spelling with spaces", () => {
    expect(() => canonRef("myspace", "post", "1")).toThrow(CanonError);
    expect(() => canonRef("x", "post", "")).toThrow(CanonError);
    expect(() => canonRef("x", "post", "   ")).toThrow(CanonError);
    expect(() => canonRef("x", "post", "12 34")).toThrow(CanonError);
    expect(() => canonRef("x", "post", "9".repeat(300))).toThrow(CanonError);
    expect(() => preferRef("myspace", "a", "b")).toThrow(CanonError);
  });
});

describe("reddit", () => {
  it("makes a post t3_ and a comment t1_ from a bare id or a fullname", () => {
    expect(canonRef("reddit", "post", "abc1")).toBe("t3_abc1");
    expect(canonRef("reddit", "post", "t3_abc1")).toBe("t3_abc1");
    expect(canonRef("reddit", "comment", "def2")).toBe("t1_def2");
    expect(canonRef("reddit", "comment", "t1_def2")).toBe("t1_def2");
    expect(canonRef("reddit", "post", "T3_ABC1")).toBe("t3_abc1");
  });

  it("refuses a fullname of the other kind and a name that is no id", () => {
    expect(() => canonRef("reddit", "post", "t1_abc")).toThrow(CanonError);
    expect(() => canonRef("reddit", "comment", "t3_abc")).toThrow(CanonError);
    expect(() => canonRef("reddit", "comment", "t2_abc")).toThrow(CanonError);
    expect(() => canonRef("reddit", "post", "t5_abc")).toThrow(CanonError);
    expect(() => canonRef("reddit", "post", "not an id")).toThrow(CanonError);
    expect(() => canonRef("reddit", "post", "ab-c")).toThrow(CanonError);
    expect(() => canonRef("reddit", "group", "abc")).toThrow(CanonError);
  });

  it("reads a Reddit URL", () => {
    const post = "https://www.reddit.com/r/example/comments/abc1/a_title/";
    expect(canonRef("reddit", "post", post)).toBe("t3_abc1");
    expect(canonRef("reddit", "comment", `${post}def2/`)).toBe("t1_def2");
    expect(canonRef("reddit", "comment", `${post}def2/?context=3`)).toBe("t1_def2");
    expect(canonRef("reddit", "post", "https://old.reddit.com/comments/abc1/x")).toBe("t3_abc1");
    expect(canonRef("reddit", "post", "https://redd.it/abc1")).toBe("t3_abc1");
    expect(canonRef("reddit", "post", "reddit.com/r/example/comments/abc1/a_title")).toBe(
      "t3_abc1",
    );
    expect(fromUrl(post)).toEqual({ platform: "reddit", kind: "post", ref: "t3_abc1" });
    expect(fromUrl(`${post}def2/`)).toEqual({
      platform: "reddit",
      kind: "comment",
      ref: "t1_def2",
    });
  });

  it("refuses a comment URL read as a post and the other way", () => {
    const post = "https://www.reddit.com/r/example/comments/abc1/a_title/";
    expect(() => canonRef("reddit", "post", `${post}def2/`)).toThrow(CanonError);
    expect(() => canonRef("reddit", "comment", post)).toThrow(CanonError);
    expect(() => canonRef("reddit", "post", "https://www.reddit.com/r/example/")).toThrow(
      CanonError,
    );
  });

  it("exports the two rules channel-reddit uses", () => {
    expect(redditCommentRef("abc")).toBe("t1_abc");
    expect(redditCommentRef("t1_abc")).toBe("t1_abc");
    expect(redditPostRef("abc")).toBe("t3_abc");
  });
});

describe("linkedin", () => {
  it("keeps a post URN as given and refuses a bare number", () => {
    for (const urn of ["urn:li:share:100", "urn:li:ugcPost:200", "urn:li:activity:300"])
      expect(canonRef("linkedin", "post", urn)).toBe(urn);
    expect(() => canonRef("linkedin", "post", "300")).toThrow(CanonError);
    expect(() => canonRef("linkedin", "post", "urn:li:person:300")).toThrow(CanonError);
  });

  it("reads a feed URL and a /posts/ slug", () => {
    expect(
      canonRef(
        "linkedin",
        "post",
        "https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000001/",
      ),
    ).toBe("urn:li:activity:7000000000000000001");
    expect(
      canonRef(
        "linkedin",
        "post",
        "https://www.linkedin.com/feed/update/urn:li:ugcPost:7000000000000000002",
      ),
    ).toBe("urn:li:ugcPost:7000000000000000002");
    expect(
      canonRef(
        "linkedin",
        "post",
        "https://www.linkedin.com/posts/example-person_some-words-activity-7000000000000000003-aB1c?utm_source=share",
      ),
    ).toBe("urn:li:activity:7000000000000000003");
    expect(
      fromUrl("https://www.linkedin.com/posts/example-person_words-share-7000000000000000004-xY9z"),
    ).toEqual({ platform: "linkedin", kind: "post", ref: "urn:li:share:7000000000000000004" });
  });

  it("reads a comment as its numeric id", () => {
    expect(canonRef("linkedin", "comment", "7000000000000000009")).toBe("7000000000000000009");
    expect(
      canonRef(
        "linkedin",
        "comment",
        "urn:li:comment:(urn:li:activity:7000000000000000001,7000000000000000009)",
      ),
    ).toBe("7000000000000000009");
    expect(
      fromUrl(
        "https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000001/?commentUrn=urn%3Ali%3Acomment%3A%28urn%3Ali%3Aactivity%3A7000000000000000001%2C7000000000000000009%29",
      ),
    ).toEqual({ platform: "linkedin", kind: "comment", ref: "7000000000000000009" });
    expect(() => canonRef("linkedin", "comment", "urn:li:activity:3")).toThrow(CanonError);
    expect(() => canonRef("linkedin", "group", "1")).toThrow(CanonError);
  });

  it("prefers the API URN over the feed's activity URN", () => {
    const act = "urn:li:activity:1";
    expect(preferRef("linkedin", act, "urn:li:ugcPost:2")).toBe("urn:li:ugcPost:2");
    expect(preferRef("linkedin", act, "urn:li:share:3")).toBe("urn:li:share:3");
    expect(preferRef("linkedin", "urn:li:ugcPost:2", act)).toBe("urn:li:ugcPost:2");
    expect(preferRef("linkedin", "urn:li:share:3", "urn:li:ugcPost:2")).toBe("urn:li:share:3");
    expect(preferRef("linkedin", act, "urn:li:activity:9")).toBe(act);
  });
});

describe("youtube", () => {
  const id = "dQw4w9WgXcQ";
  it("reads every video URL form", () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=30s&list=PL1`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}?si=abc`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}`,
      `https://www.youtube.com/embed/${id}`,
    ]) {
      expect(canonRef("youtube", "post", url)).toBe(id);
      expect(fromUrl(url)).toEqual({ platform: "youtube", kind: "post", ref: id });
    }
  });

  it("refuses a URL with no video id", () => {
    expect(() => canonRef("youtube", "post", "https://www.youtube.com/@example")).toThrow(
      CanonError,
    );
    expect(() => canonRef("youtube", "post", "https://www.youtube.com/watch")).toThrow(CanonError);
    expect(fromUrl("https://www.youtube.com/@example")).toBeNull();
  });
});

describe("x", () => {
  it("reads a status URL as a post or a comment", () => {
    for (const host of ["x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]) {
      const url = `https://${host}/example/status/1700000000000000001?s=20`;
      expect(canonRef("x", "post", url)).toBe("1700000000000000001");
      expect(canonRef("x", "comment", url)).toBe("1700000000000000001");
    }
    expect(fromUrl("https://x.com/example/status/17")).toEqual({
      platform: "x",
      kind: "post",
      ref: "17",
    });
  });

  it("refuses a profile URL", () => {
    expect(() => canonRef("x", "post", "https://x.com/example")).toThrow(CanonError);
    expect(fromUrl("https://x.com/example")).toBeNull();
  });
});

describe("tiktok", () => {
  it("reads a video URL", () => {
    expect(
      canonRef(
        "tiktok",
        "post",
        "https://www.tiktok.com/@example/video/7000000000000000005?lang=en",
      ),
    ).toBe("7000000000000000005");
    expect(() => canonRef("tiktok", "post", "https://www.tiktok.com/@example")).toThrow(CanonError);
  });
});

describe("instagram, threads, facebook, google_business", () => {
  it("refuses a URL that does not carry the API id", () => {
    expect(() => canonRef("instagram", "post", "https://www.instagram.com/p/Cabc123/")).toThrow(
      CanonError,
    );
    expect(() => canonRef("instagram", "post", "https://www.instagram.com/reel/Cabc123/")).toThrow(
      CanonError,
    );
    expect(() =>
      canonRef("threads", "post", "https://www.threads.net/@example/post/Cabc123"),
    ).toThrow(CanonError);
    expect(() =>
      canonRef("facebook", "post", "https://www.facebook.com/example/posts/123"),
    ).toThrow(CanonError);
    expect(fromUrl("https://www.instagram.com/p/Cabc123/")).toBeNull();
  });

  it("reads a Facebook group as a group", () => {
    expect(canonRef("facebook", "group", "example-group")).toBe("example-group");
  });
});

describe("fromUrl", () => {
  it("is null for text that is no URL and a URL no rule reads", () => {
    expect(fromUrl("abc")).toBeNull();
    expect(fromUrl("")).toBeNull();
    expect(fromUrl("https://example.com/page")).toBeNull();
  });
});

describe("normalUrl", () => {
  it("lower-cases the host, drops www, query, fragment and the trailing slash", () => {
    expect(normalUrl("HTTP://WWW.Example.COM/Path/To/?utm=1&b=2#top")).toBe(
      "https://example.com/Path/To",
    );
    expect(normalUrl("https://example.com/")).toBe("https://example.com");
    expect(normalUrl("example.com/a/b/")).toBe("https://example.com/a/b");
  });

  it("keeps a YouTube watch id and drops the rest of the query", () => {
    expect(normalUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=9&list=PL1#x")).toBe(
      "https://youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(normalUrl("https://youtu.be/dQw4w9WgXcQ?si=1")).toBe("https://youtu.be/dQw4w9WgXcQ");
  });

  it("gives one form for many spellings", () => {
    const a = normalUrl("https://www.reddit.com/r/example/comments/abc1/title/");
    const b = normalUrl("https://REDDIT.com/r/example/comments/abc1/title?utm_source=x");
    expect(a).toBe(b);
  });

  it("returns text that is no URL, trimmed", () => {
    expect(normalUrl("  t3_abc ")).toBe("t3_abc");
  });
});

describe("preferRef", () => {
  it("keeps the first spelling off LinkedIn", () => {
    expect(preferRef("reddit", "t3_a", "t3_b")).toBe("t3_a");
    expect(preferRef("x", "1", "2")).toBe("1");
  });
});
