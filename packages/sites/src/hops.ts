/**
 * A client's tracked links: `/go/<link>[/<campaign>[/<content>]]?to=/o/<slug>` on its own host,
 * the same shape as the lander's `/go/` (lander/functions/go/[[path]].ts). The Worker counts the
 * click (bots left out), then hops to the page with utm on it; the kit reads the utm on arrival,
 * so the page's events, its forms and the door's payload (touches) carry the post or ad id.
 *
 * Pure, so the Worker and the tests share it: no database, no fetch.
 */
import { type Channel, channelOf, SLUG } from "./model.js";

/** The short names, as the lander's `src/data/links.json` has them. An unknown one still counts. */
export const GO_LINKS: Readonly<Record<string, { source: string; medium: string }>> = {
  yt: { source: "youtube", medium: "organic" },
  li: { source: "linkedin", medium: "organic" },
  ig: { source: "instagram", medium: "organic" },
  tt: { source: "tiktok", medium: "organic" },
  x: { source: "x", medium: "organic" },
  rd: { source: "reddit", medium: "organic" },
  fb: { source: "facebook", medium: "organic" },
  gbp: { source: "google", medium: "organic" },
  ads: { source: "meta", medium: "paid" },
  gads: { source: "google", medium: "paid" },
  sms: { source: "sms", medium: "outreach" },
  email: { source: "email", medium: "outreach" },
};

/**
 * Link unfurlers, crawlers and uptime checks: the lander's list, plus headless browsers. Not a
 * person: not counted, and never put in a split.
 */
export const BOT_UA =
  /bot|crawl|spider|preview|facebookexternalhit|embedly|slack|discord|whatsapp|telegram|linkedinbot|twitterbot|redditbot|headless|lighthouse|pingdom|uptime/i;
export const isBot = (ua: string | null | undefined) => !ua || BOT_UA.test(ua);

const WORD = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
/** Where a hop may land on a client's host: one of its pages or forms, or its booking page. */
const TO = /^\/(?:o\/(?:f\/)?[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?|book)$/;
/** With no `to`, the booking page: a client host's root is its portal, not a page. */
export const GO_DEFAULT = "/book";

export interface Hop {
  link: string;
  channel: Channel;
  source: string;
  medium: string;
  campaign: string | null;
  content: string | null;
  /** The path it lands on, without the utm. */
  to: string;
  /** The page's slug when `to` is `/o/<slug>`. */
  slug: string | null;
  /** `to` with the utm: the redirect's Location. */
  location: string;
}

/** The hop a `/go/...` path names, or null when it isn't one. */
export function hopOf(path: string, search: URLSearchParams): Hop | null {
  if (!path.startsWith("/go/") && path !== "/go") return null;
  const parts = path
    .slice(4)
    .split("/")
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return "";
      }
    });
  if (parts.length > 3 || parts.some((p) => !WORD.test(p))) return null;
  const [link = "go", campaign = "", content = ""] = parts.map((p) => p.toLowerCase());
  const known = GO_LINKS[link] ?? { source: link, medium: "link" };
  const want = search.get("to") ?? "";
  const to = TO.test(want) ? want : GO_DEFAULT;
  const slug = /^\/o\/([^/]+)$/.exec(to)?.[1] ?? null;
  const q = new URLSearchParams({ utm_source: known.source, utm_medium: known.medium });
  if (campaign) q.set("utm_campaign", campaign);
  if (content) q.set("utm_content", content);
  return {
    link,
    channel: channelOf(known),
    source: known.source,
    medium: known.medium,
    campaign: campaign || null,
    content: content || null,
    to,
    slug: slug && SLUG.test(slug) ? slug : null,
    location: `${to}?${q}`,
  };
}

/**
 * The short names Wren's own links may use: the lander's `/go/` knows these
 * (lander/src/data/links.json). Any other name still lands there, credited as `<name>` / `link`.
 */
export const WREN_GO_LINKS = ["yt", "li", "ig", "tt", "x", "rd", "fb", "ads", "sms"] as const;

/** A word for a link's path: lower case, dashes for anything else, at most 80. Empty when none. */
export function linkWord(raw: string | null | undefined): string {
  const s = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, 80);
  return WORD.test(s) ? s : "";
}

/**
 * The utm a link lands with: its short name's source and medium, else the name and `link`. Wren's
 * links go through the lander's `/go/`, which knows only `WREN_GO_LINKS`.
 */
export function linkUtm(link: string, wren = false): { source: string; medium: string } {
  const known = !wren || (WREN_GO_LINKS as readonly string[]).includes(link);
  return (known && GO_LINKS[link]) || { source: link, medium: "link" };
}

/**
 * A tracked link: `https://<host>/go/<link>/<campaign>[/<content>]?to=/o/<slug>`. The campaign is
 * always there (the page's slug when none is given), so a post or ad id has its place.
 */
export function goLinkOf(l: {
  host: string;
  link: string;
  campaign: string;
  content?: string | null;
  slug: string;
}): string {
  const parts = [l.link, l.campaign, l.content ?? ""].filter((p) => p).map(encodeURIComponent);
  return `https://${l.host}/go/${parts.join("/")}?to=/o/${l.slug}`;
}
