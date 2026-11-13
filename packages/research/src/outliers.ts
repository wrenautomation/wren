/** The count a post's outlier score is on (Eden, designs/2026-11-12-eden-method.md §1). */

/** Views for video feeds (YouTube videos and shorts, TikTok, IG and FB reels), likes elsewhere. */
export function outlierCount(platform: string, format: string): "views" | "likes" {
  if (platform === "youtube" && format !== "post") return "views";
  if (platform === "tiktok") return "views";
  if ((platform === "instagram" || platform === "facebook") && format === "reel") return "views";
  return "likes";
}
