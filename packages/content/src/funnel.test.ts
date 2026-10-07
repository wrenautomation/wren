import { describe, expect, it } from "vitest";
import {
  type FunnelContext,
  funnelLine,
  funnelOf,
  linkRule,
  targetLink,
  youtubeId,
} from "./funnel.js";

const id = "3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f";
const base = {
  id,
  platform: "linkedin" as const,
  text: "A post.",
  extra: {},
  stage: "reach" as const,
  pointsTo: "site" as const,
  videoDraft: null,
  linked: null,
};
const ctx: FunnelContext = { video: null, place: null, client: false };
const video = {
  id: "v",
  title: "How we cut setup time",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  status: "published" as const,
};

describe("funnel links", () => {
  it("site, booking and video all go through the lander with the stage", () => {
    expect(targetLink(base, null)).toBe("https://wrenautomation.com/go/li/reach/3f2a9c1e");
    expect(targetLink({ ...base, pointsTo: "booking", stage: "convert" }, null)).toBe(
      "https://wrenautomation.com/go/li/convert/3f2a9c1e?to=/book/reactivation",
    );
    expect(targetLink({ ...base, pointsTo: "video" }, video)).toBe(
      "https://wrenautomation.com/go/li/reach/3f2a9c1e?v=dQw4w9WgXcQ",
    );
    expect(targetLink({ ...base, pointsTo: "video" }, { ...video, url: null })).toBeNull();
  });

  it("a client's post links its own video straight, and nothing of Wren's", () => {
    expect(targetLink({ ...base, pointsTo: "video" }, video, true)).toBe(video.url);
    expect(targetLink(base, null, true)).toBeNull();
    const promo = { ...base, pointsTo: "video" as const, videoDraft: "v" };
    expect(funnelOf(promo, { ...ctx, video, client: true }).posts).toBe(video.url);
    expect(funnelOf(base, { ...ctx, client: true }).note).toBe(
      "A client's posts link only its own videos",
    );
  });

  it("reads a YouTube id from each URL shape, and nothing else", () => {
    for (const u of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://m.youtube.com/shorts/dQw4w9WgXcQ",
    ])
      expect(youtubeId(u)).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youtubeId("https://youtu.be/short")).toBeNull();
    expect(youtubeId("not a url")).toBeNull();
    // An id that isn't one: the post links the video straight rather than through a bad hop.
    expect(
      targetLink({ ...base, pointsTo: "video" }, { ...video, url: "https://youtu.be/x" }),
    ).toBe("https://youtu.be/x");
  });

  it("captions and Shorts never carry one; LinkedIn does", () => {
    expect(linkRule({ ...base, platform: "instagram" }, null).allowed).toBe(false);
    expect(linkRule({ ...base, platform: "tiktok" }, null).allowed).toBe(false);
    expect(linkRule({ ...base, platform: "youtube", extra: { kind: "short" } }, null).allowed).toBe(
      false,
    );
    expect(linkRule({ ...base, platform: "youtube" }, null).on).toBe(true);
    expect(funnelOf(base, ctx).posts).toBe("https://wrenautomation.com/go/li/reach/3f2a9c1e");
  });

  it("X and Reddit link only a promo, and Reddit only where the sub allows", () => {
    expect(funnelOf({ ...base, platform: "x" }, ctx).posts).toBeNull();
    const promo = { ...base, platform: "x" as const, pointsTo: "video" as const, videoDraft: "v" };
    expect(funnelOf(promo, { ...ctx, video }).posts).toBe(
      "https://wrenautomation.com/go/x/reach/3f2a9c1e?v=dQw4w9WgXcQ",
    );
    const reddit = { ...promo, platform: "reddit" as const, extra: { subreddit: "smallbusiness" } };
    expect(funnelOf(reddit, { ...ctx, video }).note).toMatch(/researched/);
    expect(
      funnelOf(reddit, { ...ctx, video, place: { name: "smallbusiness", links: false } }).note,
    ).toBe("r/smallbusiness doesn't allow links");
    expect(
      funnelOf(reddit, { ...ctx, video, place: { name: "smallbusiness", links: true } }).posts,
    ).toBe("https://wrenautomation.com/go/rd/reach/3f2a9c1e?v=dQw4w9WgXcQ");
    // A text post stays organic even where links are allowed.
    expect(
      funnelOf(
        { ...reddit, pointsTo: "site" },
        { ...ctx, place: { name: "smallbusiness", links: true } },
      ).posts,
    ).toBeNull();
  });

  it("his switch wins where the platform allows; a waiting video says so", () => {
    expect(funnelOf({ ...base, linked: false }, ctx).note).toBe("Off for this post");
    expect(funnelOf({ ...base, platform: "x", linked: true }, ctx).posts).toMatch(/go\/x\/reach/);
    expect(funnelOf({ ...base, platform: "instagram", linked: true }, ctx).posts).toBeNull();
    const waiting = { ...base, pointsTo: "video" as const, videoDraft: "v" };
    expect(funnelOf(waiting, { ...ctx, video: { ...video, url: null } }).note).toBe(
      "Fills in when the video is on YouTube",
    );
    expect(funnelOf({ ...waiting, videoDraft: null }, ctx).note).toBe(
      "Pick the video it points to",
    );
  });

  it("no second link when the text has one, and no Wren link on a client's post", () => {
    const footer = {
      ...base,
      platform: "youtube" as const,
      text: "More: wrenautomation.com/go/yt/x",
    };
    expect(funnelOf(footer, ctx).note).toBe("Already in the text");
    expect(funnelOf(base, { ...ctx, client: true }).posts).toBeNull();
  });

  it("reads as one line", () => {
    expect(funnelLine(funnelOf({ ...base, platform: "x" }, ctx))).toBe(
      "Reach → The site  (no link: A link costs reach on X: only promos carry one)",
    );
  });
});
