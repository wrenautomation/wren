import { describe, expect, it } from "vitest";
import { creatorOf } from "./creators.js";
import { tagOf } from "./drive.js";
import { decode, feedLinkOf, ogImageOf, parseFeed, secondsOf, sourceKindOf } from "./feeds.js";
import { cleanUrl, creatorSite, kindOf, needsMac, typeOf, youtubeThumb } from "./links.js";
import { articleMd, fileOf, frontField, pageText } from "./read.js";
import { chaptersOf, momentsOf, timed } from "./score.js";

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
    expect(needsMac("episode", "https://cdn.example.com/1.mp3")).toBe(true);
  });

  it("names the sites whose creators can't be followed yet", () => {
    expect(creatorSite("https://www.instagram.com/someone/")).toBe("Instagram");
    expect(creatorSite("https://www.tiktok.com/@someone")).toBe("TikTok");
    expect(creatorSite("https://twitter.com/someone")).toBe("X");
    expect(creatorSite("https://www.youtube.com/@someone")).toBeNull();
  });
});

describe("typeOf", () => {
  it("tells each type by address, kind and source", () => {
    expect(typeOf("https://youtube.com/watch?v=abc123XYZ_-", "video")).toBe("youtube");
    expect(typeOf("https://youtube.com/shorts/abc123XYZ_-", "reel")).toBe("shorts");
    expect(typeOf("https://instagram.com/reel/Cabc", "reel")).toBe("instagram");
    expect(typeOf("https://www.tiktok.com/@a/video/1", "reel")).toBe("tiktok");
    expect(typeOf("https://x.com/a/status/1", "reel")).toBe("x");
    expect(typeOf("https://www.reddit.com/r/a/comments/1", "article")).toBe("reddit");
    expect(typeOf("https://show.example/1", "episode")).toBe("podcast");
    expect(typeOf("https://a.substack.com/p/b", "article")).toBe("newsletter");
    expect(typeOf("https://blog.example/p", "article", "releases")).toBe("releases");
    expect(typeOf("https://blog.example/p", "article", "forum")).toBe("blog");
    expect(typeOf("https://blog.example/p", "article")).toBe("link");
    expect(youtubeThumb("https://youtube.com/watch?v=abc123XYZ_-")).toBe(
      "https://i.ytimg.com/vi/abc123XYZ_-/hqdefault.jpg",
    );
    expect(youtubeThumb("https://blog.example/p")).toBeNull();
  });
});

describe("drive helpers", () => {
  it("keeps tags short and plain", () => {
    expect(tagOf("  #Cold Email! ")).toBe("cold-email");
    expect(tagOf("x".repeat(60))).toHaveLength(40);
  });

  it("reads moments from chapters and from the scorer", () => {
    expect(chaptersOf("## [0:00] Intro\n\ntext\n\n## [1:02:03] Late\n## Not timed")).toEqual([
      { t: 0, label: "Intro" },
      { t: 3723, label: "Late" },
    ]);
    expect(
      momentsOf([
        { at: "2:00", label: "b" },
        { at: "0:30", label: "a" },
        { at: "x", label: "c" },
      ]),
    ).toEqual([
      { t: 30, label: "a" },
      { t: 120, label: "b" },
    ]);
    expect([timed("[1:05] said"), timed("no marks")]).toEqual([true, false]);
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

  it("keeps each item's picture, length and audio, and the feed's own picture", () => {
    const xml = `<rss xmlns:itunes="x" xmlns:media="y"><channel><title>Show</title><generator>Substack</generator>
      <image><url>http://cdn.example.com/show.png</url></image>
      <item><title>A</title><link>https://show.example.com/a</link><itunes:duration>1:02:03</itunes:duration>
      <enclosure url="https://cdn.example.com/a.jpg" type="image/jpeg"/><enclosure url="https://cdn.example.com/a.mp3" type="audio/mpeg"/></item>
      <item><title>B</title><link>https://show.example.com/b</link><media:thumbnail url="https://cdn.example.com/b.jpg"/></item>
      </channel></rss>`;
    const feed = parseFeed(xml);
    expect(feed.image).toBe("https://cdn.example.com/show.png");
    expect(feed.items.map((i) => [i.thumbnail, i.duration, i.enclosure])).toEqual([
      ["https://cdn.example.com/a.jpg", 3723, "https://cdn.example.com/a.mp3"],
      ["https://cdn.example.com/b.jpg", null, null],
    ]);
    expect(sourceKindOf("https://letters.example.com/feed", { ...feed, podcast: false })).toBe(
      "newsletter",
    );
    expect(
      sourceKindOf("https://www.reddit.com/r/synthetic/.rss", {
        ...feed,
        podcast: false,
        generator: "",
      }),
    ).toBe("reddit");
  });

  it("reads lengths and a page's og:image", () => {
    expect([secondsOf("754"), secondsOf("12:34"), secondsOf("1:02:03"), secondsOf("soon")]).toEqual(
      [754, 754, 3723, null],
    );
    expect(ogImageOf(`<meta property="og:image" content="https://site.example/a.png">`)).toBe(
      "https://site.example/a.png",
    );
    expect(ogImageOf(`<meta property="og:image" content="/a.png">`)).toBeNull();
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

describe("creatorOf", () => {
  it("names a creator by profile address", () => {
    expect(creatorOf("https://www.instagram.com/synth.creator/?hl=en")).toEqual({
      kind: "instagram",
      handle: "synth.creator",
      page: "https://instagram.com/synth.creator",
    });
    expect(creatorOf("twitter.com/synthposter")?.page).toBe("https://x.com/synthposter");
    expect(creatorOf("https://www.tiktok.com/@synthtok?lang=en")?.handle).toBe("synthtok");
    expect(creatorOf("https://www.tiktok.com/synthtok")).toBeNull();
    expect(creatorOf("https://example.com/someone")).toBeNull();
  });
});
