import { describe, expect, it } from "vitest";
import { decode, feedLinkOf, parseFeed, sourceKindOf } from "./feeds.js";
import { cleanUrl, creatorSite, kindOf, needsMac } from "./links.js";
import { articleMd, fileOf, frontField, pageText } from "./read.js";

describe("cleanUrl", () => {
  it("makes a share and its feed entry one address", () => {
    expect(cleanUrl("https://youtu.be/abc123XYZ_-?si=track")).toBe(
      "https://youtube.com/watch?v=abc123XYZ_-",
    );
    expect(cleanUrl("https://www.youtube.com/watch?v=abc123XYZ_-&feature=share#t=3")).toBe(
      "https://youtube.com/watch?v=abc123XYZ_-",
    );
    expect(cleanUrl("https://m.youtube.com/shorts/abc123XYZ_-?si=x")).toBe(
      "https://youtube.com/shorts/abc123XYZ_-",
    );
    expect(cleanUrl("https://www.instagram.com/reel/Cabc123/?igsh=xyz&utm_source=ig")).toBe(
      "https://instagram.com/reel/Cabc123",
    );
    expect(cleanUrl("https://x.com/someone/status/123?s=20&t=abc")).toBe(
      "https://x.com/someone/status/123",
    );
  });

  it("keeps params a page needs", () => {
    expect(cleanUrl("https://example.com/post?id=7&utm_medium=email")).toBe(
      "https://example.com/post?id=7",
    );
    expect(cleanUrl("https://example.com/search?s=term")).toBe("https://example.com/search?s=term");
  });

  it("refuses what isn't a web address", () => {
    expect(() => cleanUrl("javascript:alert(1)")).toThrow();
    expect(() => cleanUrl("not a link")).toThrow();
  });
});

describe("kindOf", () => {
  it("tells videos and reels from text", () => {
    expect(kindOf("https://youtube.com/watch?v=abc123XYZ_-")).toBe("video");
    expect(kindOf("https://youtube.com/shorts/abc123XYZ_-")).toBe("reel");
    expect(kindOf("https://instagram.com/reel/Cabc123")).toBe("reel");
    expect(kindOf("https://tiktok.com/@someone/video/123")).toBe("reel");
    expect(kindOf("https://x.com/someone/status/123")).toBe("reel");
    expect(kindOf("https://example.substack.com/p/a-post")).toBe("article");
    expect(kindOf("https://example.com/ep/1", "https://cdn.example.com/1.mp3")).toBe("episode");
  });

  it("sends only video to the Mac", () => {
    expect(needsMac("video")).toBe(true);
    expect(needsMac("reel")).toBe(true);
    expect(needsMac("article")).toBe(false);
    expect(needsMac("episode")).toBe(false);
  });

  it("names the sites whose creators can't be followed yet", () => {
    expect(creatorSite("https://www.instagram.com/someone/")).toBe("Instagram");
    expect(creatorSite("https://www.tiktok.com/@someone")).toBe("TikTok");
    expect(creatorSite("https://twitter.com/someone")).toBe("X");
    expect(creatorSite("https://www.youtube.com/@someone")).toBeNull();
  });
});

describe("feeds", () => {
  it("finds a page's feed", () => {
    const html = `<html><head><link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml"></head></html>`;
    expect(feedLinkOf(html, "https://blog.example.com/about")).toBe(
      "https://blog.example.com/feed.xml",
    );
    expect(feedLinkOf("<html></html>", "https://blog.example.com")).toBeNull();
  });

  it("reads a podcast's episodes and kind", () => {
    const xml = `<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Show</title>
      <item><title>Ep 1</title><link>https://show.example.com/1</link><itunes:author>Host</itunes:author>
      <enclosure url="https://cdn.example.com/1.mp3" type="audio/mpeg"/><description>Notes</description></item>
      </channel></rss>`;
    const feed = parseFeed(xml);
    expect(feed.podcast).toBe(true);
    expect(feed.items[0]).toMatchObject({
      creator: "Host",
      enclosure: "https://cdn.example.com/1.mp3",
    });
    expect(sourceKindOf("https://show.example.com/feed", feed)).toBe("podcast");
    expect(sourceKindOf("https://www.youtube.com/feeds/videos.xml?channel_id=x", feed)).toBe(
      "youtube",
    );
  });

  it("knows the full named table and keeps nbsp a plain space", () => {
    expect(decode("caf&eacute; &hearts; &rarr;&nbsp;x &#99999999;")).toBe("café ♥ → x �");
  });
});

describe("reading", () => {
  it("keeps a page's main text, headings and paragraphs", () => {
    const html = `<html><head><title>T</title><meta property="og:title" content="A post">
      <meta name="author" content="Ann"></head><body><nav>menu</nav><article><h2>Step one</h2>
      <p>First &amp; best.</p><ul><li>a</li><li>b</li></ul></article><footer>f</footer></body></html>`;
    const page = pageText(html);
    expect(page.title).toBe("A post");
    expect(page.creator).toBe("Ann");
    expect(page.text).toContain("## Step one");
    expect(page.text).toContain("First & best.");
    expect(page.text).not.toContain("menu");
  });

  it("names a source file as sop add does, and reads front matter back", () => {
    expect(fileOf("https://youtube.com/watch?v=abc123XYZ_-")).toBe("youtube-abc123XYZ_-.md");
    expect(fileOf("https://blog.example.com/p/a-post")).toBe("web-blog-example-com-p-a-post.md");
    const md = articleMd({
      url: "https://blog.example.com/p/a-post",
      title: 'A "quoted" post',
      creator: null,
      publishedAt: new Date("2026-01-02T00:00:00Z"),
      text: "Body",
    });
    expect(frontField(md, "title")).toBe('A "quoted" post');
    expect(frontField(md, "uploaded")).toBe("2026-01-02");
    expect(frontField(md, "channel")).toBeNull();
  });
});
