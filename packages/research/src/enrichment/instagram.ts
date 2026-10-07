/**
 * The `instagram` stage (designs/2026-10-05-social-reads.md): the Instagram account a firm's own
 * site links, and its newest posts, kept as findings. The account is a `profile` finding, each post
 * a `post` with its permalink and `published_at`; an account Instagram can't show (unknown, or a
 * personal one) is a `profile` marked missing, so it isn't read again before READ_EVERY_DAYS. Each
 * firm is written before the next is read, so a stop is a pause and a rerun resumes. Every finding
 * keeps Graph's whole answer as `raw`, text uncut: what to use is decided when it is read.
 *
 * One read is one autobrowse call, `meta GET /instagram/{username}` (Graph `business_discovery`
 * on Wren's Facebook Login token): $0, and autobrowse caps it at 300 a day.
 */
import type { SiteClient } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";
import { type CompanyFindingDraft, keepFinding } from "../findings.js";
import { type Bucket, bucketRoom, retryAfter } from "../pacing.js";

export const INSTAGRAM_COMMAND = "enrich instagram";
/**
 * Firms read a day: autobrowse's own cap on the route is 300, and 7,951 firms read every 30 days is
 * about 265 a day. Burst 150: an idle pool sleeps to the next local day, so a day's reads are the
 * burst; 150 keeps one drain under Meta's ~200 calls an hour.
 */
export const INSTAGRAM_BUCKET: Bucket = { perDay: 300, burst: 150 };
/**
 * A pass skips while the bucket holds fewer reads than this. Without it a busy pool would read
 * the one firm that refilled each minute and never go idle.
 */
export const INSTAGRAM_MIN_BATCH = 30;
export const INSTAGRAM_READ_EVERY_DAYS = 30;
const ERROR_STREAK = 5;
/** Instagram usernames: letters, digits, `.` and `_`, up to 30 (the route checks the same). */
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

/** The username a link names, or why it has none. */
export function instagramUser(link: string): { user: string } | { missing: string } {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return { missing: "not a link" };
  }
  if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return { missing: "not an Instagram link" };
  const first = u.pathname.split("/").filter(Boolean)[0] ?? "";
  return USERNAME.test(first) ? { user: first } : { missing: "not a profile link" };
}

/** What `meta GET /instagram/{username}` answers. */
export type InstagramAnswer =
  | { found: true; profile: InstagramProfile; media: InstagramMedia[] }
  | { found: false; reason: string };

/** Graph's profile fields, whole. */
export interface InstagramProfile {
  id: string;
  username?: string;
  name?: string;
  biography?: string;
  website?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  [field: string]: unknown;
}

/** Graph's media fields, whole. */
export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  [field: string]: unknown;
}

const KIND: Record<string, string> = { IMAGE: "photo", VIDEO: "video", CAROUSEL_ALBUM: "carousel" };

/** ISO time of a Graph timestamp (`2026-09-30T21:40:31+0000`), or null. */
const isoOf = (t: string | undefined): string | null => {
  const ms = t ? Date.parse(t.replace(/([+-]\d\d)(\d\d)$/, "$1:$2")) : Number.NaN;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

/** The findings one read makes: the account (or why there is none) and each post. */
export function instagramFindings(
  companyId: number,
  link: string,
  read: { profile: InstagramProfile; media: InstagramMedia[] } | { missing: string },
): CompanyFindingDraft[] {
  const base = { companyId, via: "instagram", confidence: 1, document: null };
  if ("missing" in read)
    return [
      {
        ...base,
        kind: "profile",
        factKey: `c${companyId}:profile:instagram:${link}`.slice(0, 400),
        value: { url: link, missing: read.missing },
        sourceUrl: link,
      },
    ];
  const { profile: p, media } = read;
  return [
    {
      ...base,
      kind: "profile",
      factKey: `c${companyId}:profile:instagram:${p.id}`,
      value: {
        site: "Instagram",
        user_id: p.id,
        username: p.username ?? null,
        name: p.name ?? null,
        biography: p.biography ?? null,
        website: p.website ?? null,
        followers: p.followers_count ?? null,
        follows: p.follows_count ?? null,
        media_count: p.media_count ?? null,
        link,
        raw: p,
      },
      sourceUrl: p.username ? `https://www.instagram.com/${p.username}/` : link,
    },
    ...media
      .filter((m) => m.id)
      .map((m): CompanyFindingDraft => {
        const published = isoOf(m.timestamp);
        return {
          ...base,
          kind: "post",
          factKey: `c${companyId}:post:instagram:${m.id}`,
          value: {
            site: "Instagram",
            kind: KIND[m.media_type ?? ""] ?? (m.media_type ?? "post").toLowerCase(),
            media_id: m.id,
            user_id: p.id,
            caption: m.caption ?? "",
            media_type: m.media_type ?? null,
            media_product_type: m.media_product_type ?? null,
            ...(published ? { published_at: published } : {}),
            likes: m.like_count ?? null,
            comments: m.comments_count ?? null,
            raw: m,
          },
          sourceUrl: m.permalink ?? null,
        };
      }),
  ];
}

/**
 * Read within READ_EVERY_DAYS, account or missing: not due. A finding kept without `raw` or
 * `missing` (none exist yet) would be due again, as for YouTube.
 */
export const instagramDue = (id: SQL) =>
  sql`not exists (select 1 from findings f where f.company_id = ${id} and f.kind = 'profile'
    and f.via = 'instagram' and f.observed_at > now() - make_interval(days => ${INSTAGRAM_READ_EVERY_DAYS})
    and (f.value ? 'raw' or f.value ? 'missing'))`;

export interface InstagramWork {
  companyId: number;
  link: string;
}

/**
 * Due firms in the niche with an Instagram link of their own (the one on most of their pages), a
 * lead we can still mail first.
 */
export async function instagramWork(
  db: Queryable,
  opts: { niche: string | null; limit: number },
): Promise<InstagramWork[]> {
  const rows = await db.execute<{ id: number; link: string }>(sql`
    select id, link from (
      select distinct on (c.id) c.id, cp.value as link,
        exists (select 1 from leads l where l.company_id = c.id
          and l.status in ('imported', 'verified')) as mailable
      from companies c
      join own_contact_points cp on cp.company_id = c.id and cp.kind = 'instagram'
        and cp.person_id is null
      where (${opts.niche}::text is null or c.niche = ${opts.niche})
        and c.decline_reason is null and ${instagramDue(sql`c.id`)}
      order by c.id, cp.pages desc, cp.id
    ) t
    order by mailable desc, id
    limit ${opts.limit}`);
  return rows.map((r) => ({ companyId: Number(r.id), link: r.link }));
}

/**
 * Reads the bucket allows now (every niche's), and when the next one is. A client's room also
 * counts main's reads (`also`): one bucket per source.
 */
export async function instagramRoom(
  db: Queryable,
  now: Date,
  bucket: Bucket = INSTAGRAM_BUCKET,
  also: Queryable | null = null,
): Promise<{ room: number; nextInMs: number }> {
  // One profile finding per read; two days covers any refill.
  const reads = async (on: Queryable) =>
    (
      await on.execute<{ at: string }>(sql`
        select observed_at as at from findings
        where kind = 'profile' and via = 'instagram'
          and observed_at > ${now.toISOString()}::timestamptz - interval '2 days'`)
    ).map((r) => new Date(r.at).getTime());
  const at = [...(await reads(db)), ...(also ? await reads(also) : [])].sort((a, b) => a - b);
  return bucketRoom(at, now.getTime(), bucket);
}

/**
 * Ms until the bucket holds `want` reads, from `instagramRoom`'s answer: how soon a pass that
 * found it too low is worth running again.
 */
export function instagramWaitMs(
  room: number,
  nextInMs: number,
  want = INSTAGRAM_MIN_BATCH,
  bucket: Bucket = INSTAGRAM_BUCKET,
): number {
  const gap = 86_400_000 / bucket.perDay;
  return Math.ceil(room > 0 ? (want - room) * gap : nextInMs + (want - 1) * gap);
}

export type InstagramOutcome = "read" | "missing" | "capped" | "error";

export interface InstagramUnit {
  companyId: number;
  outcome: InstagramOutcome;
  posts: number;
  error: string | null;
}

/**
 * One firm: read the account, keep the findings. A site error comes back as data, never thrown:
 * the read is spent whether it worked or not, so a batch never retries one. A 429 is autobrowse's
 * cap or Meta's rate limit and stops the pass.
 */
export async function instagramUnit(
  db: Queryable,
  sites: SiteClient,
  w: InstagramWork,
): Promise<InstagramUnit> {
  const done = (outcome: InstagramOutcome, posts = 0, error: string | null = null) => ({
    companyId: w.companyId,
    outcome,
    posts,
    error,
  });
  const who = instagramUser(w.link);
  let read: { profile: InstagramProfile; media: InstagramMedia[] } | { missing: string };
  if ("missing" in who) read = who;
  else {
    let answer: InstagramAnswer;
    try {
      answer = await sites.call<InstagramAnswer>("meta", "GET", `/instagram/${who.user}`);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      return done(retryAfter(err) !== null ? "capped" : "error", 0, why);
    }
    read = answer.found
      ? { profile: answer.profile, media: answer.media ?? [] }
      : { missing: answer.reason };
  }
  for (const f of instagramFindings(w.companyId, w.link, read)) await keepFinding(db, f);
  return "missing" in read ? done("missing") : done("read", read.media.length);
}

export interface InstagramStats {
  selected: number;
  read: number;
  missing: number;
  posts: number;
  errors: number;
  /** Why the run stopped early; null = it ran out of firms. */
  stopped: string | null;
}

export const emptyInstagramStats = (): InstagramStats => ({
  selected: 0,
  read: 0,
  missing: 0,
  posts: 0,
  errors: 0,
  stopped: null,
});

/** Adds one unit; returns why the run must stop, or null. */
export function countInstagramUnit(
  stats: InstagramStats,
  u: InstagramUnit,
  streak: { errors: number },
): string | null {
  if (u.outcome === "capped") return `Meta said wait: ${u.error}`;
  if (u.outcome === "error") {
    stats.errors++;
    streak.errors++;
    return streak.errors >= ERROR_STREAK ? `${streak.errors} errors in a row: ${u.error}` : null;
  }
  streak.errors = 0;
  if (u.outcome === "read") stats.read++;
  else stats.missing++;
  stats.posts += u.posts;
  return null;
}
