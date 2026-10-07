import type { MediaHost, SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { instagramContent } from "./content.js";
import { instagramWebContent } from "./content-web.js";

const host: MediaHost = { host: async (p) => `https://cdn.test/${p.split("/").pop()}` };

describe("instagram reel fields", () => {
  it("sends the cover, its frame, collaborators, audio name and feed choice", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const sites: SiteClient = {
      call: async (_s, _m, path, input) => {
        calls.push([path, input]);
        if (path === "/me/accounts")
          return { data: [{ id: "1", instagram_business_account: { id: "ig9" } }] } as never;
        return { id: "c1" } as never;
      },
      via: async () => "api",
    };
    await instagramContent(sites, { host, sleep: async () => {} }).publish({
      text: "cap",
      media: { kind: "video", source: "s3://b/media/r.mp4" },
      extra: {
        cover: "s3://b/media/cover.jpg",
        thumbOffset: 2000,
        collaborators: ["a.b", "c_d"],
        audioName: "Original audio",
        shareToFeed: false,
      },
    });
    const container = calls.find(([p]) => p === "/ig9/media")?.[1];
    expect(container).toEqual({
      video_url: "https://cdn.test/r.mp4",
      media_type: "REELS",
      caption: "cap",
      share_to_feed: false,
      collaborators: ["a.b", "c_d"],
      cover_url: "https://cdn.test/cover.jpg",
      thumb_offset: 2000,
      audio_name: "Original audio",
    });
  });

  it("the web composer refuses a field it can't set instead of dropping it", async () => {
    const calls: unknown[] = [];
    const sites: SiteClient = {
      call: async (...a) => void calls.push(a) as never,
      via: async () => "browser",
    };
    await expect(
      instagramWebContent(sites, { host }).publish({
        text: "cap",
        media: { kind: "video", source: "/r.mp4" },
        extra: { cover: "s3://b/media/c.jpg", collaborators: ["x"] },
      }),
    ).rejects.toThrow("can't set Cover, Collaborators");
    expect(calls).toEqual([]);
  });
});
