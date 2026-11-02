/**
 * Find someone to follow by name or topic, on every site at once (Marketing → Feed): no link
 * needed. Each site is its own finder over autobrowse, shaped as one hit, so a finder swaps for the
 * site's own search API when it opens to us (X's `GET /2/users/search`, TikTok's research API)
 * without the page changing. A site that fails says why; the others still answer.
 *
 * - YouTube: Data API channel search, then the channels' subscriber counts.
 * - Reddit: subreddit search, signed out.
 * - LinkedIn: people search as the comments account, company pages through Exa.
 * - X: the exact handle, then authors of recent posts on the words.
 * - Instagram: the exact handle, then the accounts behind Google's results, each read through
 *   business discovery.
 * - TikTok: accounts in Exa's results.
 */
import { capWaitMs, type SiteClient } from "@wren/core/content";
import { reader, signedOut } from "./discovery/reads.js";

export const CREATOR_SITES = ["youtube", "reddit", "linkedin", "x", "instagram", "tiktok"] as const;
export type CreatorSite = (typeof CREATOR_SITES)[number];

/** One account to follow, as every finder answers it. */
export interface CreatorHit {
  site: CreatorSite;
  /** The handle as the site writes it: `@name`, `r/name`, `in/vanity`, `company/name`. */
  handle: string;
  name: string;
  /** Its page, to open. */
  url: string;
  /** What Follow is given: a feed for Learn to read, or the page for the comments' follows. */
  follow: string;
  about: string | null;
  /** Followers, subscribers or members, when the site says. */
  followers: number | null;
  avatar: string | null;
}

interface CreatorSearch {
  hits: CreatorHit[];
  /** Sites that failed, and why. */
  failed: { site: CreatorSite; why: string }[];
}

/** The accounts each finder reads as; a site with none set is skipped with a reason. */
interface FinderAccounts {
  linkedin?: string | null;
  x?: string | null;
}

type Finder = (sites: SiteClient, q: string, accounts: FinderAccounts) => Promise<CreatorHit[]>;

const PER_SITE = 6;
const HANDLE = /^@?([A-Za-z0-9._]{2,30})$/;

/** The handle when the words are one (`@acme`, `acme.staffing`), else null. */
export const handleIn = (q: string): string | null => HANDLE.exec(q.trim())?.[1] ?? null;

/** Exa's hits for words on one site: a `site:` hint (`linkedin.com/company`), then only its URLs. */
async function exaUrls(
  sites: SiteClient,
  at: string,
  q: string,
): Promise<{ url: string; title: string; snippet: string }[]> {
  const [host = at, ...under] = at.split("/");
  const path = under.length ? `/${under.join("/")}/` : "/";
  const r = await sites.call<{ hits?: { url: string; title?: string; snippet?: string }[] }>(
    "web",
    "GET",
    "/search",
    { q: `site:${at} ${q}`, n: 15, via: "exa" },
  );
  return (r.hits ?? [])
    .filter((h) => {
      try {
        const u = new URL(h.url);
        return u.hostname.replace(/^www\./, "").endsWith(host) && u.pathname.startsWith(path);
      } catch {
        return false;
      }
    })
    .map((h) => ({ url: h.url, title: h.title ?? "", snippet: h.snippet ?? "" }));
}

/** The first path part of each URL, once each, that `keep` accepts. */
function accountsIn(
  hits: { url: string; title: string; snippet: string }[],
  keep: (parts: string[]) => string | null,
) {
  // `profile`: the hit is the account's own page, so its title is the account's name; a video's
  // title is the video's.
  const seen = new Map<string, { title: string; snippet: string; profile: boolean }>();
  for (const h of hits) {
    const parts = new URL(h.url).pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const handle = keep(parts);
    if (!handle) continue;
    const profile = parts.length === 1;
    const had = seen.get(handle.toLowerCase());
    if (!had || (profile && !had.profile))
      seen.set(handle.toLowerCase(), { title: h.title, snippet: h.snippet, profile });
  }
  return [...seen.entries()];
}

/** A page title's name part: "Acme (@acme) • Instagram photos" → "Acme". */
const nameOfTitle = (title: string, handle: string) =>
  title.split(/\s[(•|·-]\s?|\s\(@/)[0]?.trim() || handle;

const youtube: Finder = async (sites, q) => {
  const r = await sites.call<{
    items?: {
      id?: { channelId?: string };
      snippet?: {
        title?: string;
        description?: string;
        thumbnails?: { default?: { url?: string } };
      };
    }[];
  }>("youtube", "GET", "/youtube/v3/search", {
    part: "snippet",
    type: "channel",
    q,
    maxResults: PER_SITE,
  });
  const found = (r.items ?? []).filter((i) => i.id?.channelId);
  if (!found.length) return [];
  const stats = await sites.call<{
    items?: {
      id: string;
      snippet?: { customUrl?: string };
      statistics?: { subscriberCount?: string };
    }[];
  }>("youtube", "GET", "/youtube/v3/channels", {
    part: "snippet,statistics",
    id: found.map((i) => i.id?.channelId).join(","),
  });
  const by = new Map((stats.items ?? []).map((c) => [c.id, c]));
  return found.map((i) => {
    const id = i.id?.channelId as string;
    const c = by.get(id);
    const custom = c?.snippet?.customUrl;
    return {
      site: "youtube" as const,
      handle: custom ?? id,
      name: i.snippet?.title ?? id,
      url: custom ? `https://www.youtube.com/${custom}` : `https://www.youtube.com/channel/${id}`,
      follow: `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`,
      about: i.snippet?.description || null,
      followers: c?.statistics?.subscriberCount ? Number(c.statistics.subscriberCount) : null,
      avatar: i.snippet?.thumbnails?.default?.url ?? null,
    };
  });
};

const redditFinder: Finder = async (sites, q) => {
  const subs = await reader(signedOut(sites)).searchPlaces(q);
  return subs.slice(0, PER_SITE).map((s) => ({
    site: "reddit" as const,
    handle: `r/${s.name}`,
    name: `r/${s.name}`,
    url: `https://www.reddit.com/r/${s.name}/`,
    follow: `https://www.reddit.com/r/${s.name}/.rss`,
    about: null,
    followers: s.subscribers,
    avatar: null,
  }));
};

const linkedin: Finder = async (sites, q, accounts) => {
  const people = accounts.linkedin
    ? (
        await sites.call<{
          people: { name: string; vanity: string; url: string; headline?: string }[];
        }>(
          "linkedin",
          "GET",
          "/search/results/people",
          { keywords: q, page: 1, pages: 1 },
          accounts.linkedin,
        )
      ).people
    : [];
  const companies = accountsIn(await exaUrls(sites, "linkedin.com/company", q), (p) =>
    p[0] === "company" && p[1] ? p[1] : null,
  );
  return [
    ...companies.slice(0, 3).map(([handle, h]) => ({
      site: "linkedin" as const,
      handle: `company/${handle}`,
      name: nameOfTitle(h.title, handle),
      url: `https://www.linkedin.com/company/${handle}/`,
      follow: `https://www.linkedin.com/company/${handle}/`,
      about: h.snippet || null,
      followers: null,
      avatar: null,
    })),
    ...people.slice(0, PER_SITE).map((p) => ({
      site: "linkedin" as const,
      handle: `in/${p.vanity}`,
      name: p.name,
      url: `https://www.linkedin.com/in/${p.vanity}/`,
      follow: `https://www.linkedin.com/in/${p.vanity}/`,
      about: p.headline ?? null,
      followers: null,
      avatar: null,
    })),
  ];
};

interface XUser {
  /** The API's numeric id; the page leg has none. */
  id?: string;
  username: string;
  name: string;
  description?: string;
  profile_image_url?: string;
  public_metrics?: { followers_count?: number };
}
const xHit = (u: XUser): CreatorHit => ({
  site: "x",
  handle: `@${u.username}`,
  name: u.name,
  url: `https://x.com/${u.username}`,
  follow: `https://x.com/${u.username}`,
  about: u.description || null,
  followers: u.public_metrics?.followers_count ?? null,
  avatar: u.profile_image_url ?? null,
});
const USER_FIELDS = "description,public_metrics,profile_image_url";
type XReach = { impression_count?: number };

const x: Finder = async (sites, q, accounts) => {
  if (!accounts.x) throw new Error("no X account is set (Shop → X comments)");
  const out: CreatorHit[] = [];
  const handle = handleIn(q);
  if (handle && /^\w{1,15}$/.test(handle)) {
    const one = await sites
      .call<{ data?: XUser }>(
        "x",
        "GET",
        `/2/users/by/username/${handle}`,
        { "user.fields": USER_FIELDS },
        accounts.x,
      )
      .catch(() => ({ data: undefined }));
    if (one.data) out.push(xHit(one.data));
  }
  const r = await sites.call<{
    data?: { author_id?: string; author_username?: string; public_metrics?: XReach }[];
    includes?: { users?: XUser[] };
  }>(
    "x",
    "GET",
    "/2/tweets/search/recent",
    {
      query: `${q} -is:retweet -is:reply lang:en`,
      max_results: 25,
      "tweet.fields": "author_id,public_metrics",
      expansions: "author_id",
      "user.fields": USER_FIELDS,
    },
    accounts.x,
  );
  // Followers when the API gives them; else how many saw their posts here (the page leg).
  const seen = new Map<string, number>();
  for (const t of r.data ?? []) {
    const who = (t.author_id ?? t.author_username ?? "").toLowerCase();
    seen.set(who, (seen.get(who) ?? 0) + (t.public_metrics?.impression_count ?? 0));
  }
  const reach = (u: XUser) =>
    u.public_metrics?.followers_count ??
    seen.get((u.id ?? u.username).toLowerCase()) ??
    seen.get(u.username.toLowerCase()) ??
    0;
  const users = [...(r.includes?.users ?? [])].sort((a, b) => reach(b) - reach(a));
  for (const u of users)
    if (!out.some((h) => h.handle.toLowerCase() === `@${u.username.toLowerCase()}`))
      out.push(xHit(u));
  return out.slice(0, PER_SITE);
};

const IG_NOT = new Set(["p", "reel", "reels", "explore", "stories", "accounts", "tv", "popular"]);
/** Google's result line names a post's account: "Instagram · handle". */
const IG_SITE = /^Instagram\s*·\s*([\w.]{1,30})$/;
interface IgProfile {
  username?: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  profile_picture_url?: string;
}

/**
 * The exact handle first, then the accounts behind Google's results for the words, as a phrase (Exa has few
 * Instagram profiles); each read through business discovery for its followers and picture. One
 * discovery can't read (a personal account) still shows, from Google's words.
 */
const instagram: Finder = async (sites, q) => {
  const found = new Map<string, string | null>();
  const exact = handleIn(q);
  if (exact) found.set(exact.toLowerCase(), null);
  const serp = await sites.call<{
    results?: { site?: string | null; url: string; snippet?: string }[];
  }>("web", "GET", "/google", { q: `site:instagram.com ${/\s/.test(q) ? `"${q}"` : q}`, n: 20 });
  for (const r of serp.results ?? []) {
    const first = (() => {
      try {
        return new URL(r.url).pathname.split("/").filter(Boolean)[0] ?? "";
      } catch {
        return "";
      }
    })();
    const h =
      IG_SITE.exec(r.site ?? "")?.[1] ??
      (first && !IG_NOT.has(first) && /^[\w.]{1,30}$/.test(first) ? first : null);
    if (h && !found.has(h.toLowerCase())) found.set(h.toLowerCase(), r.snippet || null);
  }
  const out: CreatorHit[] = [];
  for (const [h, snippet] of [...found].slice(0, PER_SITE)) {
    const one = await sites
      .call<{ found: true; profile: IgProfile } | { found: false }>(
        "meta",
        "GET",
        `/instagram/${h}`,
        { limit: 1 },
      )
      .catch(() => ({ found: false as const }));
    const p = one.found ? one.profile : null;
    if (!p && h === exact?.toLowerCase() && snippet === null) continue;
    const handle = p?.username ?? h;
    out.push({
      site: "instagram",
      handle: `@${handle}`,
      name: p?.name || handle,
      url: `https://www.instagram.com/${handle}/`,
      follow: `https://www.instagram.com/${handle}/`,
      about: p?.biography || snippet,
      followers: p?.followers_count ?? null,
      avatar: p?.profile_picture_url ?? null,
    });
  }
  return out;
};

const tiktok: Finder = async (sites, q) =>
  accountsIn(await exaUrls(sites, "tiktok.com", q), (p) =>
    p[0]?.startsWith("@") && p[0].length > 2 ? p[0].slice(1) : null,
  )
    .slice(0, PER_SITE)
    .map(([h, hit]) => ({
      site: "tiktok" as const,
      handle: `@${h}`,
      name: hit.profile ? nameOfTitle(hit.title, h) : h,
      url: `https://www.tiktok.com/@${h}`,
      follow: `https://www.tiktok.com/@${h}`,
      about: hit.snippet || null,
      followers: null,
      avatar: null,
    }));

const FINDERS: Readonly<Record<CreatorSite, Finder>> = {
  youtube,
  reddit: redditFinder,
  linkedin,
  x,
  instagram,
  tiktok,
};

/** Every site; each one's hits in site order, a failed site named with its reason. */
export async function findCreators(
  sites: SiteClient,
  q: string,
  o: {
    only?: readonly CreatorSite[];
    accounts?: FinderAccounts;
    finders?: Partial<Record<CreatorSite, Finder>>;
  } = {},
): Promise<CreatorSearch> {
  const words = q.trim();
  if (!words) return { hits: [], failed: [] };
  const picked = o.only?.length ? CREATOR_SITES.filter((s) => o.only?.includes(s)) : CREATOR_SITES;
  const finders = { ...FINDERS, ...o.finders };
  // One site after another: each call is a journaled step, and a replay must meet them in order.
  const out: CreatorSearch = { hits: [], failed: [] };
  for (const site of picked) {
    try {
      out.hits.push(...(await finders[site](sites, words, o.accounts ?? {})));
    } catch (err) {
      const wait = capWaitMs(err);
      out.failed.push({
        site,
        why:
          wait === null
            ? err instanceof Error
              ? err.message
              : String(err)
            : `today's ${site} search cap is used; back in ${Math.ceil(wait / 3_600_000)}h`,
      });
    }
  }
  return out;
}

/** A page or feed address compared loosely: no scheme, `www.`, case or trailing slash. */
export const sameAddress = (u: string) =>
  u
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");

/**
 * Which hits are followed already: by Learn's sources (`follows`, their feed or page addresses)
 * or, on LinkedIn, by the comments' pages (`pages`, `in/<vanity>` for a person).
 */
export function markFollowed(
  hits: readonly CreatorHit[],
  follows: readonly string[],
  pages: readonly string[],
): (CreatorHit & { followed: boolean })[] {
  const have = new Set(follows.map(sameAddress));
  const paged = new Set(pages.map((p) => p.toLowerCase()));
  return hits.map((h) => ({
    ...h,
    followed:
      h.site === "linkedin"
        ? paged.has(h.handle.replace(/^company\//, "").toLowerCase())
        : have.has(sameAddress(h.follow)) || have.has(sameAddress(h.url)),
  }));
}
