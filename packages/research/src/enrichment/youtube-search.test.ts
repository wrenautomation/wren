/**
 * The `youtubeSearch` stage's pure parts: the site a channel links, how a channel becomes a row,
 * and how the API's errors end a pass. Spent units stop it; any other error skips the search.
 */
import { IDENTITY_KEY } from "@wren/core";
import type { Queryable } from "@wren/db";
import { describe, expect, it } from "vitest";
import { YouTubeError, type YouTubeGet } from "./youtube.js";
import {
  channelSite,
  countYouTubeSearchUnit,
  emptyYouTubeSearchStats,
  type FoundChannel,
  searchChannels,
  youtubeSearchRef,
  youtubeSearchRows,
  youtubeSearchUnit,
} from "./youtube-search.js";

const channel = (id: string, title: string, description: string): FoundChannel => ({
  id,
  snippet: { title, description },
  statistics: { subscriberCount: "12" },
});

describe("channelSite", () => {
  it("is the first linked site that isn't a platform, registrable", () => {
    expect(
      channelSite(
        "Follow us https://instagram.com/acme and visit https://jobs.acme-staffing.example/apply",
      ),
    ).toBe("acme-staffing.example");
    expect(channelSite("www.acme.example, the rest")).toBe("acme.example");
    expect(channelSite("Book: https://calendly.com/acme")).toBeNull();
    expect(channelSite("no links here")).toBeNull();
    expect(channelSite("https://acme.example", ["acme.example"])).toBeNull();
  });
});

describe("youtubeSearchRows", () => {
  it("keys a channel by its own site, else by the channel; the resource is kept whole", () => {
    const linked = channel("UC1", "Acme Staffing", "https://acme.example");
    const bare = channel("UC2", "Solo Recruiter", "Tips every week");
    const [a, b] = youtubeSearchRows([linked, bare], "staffing agency");
    expect(a).toEqual({
      company_name: "Acme Staffing",
      website: "acme.example",
      query: "staffing agency",
      youtube: linked,
    });
    expect(b).toMatchObject({
      website: "https://www.youtube.com/channel/UC2",
      youtube: bare,
      [IDENTITY_KEY]: { source_key: "yt:UC2" },
    });
  });

  it("a search's ref carries its text", () => {
    expect(youtubeSearchRef("temp agency")).toBe("youtube/search?q=temp+agency");
  });
});

describe("searchChannels", () => {
  it("reads every found channel in one call, in the search's order", async () => {
    const calls: [string, Record<string, string>][] = [];
    const get: YouTubeGet = async (resource, query) => {
      calls.push([resource, query]);
      if (resource === "search")
        return { items: [{ id: { channelId: "UC2" } }, { id: { channelId: "UC1" } }, {}] };
      return { items: [channel("UC1", "One", ""), channel("UC2", "Two", "")] };
    };
    expect((await searchChannels(get, "q")).map((c) => c.id)).toEqual(["UC2", "UC1"]);
    expect(calls.map(([r]) => r)).toEqual(["search", "channels"]);
    expect(calls[0]?.[1]).toMatchObject({ type: "channel", maxResults: "50" });
    expect(calls[1]?.[1]?.id).toBe("UC2,UC1");
  });

  it("a search that finds nothing spends no second call", async () => {
    let n = 0;
    const get: YouTubeGet = async () => {
      n++;
      return { items: [] };
    };
    expect(await searchChannels(get, "q")).toEqual([]);
    expect(n).toBe(1);
  });
});

describe("youtubeSearchUnit", () => {
  const db = {} as Queryable;
  const failing =
    (err: Error): YouTubeGet =>
    async () => {
      throw err;
    };

  it("spent units stop the pass; another API error skips the search", async () => {
    const stats = emptyYouTubeSearchStats();
    const quota = await youtubeSearchUnit(
      db,
      failing(new YouTubeError(403, "quotaExceeded", "q")),
      {
        q: "a",
        niche: "n",
      },
    );
    expect(quota.outcome).toBe("quota");
    expect(countYouTubeSearchUnit(stats, quota)).toMatch(/units are spent/);
    const bad = await youtubeSearchUnit(db, failing(new YouTubeError(400, "badRequest", "b")), {
      q: "b",
      niche: "n",
    });
    expect(bad.outcome).toBe("error");
    expect(countYouTubeSearchUnit(stats, bad)).toBeNull();
    expect(stats.errors).toBe(1);
  });

  it("anything that isn't the API's error is thrown", async () => {
    await expect(
      youtubeSearchUnit(db, failing(new Error("network")), { q: "a", niche: "n" }),
    ).rejects.toThrow("network");
  });
});
