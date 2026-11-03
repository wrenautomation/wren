/** Every platform's name as a cued label, for a record field that shows the site. */
import { cued } from "@wren/core/records";

const neutral = (label: string) => ({ label, tone: "neutral" as const });

export const PLATFORM_CUES = cued({
  reddit: neutral("Reddit"),
  linkedin: neutral("LinkedIn"),
  youtube: neutral("YouTube"),
  x: neutral("X"),
  instagram: neutral("Instagram"),
  facebook: neutral("Facebook"),
  tiktok: neutral("TikTok"),
  google_business: neutral("Business Profile"),
});
