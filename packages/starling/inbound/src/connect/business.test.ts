import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { businessProfileContent, reviewText } from "./business.js";

const LOC = "accounts/1/locations/2";
const NOW = new Date("2026-10-09T12:00:00Z");

function fakeSites(answers: Record<string, (input?: Record<string, unknown>) => unknown>) {
  const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const sites: SiteClient = {
    async call(site, method, path, input) {
      expect(site).toBe("google_business");
      calls.push([method, path, input]);
      const a = answers[`${method} ${path}`];
      if (!a) throw new Error(`no fake for ${method} ${path}`);
      return a(input) as never;
    },
    async via() {
      return "api";
    },
  };
  return { sites, calls };
}

describe("Business Profile content channel", () => {
  it("posts with a button and a photo", async () => {
    const { sites } = fakeSites({
      [`POST /v4/${LOC}/localPosts`]: (i) => {
        expect(i).toEqual({
          languageCode: "en",
          summary: "Open late Friday",
          topicType: "STANDARD",
          callToAction: { actionType: "BOOK", url: "https://acme.example/book" },
          media: [{ mediaFormat: "PHOTO", sourceUrl: "https://cdn.example/p.jpg" }],
        });
        return { name: `${LOC}/localPosts/9`, searchUrl: "https://g.example/9" };
      },
    });
    const ch = businessProfileContent(sites, { location: LOC, now: () => NOW });
    const p = await ch.publish({
      text: "Open late Friday",
      media: { kind: "image", source: "https://cdn.example/p.jpg" },
      extra: { action: "BOOK", actionUrl: "https://acme.example/book" },
    });
    expect(p).toMatchObject({ id: `${LOC}/localPosts/9`, url: "https://g.example/9" });
  });

  it("refuses a button with no link, and a video", async () => {
    const ch = businessProfileContent(fakeSites({}).sites, { location: LOC });
    await expect(ch.publish({ text: "t", extra: { action: "BOOK" } })).rejects.toThrow(/link/);
    await expect(
      ch.publish({ text: "t", media: { kind: "video", source: "https://cdn.example/v.mp4" } }),
    ).rejects.toThrow(/photo/);
  });

  it("reads reviews as comments on the location, newest since, and answers one", async () => {
    const { sites, calls } = fakeSites({
      [`GET /v4/${LOC}/reviews`]: () => ({
        reviews: [
          {
            name: `${LOC}/reviews/r1`,
            reviewer: { displayName: "Sam" },
            starRating: "FIVE",
            comment: "Great service",
            createTime: "2026-10-08T10:00:00Z",
            updateTime: "2026-10-08T10:00:00Z",
          },
          {
            name: `${LOC}/reviews/r0`,
            reviewer: { isAnonymous: true },
            starRating: "TWO",
            createTime: "2026-09-01T10:00:00Z",
          },
        ],
      }),
      [`PUT /v4/${LOC}/reviews/r1/reply`]: (i) => {
        expect(i).toEqual({ comment: "Thanks Sam" });
        return {};
      },
    });
    const ch = businessProfileContent(sites, { location: LOC, now: () => NOW });
    const all = await ch.reviews?.({});
    expect(all?.map((r) => [r.postId, r.author, r.text])).toEqual([
      [LOC, "Sam", "5/5 stars. Great service"],
      [LOC, "A Google user", "2/5 stars, no words."],
    ]);
    expect((await ch.reviews?.({ since: "2026-10-01T00:00:00Z" }))?.length).toBe(1);
    await ch.reply?.(`${LOC}/reviews/r1`, "Thanks Sam");
    await expect(ch.reply?.("accounts/9/locations/9/reviews/x", "no")).rejects.toThrow(/Profile/);
    expect(calls.filter(([m]) => m === "PUT")).toHaveLength(1);
  });

  it("says a rating with no words plainly", () => {
    expect(reviewText({ starRating: "STAR_RATING_UNSPECIFIED" })).toBe("A rating, no words.");
  });
});
