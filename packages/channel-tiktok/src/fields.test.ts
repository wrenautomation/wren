import type { SiteClient } from "@wren/core/content";
import { describe, expect, it } from "vitest";
import { tiktokContent } from "./content.js";

const CREATOR = "POST /v2/post/publish/creator_info/query/";
const INIT = "POST /v2/post/publish/video/init/";
const STATUS = "POST /v2/post/publish/status/fetch/";
const video = { kind: "video" as const, source: "https://cdn.test/v.mp4" };

/** A synthetic creator: Everyone, Followers and Only me; duets off; up to 60 seconds. */
const creator = (over: Record<string, unknown> = {}, error = "ok") => ({
  data: {
    creator_nickname: "Test Bakery",
    creator_username: "testbakery",
    creator_avatar_url: "https://cdn.test/a.jpg",
    privacy_level_options: ["PUBLIC_TO_EVERYONE", "FOLLOWER_OF_CREATOR", "SELF_ONLY"],
    comment_disabled: false,
    duet_disabled: true,
    stitch_disabled: false,
    max_video_post_duration_sec: 60,
    ...over,
  },
  error: { code: error, message: "" },
});

function fake(answers: Record<string, (input: Record<string, unknown>) => unknown>) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const sites: SiteClient = {
    call: async (_s, method, path, input = {}) => {
      const k = `${method} ${path}`;
      calls.push([k, input]);
      const a = answers[k];
      if (!a) throw new Error(`no fake for ${k}`);
      return a(input) as never;
    },
    via: async () => "api",
  };
  return { sites, calls };
}

describe("tiktok post fields", () => {
  it("sends the toggles, the cover frame and the labels its shape holds", async () => {
    const { sites, calls } = fake({ [INIT]: () => ({ data: { publish_id: "p1" } }) });
    await tiktokContent(sites).publish({
      text: "a short",
      media: video,
      extra: {
        privacy: "FOLLOWER_OF_CREATOR",
        allowComment: true,
        allowDuet: false,
        coverMs: 1500,
        aiGenerated: true,
        disclose: true,
        yourBrand: true,
      },
    });
    expect(calls[0]?.[1].post_info).toEqual({
      title: "a short",
      privacy_level: "FOLLOWER_OF_CREATOR",
      disable_comment: false,
      disable_duet: true,
      disable_stitch: true,
      video_cover_timestamp_ms: 1500,
      is_aigc: true,
      brand_content_toggle: false,
      brand_organic_toggle: true,
    });
  });

  it("refuses a privacy TikTok doesn't have, before any call", async () => {
    const { sites, calls } = fake({});
    await expect(
      tiktokContent(sites).publish({ text: "x", media: video, extra: { privacy: "EVERYONE" } }),
    ).rejects.toThrow("Who can see it");
    expect(calls).toEqual([]);
  });

  it("refuses with no privacy picked: there is no default", async () => {
    const { sites, calls } = fake({});
    await expect(tiktokContent(sites).publish({ text: "x", media: video })).rejects.toThrow(
      /who can see it/,
    );
    expect(calls).toEqual([]);
  });
});

describe("tiktok direct post", () => {
  it("reads the creator, uploads the file and answers the public post", async () => {
    const { sites, calls } = fake({
      [CREATOR]: () => creator(),
      [INIT]: () => ({ data: { publish_id: "pub9" } }),
      [STATUS]: () => ({
        data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7123] },
      }),
    });
    const out = await tiktokContent(sites, { direct: true }).publish({
      text: "fresh bread",
      media: video,
      extra: { privacy: "PUBLIC_TO_EVERYONE", allowComment: true, allowDuet: true },
    });
    expect(calls.map((c) => c[0])).toEqual([CREATOR, INIT, STATUS]);
    const init = calls[1]?.[1] ?? {};
    expect(init.file).toBe("https://cdn.test/v.mp4");
    expect(init.maxSeconds).toBe(60);
    expect(init.source_info).toBeUndefined();
    // Duets are off on this account, whatever was picked.
    expect(init.post_info).toMatchObject({ disable_comment: false, disable_duet: true });
    expect(calls[2]?.[1]).toMatchObject({ publish_id: "pub9" });
    expect(out).toMatchObject({
      id: "7123",
      url: "https://www.tiktok.com/@testbakery/video/7123",
    });
  });

  it("a private post keeps its publish id and the profile link", async () => {
    const { sites } = fake({
      [CREATOR]: () => creator(),
      [INIT]: () => ({ data: { publish_id: "pub2" } }),
      [STATUS]: () => ({ data: { status: "PUBLISH_COMPLETE" } }),
    });
    const out = await tiktokContent(sites, { direct: true }).publish({
      text: "x",
      media: video,
      extra: { privacy: "SELF_ONLY" },
    });
    expect(out).toMatchObject({ id: "pub2", url: "https://www.tiktok.com/@testbakery" });
  });

  it("a failed post throws TikTok's reason", async () => {
    const { sites } = fake({
      [CREATOR]: () => creator(),
      [INIT]: () => ({ data: { publish_id: "pub3" } }),
      [STATUS]: () => ({ data: { status: "FAILED", fail_reason: "file_format_check_failed" } }),
    });
    await expect(
      tiktokContent(sites, { direct: true }).publish({
        text: "x",
        media: video,
        extra: { privacy: "PUBLIC_TO_EVERYONE" },
      }),
    ).rejects.toThrow(/file_format_check_failed/);
  });

  it("stops before the upload when the account can't post now", async () => {
    const { sites, calls } = fake({
      [CREATOR]: () => creator({}, "spam_risk_too_many_posts"),
    });
    await expect(
      tiktokContent(sites, { direct: true }).publish({
        text: "x",
        media: video,
        extra: { privacy: "PUBLIC_TO_EVERYONE" },
      }),
    ).rejects.toThrow(/Try again later/);
    expect(calls.map((c) => c[0])).toEqual([CREATOR]);
  });

  it("refuses a privacy that isn't one of the account's options", async () => {
    const { sites, calls } = fake({ [CREATOR]: () => creator() });
    await expect(
      tiktokContent(sites, { direct: true }).publish({
        text: "x",
        media: video,
        extra: { privacy: "MUTUAL_FOLLOW_FRIENDS" },
      }),
    ).rejects.toThrow(/can't post as Friends/);
    expect(calls).toHaveLength(1);
  });

  it("refuses a disclosure with neither choice, and branded content kept private", async () => {
    const { sites } = fake({ [CREATOR]: () => creator() });
    const ch = tiktokContent(sites, { direct: true });
    await expect(
      ch.publish({ text: "x", media: video, extra: { privacy: "SELF_ONLY", disclose: true } }),
    ).rejects.toThrow(/indicate if your content promotes yourself/);
    await expect(
      ch.publish({
        text: "x",
        media: video,
        extra: { privacy: "SELF_ONLY", disclose: true, brandedContent: true },
      }),
    ).rejects.toThrow("Branded content visibility cannot be set to private.");
  });
});
