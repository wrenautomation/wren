import type { SiteClient } from "@wren/core/autobrowse";
import { describe, expect, it } from "vitest";
import { instagramPage } from "./creators.js";

const sites = (media: unknown[]) =>
  ({
    call: async () => ({ found: true, profile: { username: "maker" }, media, next: null }),
  }) as unknown as SiteClient;

describe("instagramPage", () => {
  it("keeps Graph's video file on a reel, never on a photo", async () => {
    const { posts } = await instagramPage(
      sites([
        {
          media_type: "VIDEO",
          media_product_type: "REELS",
          permalink: "https://www.instagram.com/reel/r1/",
          thumbnail_url: "https://cdn.example/r1.jpg",
          media_url: "https://cdn.example/r1.mp4",
        },
        {
          media_type: "IMAGE",
          permalink: "https://www.instagram.com/p/p1/",
          media_url: "https://cdn.example/p1.jpg",
        },
      ]),
      "maker",
    );
    expect(posts.map((p) => [p.kind, p.thumbnail, p.media])).toEqual([
      ["reel", "https://cdn.example/r1.jpg", "https://cdn.example/r1.mp4"],
      ["post", "https://cdn.example/p1.jpg", null],
    ]);
  });
});
