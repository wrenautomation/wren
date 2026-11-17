/** Long-form, Shorts, posts (WA-1416 D5): one per (platform, kind), YouTube's channel tabs. Pure: the page imports it. */
export const FEED_FORMATS = ["long", "short", "post"] as const;
export type FeedFormat = (typeof FEED_FORMATS)[number];

/** the format a (platform, kind) pair is; `creators.ts` `formatSql` is the same rule in SQL */
export function formatOf(platform: string, kind: string): FeedFormat {
  if (platform === "youtube" && (kind === "video" || kind === "live")) return "long";
  if (
    (platform === "youtube" && kind === "short") ||
    (platform === "instagram" && kind === "reel") ||
    platform === "tiktok"
  )
    return "short";
  return "post";
}
