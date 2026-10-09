import { describe, expect, it } from "vitest";
import { consented, fieldsOf, missingFields, patchFields, ShapeError } from "./shapes.js";
import {
  creatorFrom,
  TIKTOK_BC_URL,
  TIKTOK_COPY,
  TIKTOK_MUSIC_URL,
  tiktokDeclaration,
  tiktokHold,
  tiktokLabel,
} from "./tiktok.js";

const answer = (over: Record<string, unknown> = {}, code = "ok") => ({
  data: {
    creator_nickname: "Test Bakery",
    creator_username: "testbakery",
    privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY", "SOMETHING_NEW"],
    comment_disabled: true,
    duet_disabled: false,
    stitch_disabled: false,
    max_video_post_duration_sec: 300,
    ...over,
  },
  error: { code },
});

describe("tiktok creator", () => {
  it("reads the answer, keeping only the privacy values TikTok documents", () => {
    expect(creatorFrom(answer())).toEqual({
      nickname: "Test Bakery",
      username: "testbakery",
      avatarUrl: null,
      privacyOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
      commentOff: true,
      duetOff: false,
      stitchOff: false,
      maxVideoSec: 300,
      canPost: true,
      why: null,
    });
  });

  it("a spam-risk code is 'not now'; any other code throws", () => {
    expect(creatorFrom(answer({}, "spam_risk_too_many_posts"))).toMatchObject({
      canPost: false,
      why: "spam_risk_too_many_posts",
    });
    expect(() => creatorFrom(answer({}, "access_token_invalid"))).toThrow(/access_token_invalid/);
  });

  it("holds by the creator: can't post, options, length", () => {
    const c = creatorFrom(answer());
    expect(tiktokHold({ privacy: "PUBLIC_TO_EVERYONE" }, c)).toBeNull();
    expect(tiktokHold({}, c)).toMatch(/Who can see it/);
    expect(tiktokHold({ privacy: "FOLLOWER_OF_CREATOR" }, c)).toMatch(/Followers/);
    expect(tiktokHold({ privacy: "PUBLIC_TO_EVERYONE" }, c, 301)).toMatch(/up to 300/);
    expect(tiktokHold({ privacy: "PUBLIC_TO_EVERYONE" }, { ...c, canPost: false })).toBe(
      TIKTOK_COPY.tryLater,
    );
  });
});

describe("tiktok words", () => {
  it("the declaration names the Branded Content Policy only with branded content", () => {
    expect(tiktokDeclaration({})).toEqual({
      text: "By posting, you agree to TikTok's Music Usage Confirmation.",
      links: [{ label: "Music Usage Confirmation", url: TIKTOK_MUSIC_URL }],
    });
    expect(tiktokDeclaration({ disclose: true, yourBrand: true }).text).toBe(
      "By posting, you agree to TikTok's Music Usage Confirmation.",
    );
    const both = tiktokDeclaration({ disclose: true, yourBrand: true, brandedContent: true });
    expect(both.text).toBe(
      "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation.",
    );
    expect(both.links.map((l) => l.url)).toEqual([TIKTOK_BC_URL, TIKTOK_MUSIC_URL]);
  });

  it("labels: promotional for your brand, paid partnership with branded content", () => {
    expect(tiktokLabel({ disclose: true, yourBrand: true })).toMatch(/Promotional content/);
    expect(tiktokLabel({ disclose: true, brandedContent: true })).toMatch(/Paid partnership/);
    expect(tiktokLabel({ disclose: true, yourBrand: true, brandedContent: true })).toMatch(
      /Paid partnership/,
    );
    expect(tiktokLabel({ yourBrand: true })).toBeNull();
  });
});

describe("tiktok shape", () => {
  it("has no privacy default and starts every choice off", () => {
    expect(fieldsOf("tiktok", {})).toEqual({});
    expect(missingFields("tiktok", {}, null)).toEqual(["Who can see it"]);
    expect(missingFields("tiktok", { privacy: "SELF_ONLY" }, null)).toEqual([]);
  });

  it("a disclosure needs one of its choices before the yes", () => {
    expect(missingFields("tiktok", { privacy: "SELF_ONLY", disclose: true }, null)).toEqual([
      TIKTOK_COPY.pickOne,
    ]);
    expect(
      missingFields("tiktok", { privacy: "SELF_ONLY", disclose: true, yourBrand: true }, null),
    ).toEqual([]);
  });

  it("branded content can't be private, on any save", () => {
    expect(() =>
      patchFields(
        "tiktok",
        { privacy: "PUBLIC_TO_EVERYONE", disclose: true, brandedContent: true },
        { privacy: "SELF_ONLY" },
      ),
    ).toThrow(ShapeError);
    expect(() =>
      fieldsOf("tiktok", { privacy: "SELF_ONLY", disclose: true, brandedContent: true }),
    ).toThrow(TIKTOK_COPY.brandedPrivate);
    // Off disclosure: the box left ticked doesn't count.
    expect(
      fieldsOf("tiktok", { privacy: "SELF_ONLY", disclose: false, brandedContent: true }),
    ).toMatchObject({ privacy: "SELF_ONLY" });
  });

  it("the yes covers TikTok's fields only", () => {
    expect(consented("tiktok")).toBe(true);
    expect(consented("youtube")).toBe(false);
  });
});
