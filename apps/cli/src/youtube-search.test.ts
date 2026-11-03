import { describe, expect, it } from "vitest";
import { huntSearch } from "./youtube-search.js";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const VIDEO = {
  id: "abc123def45",
  snippet: { title: " Launch film ", channelTitle: "Maker", publishedAt: "2026-10-01T10:00:00Z" },
  statistics: { viewCount: "12345" },
  contentDetails: { duration: "PT1M30S" },
};

describe("huntSearch", () => {
  it("maps a Data API hit to a find", async () => {
    const calls: string[] = [];
    const search = huntSearch({
      key: "k",
      ytDlp: "/nonexistent/yt-dlp",
      say: () => {},
      fetch: (async (url: string) => {
        calls.push(new URL(url).pathname);
        return url.includes("/search?")
          ? json(200, { items: [{ id: { videoId: VIDEO.id } }] })
          : json(200, { items: [VIDEO] });
      }) as typeof fetch,
    });
    expect(await search("launch film", 30)).toEqual([
      {
        url: `https://youtube.com/watch?v=${VIDEO.id}`,
        title: "Launch film",
        creator: "Maker",
        views: 12345,
        publishedAt: new Date("2026-10-01T00:00:00Z"),
        duration: 90,
      },
    ]);
    expect(calls).toEqual(["/youtube/v3/search", "/youtube/v3/videos"]);
  });

  it("stops asking the API once the day's quota is spent", async () => {
    const said: string[] = [];
    let asked = 0;
    const search = huntSearch({
      key: "k",
      ytDlp: "/nonexistent/yt-dlp",
      say: (l) => said.push(l),
      fetch: (async () => {
        asked++;
        return json(403, { error: { message: "spent", errors: [{ reason: "quotaExceeded" }] } });
      }) as typeof fetch,
    });
    // The fallback is yt-dlp, absent here: it fails, the API is not asked again.
    await expect(search("a", 5)).rejects.toThrow();
    await expect(search("b", 5)).rejects.toThrow();
    expect(asked).toBe(1);
    expect(said[0]).toMatch(/quotaExceeded/);
  });
});
