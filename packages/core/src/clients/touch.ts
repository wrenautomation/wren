/**
 * Which channel a lander touch came from: an email link, a text, an ad, a search, a post.
 * A touch is the view a visitor arrived on, with its `r`, `utm_*` and `ref` (lander `visitor.ts`).
 */
import type { Channel } from "./schema.js";

const SEARCH = new Set(["google", "bing", "duckduckgo", "yahoo", "ecosia", "brave"]);
const hostWords = (ref: string) => {
  try {
    return new URL(ref).hostname.split(".");
  } catch {
    return [];
  }
};

/** A touch's fields as a channel and campaign; null when nothing names a channel. */
export function touchChannel(
  t: Record<string, unknown>,
): { channel: Channel; campaign: string | null } | null {
  const s = (k: string) => {
    const v = t[k];
    return typeof v === "string" ? v.trim().toLowerCase() : "";
  };
  const campaign = s("utm_campaign") || null;
  const source = s("utm_source");
  const medium = s("utm_medium");
  if (s("r")) return { channel: "email", campaign };
  if (source === "sms") return { channel: "sms", campaign };
  if (medium === "paid" || medium === "cpc") return { channel: "ads", campaign };
  if (SEARCH.has(source) || hostWords(s("ref")).some((w) => SEARCH.has(w)))
    return { channel: "search", campaign };
  if (medium === "outreach") return { channel: "email", campaign };
  if (medium === "organic" || medium === "social") return { channel: "content", campaign };
  return null;
}
