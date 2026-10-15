import type { TikTokNumbers } from "@wren/content/connect";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountFace, TikTokNumbersView } from "./social-bits.js";

const N: TikTokNumbers = {
  followers: 1280,
  likes: 20450,
  videos: 2,
  recent: [
    {
      id: "v1",
      title: "Preview video",
      views: 1800,
      likes: 80,
      comments: 3,
      url: "https://www.tiktok.com/@acme/video/1",
      cover: "https://p16.tiktokcdn.example/1.jpeg",
      postedAt: "2026-10-14T12:00:00.000Z",
    },
  ],
  gaps: [],
  asOf: "2026-10-15T12:00:00.000Z",
};

describe("AccountFace", () => {
  it("loads the picture from the CDN with no referrer; none is a letter tile", () => {
    const img = renderToStaticMarkup(
      <AccountFace url="https://p16.tiktokcdn.example/a.jpeg" name="Acme" />,
    );
    expect(img).toContain('src="https://p16.tiktokcdn.example/a.jpeg"');
    expect(img).toContain('referrerPolicy="no-referrer"');
    expect(renderToStaticMarkup(<AccountFace url={null} name="@acme" />)).toContain(">a</span>");
  });
});

describe("TikTokNumbersView", () => {
  it("shows followers, likes, videos and each video's views with its link", () => {
    const html = renderToStaticMarkup(<TikTokNumbersView n={N} />);
    for (const s of ["Followers", "1.3K", "20K", "Videos", "1.8K views", "80 likes"])
      expect(html).toContain(s);
    expect(html).toContain('href="https://www.tiktok.com/@acme/video/1"');
  });

  it("says a missing scope instead of an empty list", () => {
    const html = renderToStaticMarkup(
      <TikTokNumbersView
        n={{ ...N, followers: null, recent: [], gaps: ["Videos need video.list."] }}
      />,
    );
    expect(html).toContain("Videos need video.list.");
    expect(html).not.toContain("No videos on this account yet.");
  });
});
