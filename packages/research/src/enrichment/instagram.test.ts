import { describe, expect, it } from "vitest";
import {
  countInstagramUnit,
  emptyInstagramStats,
  INSTAGRAM_BUCKET,
  instagramFindings,
  instagramUser,
  instagramWaitMs,
} from "./instagram.js";

const PROFILE = { id: "1789", username: "example.firm", name: "Example Firm", followers_count: 12 };
const MEDIA = [
  {
    id: "m1",
    caption: "We are hiring #jobs",
    media_type: "VIDEO",
    permalink: "https://www.instagram.com/p/AAA/",
    timestamp: "2026-09-30T21:40:31+0000",
    like_count: 3,
  },
  { id: "m2", media_type: "IMAGE", timestamp: "garbage" },
];

describe("instagramUser", () => {
  it("takes the first path part of an instagram.com link", () => {
    expect(instagramUser("https://www.instagram.com/example.firm/")).toEqual({
      user: "example.firm",
    });
    expect(instagramUser("https://instagram.com/example_firm?hl=en")).toEqual({
      user: "example_firm",
    });
  });
  it("refuses what is not a profile link", () => {
    expect(instagramUser("https://www.instagram.com/p/AAA/")).toEqual({ user: "p" });
    expect(instagramUser("https://www.instagram.com/")).toHaveProperty("missing");
    expect(instagramUser("https://example.com/example")).toHaveProperty("missing");
    expect(instagramUser("nope")).toHaveProperty("missing");
  });
});

describe("instagramFindings", () => {
  it("is the profile and one post per media item, raw whole, permalink as source", () => {
    const [profile, ...posts] = instagramFindings(7, "https://instagram.com/example.firm", {
      profile: PROFILE,
      media: MEDIA,
    });
    expect(profile).toMatchObject({ kind: "profile", via: "instagram", companyId: 7 });
    expect(profile?.value).toMatchObject({ followers: 12, raw: PROFILE });
    expect(posts.map((p) => p.sourceUrl)).toEqual(["https://www.instagram.com/p/AAA/", null]);
    expect(posts[0]?.value).toMatchObject({
      site: "Instagram",
      kind: "video",
      caption: "We are hiring #jobs",
      published_at: "2026-09-30T21:40:31.000Z",
      raw: MEDIA[0],
    });
    // An unreadable time is left out, never guessed.
    expect(posts[1]?.value).not.toHaveProperty("published_at");
  });
  it("a missing account is one profile finding marked missing", () => {
    const f = instagramFindings(7, "https://instagram.com/x", { missing: "no such account" });
    expect(f).toHaveLength(1);
    expect(f[0]?.value).toMatchObject({ missing: "no such account" });
  });
});

describe("countInstagramUnit", () => {
  const unit = (outcome: "read" | "missing" | "capped" | "error", posts = 0) => ({
    companyId: 1,
    outcome,
    posts,
    error: outcome === "capped" || outcome === "error" ? "boom" : null,
  });
  it("counts reads and posts; a cap stops at once; five errors in a row stop", () => {
    const s = emptyInstagramStats();
    const streak = { errors: 0 };
    expect(countInstagramUnit(s, unit("read", 25), streak)).toBeNull();
    expect(countInstagramUnit(s, unit("missing"), streak)).toBeNull();
    expect([s.read, s.missing, s.posts]).toEqual([1, 1, 25]);
    expect(countInstagramUnit(s, unit("capped"), streak)).toMatch(/wait/);
    for (let i = 0; i < 4; i++) expect(countInstagramUnit(s, unit("error"), streak)).toBeNull();
    expect(countInstagramUnit(s, unit("error"), streak)).toMatch(/5 errors/);
    expect(s.errors).toBe(5);
  });
  it("a read between errors resets the streak", () => {
    const s = emptyInstagramStats();
    const streak = { errors: 0 };
    for (let i = 0; i < 4; i++) countInstagramUnit(s, unit("error"), streak);
    countInstagramUnit(s, unit("read"), streak);
    expect(countInstagramUnit(s, unit("error"), streak)).toBeNull();
  });
});

describe("instagramWaitMs", () => {
  it("is the time for the bucket to refill to the batch", () => {
    const gap = 86_400_000 / INSTAGRAM_BUCKET.perDay;
    expect(instagramWaitMs(10, 0)).toBe(Math.ceil(20 * gap));
    expect(instagramWaitMs(0, 1000)).toBe(Math.ceil(1000 + 29 * gap));
  });
});
