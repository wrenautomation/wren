import { describe, expect, it } from "vitest";
import { type FunnelContext, funnelLine, funnelOf, linkRule, targetLink } from "./funnel.js";

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
  url: "https://youtu.be/abc",
  status: "published" as const,
};

describe("funnel links", () => {
  it("site and booking go through the lander with the stage; video goes straight to YouTube", () => {
    expect(targetLink(base, null)).toBe("https://wrenautomation.com/go/li/reach/3f2a9c1e");
    expect(targetLink({ ...base, pointsTo: "booking", stage: "convert" }, null)).toBe(
      "https://wrenautomation.com/go/li/convert/3f2a9c1e?to=/book/reactivation",
    );
    expect(targetLink({ ...base, pointsTo: "video" }, video)).toBe("https://youtu.be/abc");
    expect(targetLink({ ...base, pointsTo: "video" }, { ...video, url: null })).toBeNull();
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
    expect(funnelOf(promo, { ...ctx, video }).posts).toBe("https://youtu.be/abc");
    const reddit = { ...promo, platform: "reddit" as const, extra: { subreddit: "smallbusiness" } };
    expect(funnelOf(reddit, { ...ctx, video }).note).toMatch(/researched/);
    expect(
      funnelOf(reddit, { ...ctx, video, place: { name: "smallbusiness", links: false } }).note,
    ).toBe("r/smallbusiness doesn't allow links");
    expect(
      funnelOf(reddit, { ...ctx, video, place: { name: "smallbusiness", links: true } }).posts,
    ).toBe("https://youtu.be/abc");
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

  it("no second link when the text has one, and none on a client's post", () => {
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
