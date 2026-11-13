import { describe, expect, it } from "vitest";
import {
  instagramSaved,
  linkedinSaved,
  linkedinSource,
  xBookmarks,
  xHasVideo,
  xSource,
  youtubeVideos,
} from "./captures.js";

const user = (screen_name: string) => ({
  user_results: { result: { core: { screen_name } } },
});

const tweet = {
  __typename: "Tweet",
  rest_id: "100",
  core: user("example_author"),
  legacy: {
    created_at: "Wed Nov 11 10:00:00 +0000 2026",
    full_text: "First line here\nsee https://t.co/abc and pic https://t.co/pic",
    entities: {
      urls: [{ url: "https://t.co/abc", expanded_url: "https://example.com/post" }],
      media: [{ url: "https://t.co/pic" }],
    },
    extended_entities: {
      media: [{ type: "photo", media_url_https: "https://pbs.example/1.jpg" }],
    },
    favorite_count: 1200,
    retweet_count: 30,
    reply_count: 4,
    bookmark_count: 900,
  },
  views: { count: "50000" },
  quoted_status_result: {
    result: { rest_id: "99", core: user("quoted_one"), legacy: { full_text: "the quoted words" } },
  },
};

describe("x bookmarks", () => {
  it("unwraps, opens links, keeps quote, pictures and counts", () => {
    const [s] = xBookmarks({ items: [{ __typename: "TweetWithVisibilityResults", tweet }] });
    expect(s).toMatchObject({
      platform: "x",
      ref: "100",
      url: "https://x.com/example_author/status/100",
      author: "example_author",
    });
    expect(xHasVideo(s?.raw)).toBe(false);
    const src = xSource(s?.raw, s?.url ?? "", "2026-11-12");
    expect(src.name).toBe("x-100.md");
    expect(src.md).toContain('title: "@example_author: First line here"');
    expect(src.md).toContain("see https://example.com/post and pic");
    expect(src.md).not.toContain("t.co");
    expect(src.md).toContain("## Quoting @quoted_one\n\nthe quoted words");
    expect(src.md).toContain("- https://pbs.example/1.jpg");
    expect(src.md).toContain("50,000 views, 1,200 likes, 30 reposts, 4 replies, 900 bookmarks");
  });

  it("reads a note tweet's whole text and an article", () => {
    const long = {
      ...tweet,
      note_tweet: { note_tweet_results: { result: { text: "The whole long text" } } },
      article: {
        article_results: { result: { rest_id: "7", title: "A title", preview_text: "Preview" } },
      },
    };
    const md = xSource(long, "https://x.com/a/status/100", "2026-11-12").md;
    expect(md).toContain("The whole long text");
    expect(md).toContain("## Article: A title\n\nPreview\n\nhttps://x.com/i/article/7");
  });

  it("knows a video", () => {
    const v = {
      ...tweet,
      legacy: { ...tweet.legacy, extended_entities: { media: [{ type: "video" }] } },
    };
    expect(xHasVideo(v)).toBe(true);
  });

  it("skips an item with no id", () => {
    expect(xBookmarks({ items: [{ __typename: "TweetTombstone" }] })).toEqual([]);
  });
});

describe("instagram saved", () => {
  it("links reels and posts and names the collections", () => {
    const out = instagramSaved({
      collections: [{ collection_id: "1", collection_name: "Edits" }],
      media: [
        {
          code: "AbC",
          product_type: "clips",
          taken_at: 1_700_000_000,
          user: { username: "maker" },
          saved_collection_ids: ["1", "2"],
        },
        { code: "XyZ", product_type: "feed" },
        { product_type: "feed" },
      ],
    });
    expect(out.map((s) => s.url)).toEqual([
      "https://www.instagram.com/reel/AbC/",
      "https://www.instagram.com/p/XyZ/",
    ]);
    expect(out[0]).toMatchObject({ ref: "AbC", author: "maker", lists: ["Edits"] });
    expect(out[0]?.at?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
  });
});

describe("youtube", () => {
  it("reads liked videos and playlist items", () => {
    const liked = youtubeVideos(
      {
        items: [
          {
            kind: "youtube#video",
            id: "abcdefghijk",
            snippet: { channelTitle: "Chan", publishedAt: "2026-01-01T00:00:00Z" },
          },
        ],
      },
      null,
    );
    expect(liked[0]).toMatchObject({
      ref: "abcdefghijk",
      author: "Chan",
      lists: [],
      url: "https://www.youtube.com/watch?v=abcdefghijk",
    });
    const items = youtubeVideos(
      {
        items: [
          {
            kind: "youtube#playlistItem",
            snippet: { resourceId: { videoId: "zyxwvutsrqp" }, videoOwnerChannelTitle: "Owner" },
          },
        ],
      },
      "Study",
    );
    expect(items[0]).toMatchObject({ ref: "zyxwvutsrqp", author: "Owner", lists: ["Study"] });
  });
});

describe("linkedin saved", () => {
  const post = {
    urn: "urn:li:activity:123",
    url: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
    author: { name: "A Person", url: "https://www.linkedin.com/in/x", headline: "Builds things" },
    text: "Line one\nLine two",
    age: "2w",
    at: "2026-10-29T00:00:00.000Z",
    images: ["https://media.example/1.jpg"],
  };
  it("reads a post and builds its source", () => {
    const [s] = linkedinSaved({ posts: [post, { text: "no urn" }] });
    expect(s).toMatchObject({
      platform: "linkedin",
      ref: "urn:li:activity:123",
      author: "A Person",
    });
    const src = linkedinSource(post, post.url, "2026-11-12");
    expect(src.name).toBe("linkedin-123.md");
    expect(src.md).toContain('title: "A Person: Line one"');
    expect(src.md).toContain("A Person · Builds things · https://www.linkedin.com/in/x");
    expect(src.md).toContain("Saved on 2026-11-12; posted 2w before.");
  });
});
