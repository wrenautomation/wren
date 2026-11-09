import { describe, expect, it } from "vitest";
import { cleanUrl, kindOf, needsMac, typeOf, youtubeThumb } from "./links.js";
import { articleMd, fileOf, frontField, pageText, secondsOf } from "./read.js";

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
    expect(kindOf("https://x.com/someone/status/123")).toBe("post");
    expect(kindOf("https://instagram.com/p/Cabc123")).toBe("post");
    expect(kindOf("https://www.threads.net/@someone/post/Cabc")).toBe("post");
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

describe("reading", () => {
  it("reads lengths", () => {
    expect([secondsOf("754"), secondsOf("12:34"), secondsOf("1:02:03"), secondsOf("soon")]).toEqual(
      [754, 754, 3723, null],
    );
  });

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
    expect(fileOf("https://www.instagram.com/reel/DeCOSeGxPY-/")).toBe("instagram-DeCOSeGxPY-.md");
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
