import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { tiktokContent } from "./content.js";

describe("tiktok post fields", () => {
  it("sends the toggles, the cover frame and the labels its shape holds", async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const sites: SiteClient = {
      call: async (_s, _m, _p, input) => {
        calls.push(input);
        return { data: { publish_id: "p1" } } as never;
      },
      via: async () => "api",
    };
    await tiktokContent(sites).publish({
      text: "a short",
      media: { kind: "video", source: "https://cdn.test/v.mp4" },
      extra: {
        privacy: "FOLLOWER_OF_CREATOR",
        noComment: true,
        noDuet: true,
        noStitch: false,
        coverMs: 1500,
        aiGenerated: true,
        brandContent: false,
        brandOrganic: true,
      },
    });
    expect(calls[0]?.post_info).toEqual({
      title: "a short",
      privacy_level: "FOLLOWER_OF_CREATOR",
      disable_comment: true,
      disable_duet: true,
      disable_stitch: false,
      video_cover_timestamp_ms: 1500,
      is_aigc: true,
      brand_content_toggle: false,
      brand_organic_toggle: true,
    });
  });

  it("refuses a privacy TikTok doesn't have, before any call", async () => {
    const calls: unknown[] = [];
    const sites: SiteClient = {
      call: async (...a) => void calls.push(a) as never,
      via: async () => "api",
    };
    await expect(
      tiktokContent(sites).publish({
        text: "x",
        media: { kind: "video", source: "https://cdn.test/v.mp4" },
        extra: { privacy: "EVERYONE" },
      }),
    ).rejects.toThrow("Who can see it");
    expect(calls).toEqual([]);
  });
});
