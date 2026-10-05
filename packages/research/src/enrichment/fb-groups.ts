/**
 * The `fbGroups` stage (designs/2026-10-05-social-reads.md): Facebook groups as a lead source and
 * enrichment, read signed out through autobrowse's `fb-public` on the Mac. A keyword is one
 * Google search (`GET /groups`); it names groups and the public posts Google shows in them. Each
 * group's About and each post is then one page read. Every answer is kept whole (`social_searches`,
 * `social_groups`, `social_posts`), and a post that names a firm is also a finding on it.
 *
 * Reads are a queue over stored rows, so a stop is a pause: a search leaves its groups with no
 * `read_at` and its posts as stubs, and the next pass reads them, a group's About then its posts.
 * Two buckets pace it over those rows: searches, and page reads (About and posts together).
 * $0: a browser on the Mac.
 */
import { extractDomain, isPlatformDomain, registrableDomain } from "@wren/core";
import type { SiteClient } from "@wren/core/content";
import { atomic, type Queryable } from "@wren/db";
import { pgSafe } from "@wren/db/columns";
import { eq, sql } from "drizzle-orm";
import { keepFinding } from "../findings.js";
import { type Bucket, bucketRoom, refusedBy, retryAfter } from "../pacing.js";
import { type PostMapping, socialGroups, socialPosts, socialSearches } from "../social-schema.js";

export const FB_GROUPS_COMMAND = "enrich fb-groups";
export const FB_GROUPS_NETWORK = "facebook";
export const FB_GROUPS_VIA = "facebook-group";
/**
 * Searches a day; each is a Google page or two on the Mac's IP. The pool sleeps to the next local day once a pass finds nothing, so on an idle pool a
 * bucket only gets its burst a day: the burst is the daily amount, and autobrowse's pace spaces the calls.
 */
export const GROUP_SEARCH_BUCKET: Bucket = { perDay: 12, burst: 12 };
/** Page reads a day, About and posts together; with Ad Library's 48 they stay under autobrowse's 200. */
export const GROUP_READ_BUCKET: Bucket = { perDay: 80, burst: 80 };
export const GROUP_SEARCH_N = 20;
export const GROUP_KEYWORD_EVERY_DAYS = 7;
export const GROUP_ABOUT_EVERY_DAYS = 30;
/** Unmapped posts newer than this are tried again each pass, so new firms pick up old posts. */
export const POST_MAP_DAYS = 90;
const DAY = 86_400_000;

/** What `GET /groups` says of one post in a group. */
export interface PostHit {
  post: string;
  url: string;
  title?: string | null;
  snippet?: string | null;
  shown?: string | null;
  [field: string]: unknown;
}

/** What `GET /groups` says of one group, with the public posts Google showed. */
export interface GroupHit {
  group: string;
  name: string | null;
  url: string;
  posts: PostHit[];
  [field: string]: unknown;
}

/** The post page as read. `links` is every out-link, space separated; every other field is kept as read. */
export interface GroupPost {
  author?: string | null;
  time?: string | null;
  text?: string | null;
  links?: string | null;
  [field: string]: unknown;
}

/** The refs the `fb-public` routes take. */
const GROUP_REF = /^[\w.-]{2,100}$/;
const POST_REF = /^\d{5,25}$/;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Searches left in the bucket now, and how long until the next when none. */
export async function groupSearchRoom(
  db: Queryable,
  now: Date,
  bucket: Bucket = GROUP_SEARCH_BUCKET,
): Promise<{ room: number; nextInMs: number }> {
  const rows = await db.execute<{ at: string }>(sql`
    select searched_at as at from social_searches
    where network = ${FB_GROUPS_NETWORK}
      and searched_at > ${now.toISOString()}::timestamptz - interval '2 days'
    order by searched_at`);
  return bucketRoom(
    rows.map((r) => new Date(r.at).getTime()),
    now.getTime(),
    bucket,
  );
}

/** Page reads left in the bucket now (a group's About or a post), and how long until the next when none. */
export async function groupReadRoom(
  db: Queryable,
  now: Date,
  bucket: Bucket = GROUP_READ_BUCKET,
): Promise<{ room: number; nextInMs: number }> {
  const since = sql`${now.toISOString()}::timestamptz - interval '2 days'`;
  const rows = await db.execute<{ at: string }>(sql`
    select at from (
      select read_at as at from social_groups where network = ${FB_GROUPS_NETWORK} and read_at > ${since}
      union all
      select read_at as at from social_posts where network = ${FB_GROUPS_NETWORK} and read_at > ${since}
    ) r order by at`);
  return bucketRoom(
    rows.map((r) => new Date(r.at).getTime()),
    now.getTime(),
    bucket,
  );
}

/** The niche's keywords due a search: never searched first, then the longest ago. */
export async function groupKeywordsDue(
  db: Queryable,
  niche: string,
  keywords: readonly string[],
  opts: { now: Date; limit: number },
): Promise<string[]> {
  if (keywords.length === 0 || opts.limit <= 0) return [];
  const rows = await db.execute<{ keyword: string; at: string }>(sql`
    select keyword, max(searched_at) as at from social_searches
    where network = ${FB_GROUPS_NETWORK} and niche = ${niche}
      and keyword in (${sql.join(
        keywords.map((k) => sql`${k}`),
        sql`, `,
      )})
    group by keyword`);
  const last = new Map(rows.map((r) => [r.keyword, new Date(r.at).getTime()]));
  const due = opts.now.getTime() - GROUP_KEYWORD_EVERY_DAYS * DAY;
  return keywords
    .map((q) => ({ q, at: last.get(q) ?? 0 }))
    .filter((k) => k.at <= due)
    .sort((a, b) => a.at - b.at)
    .slice(0, opts.limit)
    .map((k) => k.q);
}

/** One page read the queue holds. */
export type GroupRead =
  | { kind: "about"; groupId: number; group: string }
  | { kind: "post"; groupId: number; group: string; postId: number; post: string };

/**
 * Page reads due, a group's About then its posts, a group at a time. Groups never read go before
 * a re-read of an About older than GROUP_ABOUT_EVERY_DAYS.
 */
export async function groupReadsDue(
  db: Queryable,
  niche: string,
  opts: { now: Date; limit: number },
): Promise<GroupRead[]> {
  if (opts.limit <= 0) return [];
  const at = sql`${opts.now.toISOString()}::timestamptz`;
  const rows = await db.execute<{
    kind: "about" | "post";
    group_id: number;
    group_ref: string;
    post_id: number | null;
    post_ref: string | null;
  }>(sql`
    select kind, group_id, group_ref, post_id, post_ref from (
      select 'about' as kind, g.id as group_id, g.ref as group_ref, null::int as post_id,
             null::text as post_ref, (g.read_at is not null) as stale, 0 as step, g.id as ord
      from social_groups g
      where g.network = ${FB_GROUPS_NETWORK} and g.niche = ${niche}
        and (g.read_at is null or g.read_at < ${at} - make_interval(days => ${GROUP_ABOUT_EVERY_DAYS}))
      union all
      select 'post', g.id, g.ref, p.id, p.ref, false, 1, p.id
      from social_posts p join social_groups g on g.id = p.group_id
      where p.network = ${FB_GROUPS_NETWORK} and g.niche = ${niche} and p.read_at is null
    ) q order by stale, group_id, step, ord limit ${opts.limit}`);
  return rows.map((r) =>
    r.kind === "about"
      ? { kind: "about", groupId: r.group_id, group: r.group_ref }
      : {
          kind: "post",
          groupId: r.group_id,
          group: r.group_ref,
          postId: r.post_id as number,
          post: r.post_ref as string,
        },
  );
}

export type FbGroupsOutcome = "read" | "capped" | "error";

export interface FbGroupsUnit {
  kind: "search" | "about" | "post";
  outcome: FbGroupsOutcome;
  /** Groups a search named. */
  groups: number;
  groupsNew: number;
  postsNew: number;
  error: string | null;
}

const done = (kind: FbGroupsUnit["kind"], over: Partial<FbGroupsUnit> = {}): FbGroupsUnit => ({
  kind,
  outcome: "read",
  groups: 0,
  groupsNew: 0,
  postsNew: 0,
  error: null,
  ...over,
});

/** A site error as data: a 429 is autobrowse's cap or pace (stop the pass), a 4xx says no to this read. */
function failure(kind: FbGroupsUnit["kind"], err: unknown): FbGroupsUnit {
  const why = err instanceof Error ? err.message : String(err);
  if (retryAfter(err) !== null) return done(kind, { outcome: "capped", error: why });
  if (refusedBy(err) === null) throw err;
  return done(kind, { outcome: "error", error: why });
}

/**
 * Search one keyword and keep the answer whole. Each group is upserted (its latest hit kept) and
 * each public post Google showed becomes a stub to read. A refused search is kept as data too, so
 * it is not asked again before the keyword is due.
 */
export async function groupSearchUnit(
  db: Queryable,
  sites: SiteClient,
  w: { q: string; niche: string; n?: number },
): Promise<FbGroupsUnit> {
  const n = w.n ?? GROUP_SEARCH_N;
  const keep = (at: Queryable, answer: unknown, groups: number) =>
    at
      .insert(socialSearches)
      .values(
        pgSafe({ network: FB_GROUPS_NETWORK, niche: w.niche, keyword: w.q, n, groups, answer }),
      );
  let answer: { groups?: GroupHit[] };
  try {
    answer = await sites.call<{ groups?: GroupHit[] }>("fb-public", "GET", "/groups", {
      q: w.q,
      n,
    });
  } catch (err) {
    const u = failure("search", err);
    if (u.outcome === "error") await keep(db, { error: u.error }, 0);
    return u;
  }
  const hits = answer.groups ?? [];
  // A ref the routes would refuse stays in the answer above; there is nothing to read it with.
  const readable = hits.filter((g) => GROUP_REF.test(g.group));
  let groupsNew = 0;
  let postsNew = 0;
  await atomic(db, async (tx) => {
    await keep(tx, answer, hits.length);
    for (const g of readable) {
      const [row] = await tx
        .insert(socialGroups)
        .values(
          pgSafe({
            network: FB_GROUPS_NETWORK,
            ref: g.group,
            niche: w.niche,
            keyword: w.q,
            name: str(g.name),
            url: g.url,
            hit: g,
          }),
        )
        .onConflictDoUpdate({
          target: [socialGroups.network, socialGroups.ref],
          set: {
            hit: sql`excluded.hit`,
            name: sql`coalesce(${socialGroups.name}, excluded.name)`,
          },
        })
        .returning({ id: socialGroups.id, created: sql<boolean>`(xmax = 0)` });
      if (!row) throw new Error(`group ${g.group} neither inserted nor updated`);
      if (row.created) groupsNew++;
      for (const p of (g.posts ?? []).filter((p) => POST_REF.test(p.post))) {
        const made = await tx
          .insert(socialPosts)
          .values(
            pgSafe({
              network: FB_GROUPS_NETWORK,
              groupId: row.id,
              ref: p.post,
              url: p.url,
              raw: { hit: p },
            }),
          )
          .onConflictDoNothing({ target: [socialPosts.network, socialPosts.ref] })
          .returning({ id: socialPosts.id });
        postsNew += made.length;
      }
    }
  });
  return done("search", { groups: hits.length, groupsNew, postsNew });
}

/** Read a group's About and keep it whole; a page that shows nothing is a read with no About. */
export async function groupAboutUnit(
  db: Queryable,
  sites: SiteClient,
  r: { groupId: number; group: string },
): Promise<FbGroupsUnit> {
  let about: Record<string, unknown> | null;
  try {
    ({ about } = await sites.call<{ about: Record<string, unknown> | null }>(
      "fb-public",
      "GET",
      `/groups/${r.group}`,
      { group: r.group },
    ));
  } catch (err) {
    const u = failure("about", err);
    if (u.outcome === "error")
      await db
        .update(socialGroups)
        .set({ error: u.error, readAt: sql`now()` })
        .where(eq(socialGroups.id, r.groupId));
    return u;
  }
  const kept = pgSafe(about ?? null);
  await db
    .update(socialGroups)
    .set({
      about: kept,
      name: sql`coalesce(${str(kept?.name)}::text, ${socialGroups.name})`,
      error: null,
      readAt: sql`now()`,
    })
    .where(eq(socialGroups.id, r.groupId));
  return done("about");
}

/** Read one post and its top comments, kept whole under `raw`. */
export async function groupPostUnit(
  db: Queryable,
  sites: SiteClient,
  r: { postId: number; group: string; post: string },
): Promise<FbGroupsUnit> {
  let read: { post: GroupPost | null; comments?: unknown[] };
  try {
    read = await sites.call("fb-public", "GET", `/groups/${r.group}/posts/${r.post}`, {
      group: r.group,
      post: r.post,
    });
  } catch (err) {
    const u = failure("post", err);
    if (u.outcome === "error")
      await db
        .update(socialPosts)
        .set({ error: u.error, readAt: sql`now()` })
        .where(eq(socialPosts.id, r.postId));
    return u;
  }
  const post = pgSafe(read.post ?? null);
  const whole = pgSafe({ post, comments: read.comments ?? [] });
  await db
    .update(socialPosts)
    .set({
      author: str(post?.author),
      posted: str(post?.time),
      text: str(post?.text),
      raw: sql`${socialPosts.raw} || ${JSON.stringify(whole)}::jsonb`,
      error: null,
      readAt: sql`now()`,
    })
    .where(eq(socialPosts.id, r.postId));
  return done("post");
}

/** Lowercase words, letters and digits only: "O'Brien & Co." is o brien co. */
export const wordsOf = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * The registrable domains a post links to, in order, with Facebook's link shim
 * (`l.facebook.com/l.php?u=...`) unwrapped and platforms left out.
 */
export function linkDomains(links: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of (links ?? "").split(/\s+/)) {
    let target = raw;
    try {
      const u = new URL(raw);
      if (/^l[m]?\.facebook\.com$/.test(u.hostname)) target = u.searchParams.get("u") ?? raw;
    } catch {
      // Not a URL: extractDomain decides.
    }
    const host = target ? extractDomain(target) : null;
    if (!host || isPlatformDomain(host)) continue;
    const domain = registrableDomain(host);
    if (!out.includes(domain)) out.push(domain);
  }
  return out;
}

/** Firms by name: two or more words, and unique, or a name could be any of them. */
export function nameIndex(firms: readonly { id: number; name: string | null }[]) {
  const seen = new Map<string, number | null>();
  for (const f of firms) {
    const words = f.name ? wordsOf(f.name) : [];
    if (words.length < 2) continue;
    const key = words.join(" ");
    seen.set(key, seen.has(key) ? null : f.id);
  }
  const byName = new Map<string, number>();
  let longest = 0;
  for (const [key, id] of seen) {
    if (id === null) continue;
    byName.set(key, id);
    longest = Math.max(longest, key.split(" ").length);
  }
  return { byName, longest };
}

/** The one firm whose name is in the text as whole words; null for none, or for two firms. */
export function firmNamedIn(text: string, index: ReturnType<typeof nameIndex>): number | null {
  const words = wordsOf(text);
  const found = new Set<number>();
  for (let i = 0; i < words.length; i++)
    for (let n = 2; n <= index.longest && i + n <= words.length; n++) {
      const id = index.byName.get(words.slice(i, i + n).join(" "));
      if (id !== undefined) found.add(id);
    }
  return found.size === 1 ? ([...found][0] as number) : null;
}

const CONFIDENCE: Record<PostMapping, number> = { link: 0.9, author: 0.8, name: 0.5 };

export interface MapStats {
  seen: number;
  mapped: number;
}

/**
 * Map the niche's read posts that no firm has yet (newer than POST_MAP_DAYS) to a firm, by a link
 * to its domain, the author's name, or its name in the text, in that order, and keep each as a
 * `post` finding on the firm. A post that matches none stays as it is; it is tried again next pass.
 */
export async function mapPosts(db: Queryable, niche: string, now: Date): Promise<MapStats> {
  const posts = await db.execute<{
    id: number;
    ref: string;
    url: string;
    author: string | null;
    posted: string | null;
    text: string | null;
    raw: { post?: GroupPost | null; comments?: unknown[] } | null;
    group_name: string | null;
    group_url: string;
  }>(sql`
    select p.id, p.ref, p.url, p.author, p.posted, p.text, p.raw, g.name as group_name, g.url as group_url
    from social_posts p join social_groups g on g.id = p.group_id
    where g.niche = ${niche} and p.network = ${FB_GROUPS_NETWORK}
      and p.mapped_by is null and p.read_at is not null and p.error is null
      and p.read_at > ${now.toISOString()}::timestamptz - make_interval(days => ${POST_MAP_DAYS})`);
  const stats = { seen: posts.length, mapped: 0 };
  if (posts.length === 0) return stats;

  const links = new Map(posts.map((p) => [p.id, linkDomains(p.raw?.post?.links)]));
  const domains = [...new Set([...links.values()].flat())];
  const byDomain = new Map<string, number>();
  if (domains.length > 0) {
    const rows = await db.execute<{ id: number; domain: string }>(sql`
      select id, domain from companies where domain in (${sql.join(
        domains.map((d) => sql`${d}`),
        sql`, `,
      )})`);
    for (const r of rows) byDomain.set(r.domain, r.id);
  }

  const normal = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const authors = [...new Set(posts.flatMap((p) => (p.author ? [normal(p.author)] : [])))];
  const byAuthor = new Map<string, { person: number; company: number }[]>();
  if (authors.length > 0) {
    const rows = await db.execute<{ name: string; person: number; company: number }>(sql`
      select name, id as person, company_id as company from (
        select lower(regexp_replace(btrim(p.first_name) || ' ' || btrim(p.last_name), '[[:space:]]+', ' ', 'g')) as name,
               p.id, p.company_id
        from people p join companies c on c.id = p.company_id
        where c.niche = ${niche} and p.first_name is not null and p.last_name is not null
      ) t where name in (${sql.join(
        authors.map((a) => sql`${a}`),
        sql`, `,
      )})`);
    for (const r of rows) byAuthor.set(r.name, [...(byAuthor.get(r.name) ?? []), r]);
  }

  type Hit = { company: number; person: number | null; by: PostMapping };
  const hits = new Map<number, Hit>();
  for (const p of posts) {
    const domain = (links.get(p.id) ?? []).find((d) => byDomain.has(d));
    if (domain !== undefined) {
      hits.set(p.id, { company: byDomain.get(domain) as number, person: null, by: "link" });
      continue;
    }
    const people = p.author ? (byAuthor.get(normal(p.author)) ?? []) : [];
    if (people.length === 1) {
      const [one] = people as [{ person: number; company: number }];
      hits.set(p.id, { company: one.company, person: one.person, by: "author" });
    }
  }
  // ponytail: every firm's name is loaded each pass that has an unmapped post; index in the db if a niche outgrows it.
  const rest = posts.filter((p) => !hits.has(p.id) && p.text);
  if (rest.length > 0) {
    const firms = await db.execute<{ id: number; name: string | null }>(
      sql`select id, name from companies where niche = ${niche} and name is not null`,
    );
    const index = nameIndex(firms);
    for (const p of rest) {
      const company = firmNamedIn(p.text as string, index);
      if (company !== null) hits.set(p.id, { company, person: null, by: "name" });
    }
  }
  if (hits.size === 0) return stats;

  await atomic(db, async (tx) => {
    for (const p of posts) {
      const hit = hits.get(p.id);
      if (!hit) continue;
      await tx
        .update(socialPosts)
        .set({ companyId: hit.company, personId: hit.person, mappedBy: hit.by })
        .where(eq(socialPosts.id, p.id));
      const read = p.raw?.post ?? {};
      await keepFinding(tx, {
        companyId: hit.company,
        kind: "post",
        factKey: `fbgroup:post:${p.ref}`,
        value: {
          group: { name: p.group_name, url: p.group_url },
          author: p.author,
          text: p.text,
          posted: p.posted,
          counts: {
            reactions: read.reactions ?? null,
            comments: read.comments ?? null,
            shares: read.shares ?? null,
          },
          links: read.links ?? null,
          comments: p.raw?.comments ?? [],
          personId: hit.person,
          mappedBy: hit.by,
        },
        confidence: CONFIDENCE[hit.by],
        via: FB_GROUPS_VIA,
        sourceUrl: p.url,
        document: null,
      });
      stats.mapped++;
    }
  });
  return stats;
}

export interface FbGroupsStats {
  /** Searches and page reads this pass planned. */
  selected: number;
  searches: number;
  groups_found: number;
  groups_new: number;
  posts_new: number;
  abouts: number;
  posts: number;
  /** Posts newly mapped to a firm. */
  mapped: number;
  errors: number;
  /** Why the run stopped early; null = it ran out of work. */
  stopped: string | null;
}

export const emptyFbGroupsStats = (): FbGroupsStats => ({
  selected: 0,
  searches: 0,
  groups_found: 0,
  groups_new: 0,
  posts_new: 0,
  abouts: 0,
  posts: 0,
  mapped: 0,
  errors: 0,
  stopped: null,
});

/** Count a unit; the reason to stop, or null. */
export function countFbGroupsUnit(s: FbGroupsStats, u: FbGroupsUnit): string | null {
  if (u.outcome === "capped") return `fb-public said wait: ${u.error}`;
  if (u.outcome === "error") {
    s.errors++;
    return null;
  }
  if (u.kind === "search") {
    s.searches++;
    s.groups_found += u.groups;
    s.groups_new += u.groupsNew;
    s.posts_new += u.postsNew;
  } else if (u.kind === "about") s.abouts++;
  else s.posts++;
  return null;
}
