/**
 * Places: subreddits where our buyers ask questions (designs/2026-10-06-reddit-discovery.md,
 * Places). Found by topic search, by name, and where the people we read post; each read once a
 * month and judged by a model (fit, rules in plain words). Pace is counted in code. Nothing is
 * watched until William picks it; Watch gives it the pool account with the fewest places whose
 * rung its minimums allow.
 */
import { warmupOf } from "@wren/channel-reddit";
import type { AccountHealth } from "@wren/core/outreach";
import type { Queryable } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ReachRefusal } from "../refusal.js";
import {
  type PlaceJudged,
  type RedditPlace,
  reachAccounts,
  redditPeople,
  redditPlaces,
} from "../schema.js";
import type { PlaceRead, Post } from "./reads.js";

const WREN_ABOUT =
  "Medium-sized businesses that charge a lot per client: agencies, consultancies, recruiters, B2B services, clinics and firms like them. Owners and operators who sell, deliver and hire.";

/** Who we talk to: the `reddit.discovery` block, a setting per client. Defaults are Wren's. */
export const discoverySettingsSchema = z
  .object({
    about: z.string().trim().min(1).default(WREN_ABOUT),
    /** Search words; empty = the model proposes them from `about`. */
    topics: z.array(z.string().trim().min(1)).default([]),
    /** Subreddits William names, without r/. */
    subreddits: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();
export type Audience = z.infer<typeof discoverySettingsSchema>;

export const WREN_AUDIENCE: Audience = discoverySettingsSchema.parse({});

export const PLACE_FRESH_MS = 30 * 86_400_000;

const name = (s: string) => s.replace(/^\/?r\//i, "").trim();
const key = (s: string) => name(s).toLowerCase();

const TOPICS = z.object({ topics: z.array(z.string()).min(1).max(12) });

/** The audience's search words: its own, or the model's from `about`. */
export async function topicsOf(llm: LlmClient | null, a: Audience): Promise<string[]> {
  if (a.topics.length || !llm) return a.topics;
  const out = await completeAndParse(
    llm,
    `Audience: ${a.about}\nGive 8 short Reddit search phrases (1-3 words) for subreddits where these people ask each other questions about running their business. JSON {"topics": [..]}.`,
    TOPICS,
    { maxTokens: 200, name: "reddit.topics" },
  );
  return out.parsed?.topics.map((t) => t.trim()).filter(Boolean) ?? [];
}

/** New candidates; a known place keeps its row. Answers how many were new. */
export async function addPlaces(
  db: Queryable,
  found: { name: string; foundBy: string; subscribers?: number | null }[],
): Promise<number> {
  const rows = [...new Map(found.map((f) => [key(f.name), f])).values()].map((f) => ({
    subreddit: key(f.name),
    name: name(f.name),
    foundBy: f.foundBy,
    subscribers: f.subscribers ?? null,
  }));
  if (!rows.length) return 0;
  const made = await db
    .insert(redditPlaces)
    .values(rows)
    .onConflictDoNothing()
    .returning({ s: redditPlaces.subreddit });
  return made.length;
}

/** Where the people we read post at least 3 times: a place our buyers already are. */
export async function placesOfPeople(db: Queryable): Promise<string[]> {
  const rows = (await db.execute(sql`
    select distinct p->>'place' place from ${redditPeople}, jsonb_array_elements(facts->'places') p
    where (p->>'n')::int >= 3 and fit >= 6 and p->>'place' like 'r/%'`)) as unknown as Array<{
    place: string;
  }>;
  return rows.map((r) => name(r.place)).filter((s) => !/^u_/.test(s));
}

/** Places to read: never read, or read over a month ago. Skipped ones aren't read again. */
export async function placesToRead(db: Queryable, now: Date, limit: number) {
  return db
    .select({ subreddit: redditPlaces.subreddit, state: redditPlaces.state })
    .from(redditPlaces)
    .where(
      and(
        ne(redditPlaces.state, "skipped"),
        or(
          isNull(redditPlaces.readAt),
          lt(redditPlaces.readAt, new Date(now.getTime() - PLACE_FRESH_MS)),
        ),
      ),
    )
    .orderBy(sql`${redditPlaces.readAt} nulls first`, asc(redditPlaces.createdAt))
    .limit(limit);
}

/** Posts a day and median comments, from the newest posts read. */
export function paceOf(latest: readonly Post[]): { postsADay: number; medianComments: number } {
  const at = latest.flatMap((p) => (p.created_utc ? [p.created_utc] : [])).sort((a, b) => a - b);
  const span = at.length > 1 ? ((at.at(-1) as number) - (at[0] as number)) / 86_400 : 0;
  const n = latest.map((p) => p.num_comments ?? 0).sort((a, b) => a - b);
  return {
    postsADay: span > 0 ? Math.round(((at.length - 1) / span) * 10) / 10 : 0,
    medianComments: n.length ? (n[Math.floor(n.length / 2)] as number) : 0,
  };
}

const SYSTEM = `You judge whether a subreddit is a good place for us to answer questions in \
comments. We are a one-person automation agency; our comments give concrete help from what we \
built and never pitch or link. Fit 0-10: do people like the audience ask questions here that our \
work answers. Read the rules into plain words. Answer JSON only: {"fit": n, "why": "<one line, \
quoting a title or two>", "rules": "<the rules that matter to us, plain, under 300 chars>", \
"mayComment": bool, "mayPost": bool, "linkOnly": bool (links only allowed in a profile), \
"karmaMin": n|null, "ageMinDays": n|null}`;

const JUDGED = z.object({
  fit: z.number().min(0).max(10),
  why: z.string(),
  rules: z.string(),
  mayComment: z.boolean(),
  mayPost: z.boolean(),
  linkOnly: z.boolean(),
  karmaMin: z.number().nullable(),
  ageMinDays: z.number().nullable(),
});

const titles = (ps: readonly Post[]) =>
  ps
    .slice(0, 25)
    .map((p) => `- ${(p.title ?? "").slice(0, 140)} (${p.num_comments ?? 0} comments)`)
    .join("\n");

export const rulesText = (rules: unknown) =>
  (
    ((rules as { rules?: { short_name?: string; description?: string }[] })?.rules ?? []) as {
      short_name?: string;
      description?: string;
    }[]
  )
    .map(
      (r) => `- ${r.short_name ?? ""}: ${(r.description ?? "").replace(/\s+/g, " ").slice(0, 300)}`,
    )
    .join("\n");

export async function judgePlace(
  llm: LlmClient,
  sub: string,
  read: PlaceRead,
  audience: Audience,
): Promise<PlaceJudged | null> {
  const a = read.about;
  const out = await completeAndParse(
    llm,
    `Audience: ${audience.about}\n\nr/${a.display_name ?? sub}: ${a.title ?? ""}\n${(a.public_description ?? "").slice(0, 500)}\nSubscribers: ${a.subscribers ?? "?"}. Posts: ${a.submission_type ?? "any"}.\n\nRules:\n${rulesText(read.rules) || "(none listed)"}\n\nTop this week:\n${titles(read.top)}\n\nNewest:\n${titles(read.latest)}`,
    JUDGED,
    { maxTokens: 500, system: SYSTEM, name: "reddit.place" },
  );
  if (!out.parsed) return null;
  const j = out.parsed;
  return {
    ...j,
    fit: Math.round(j.fit),
    why: j.why.replace(/\s+/g, " ").trim().slice(0, 300),
    rules: j.rules.replace(/\s+/g, " ").trim().slice(0, 400),
    ...paceOf(read.latest),
  };
}

/** Keep a read and its judgement. A watched place whose rules changed says so in `why`. */
export async function keepPlace(
  db: Queryable,
  sub: string,
  read: PlaceRead,
  judged: PlaceJudged | null,
  now: Date,
): Promise<{ rulesChanged: boolean }> {
  const [was] = await db
    .select()
    .from(redditPlaces)
    .where(eq(redditPlaces.subreddit, key(sub)));
  const before = was?.raw ? rulesText((was.raw as { rules?: unknown }).rules) : null;
  const rulesChanged = before !== null && before !== rulesText(read.rules);
  const j =
    judged && rulesChanged
      ? { ...judged, why: `Rules changed ${now.toISOString().slice(0, 10)}. ${judged.why}` }
      : judged;
  await db
    .update(redditPlaces)
    .set({
      name: read.about.display_name ?? was?.name ?? sub,
      raw: read as unknown as Record<string, unknown>,
      judged: j,
      fit: j?.fit ?? null,
      subscribers: read.about.subscribers ?? null,
      readAt: now,
    })
    .where(eq(redditPlaces.subreddit, key(sub)));
  return { rulesChanged };
}

export async function placeBySub(db: Queryable, sub: string): Promise<RedditPlace> {
  const [p] = await db
    .select()
    .from(redditPlaces)
    .where(eq(redditPlaces.subreddit, key(sub)));
  if (!p) throw new ReachRefusal(`no place r/${name(sub)}`);
  return p;
}

/**
 * The pool account for a place: a live Reddit account whose rung meets the place's karma and age
 * minimums, with the fewest watched places. Null when none fits yet.
 */
export async function accountFor(
  db: Queryable,
  place: RedditPlace,
  now: Date,
): Promise<string | null> {
  const pool = await db
    .select({
      id: reachAccounts.id,
      health: reachAccounts.health,
      places: sql<number>`(select count(*)::int from ${redditPlaces} p where p.account_id = ${reachAccounts.id} and p.state = 'watching')`,
    })
    .from(reachAccounts)
    .where(
      and(
        eq(reachAccounts.platform, "reddit"),
        inArray(reachAccounts.state, ["active", "warming"]),
      ),
    );
  const need = place.judged;
  const fits = pool.filter((a) => {
    const w = a.health ? warmupOf(a.health as AccountHealth, now) : null;
    if (!w || w.frozen) return false;
    return w.karma >= (need?.karmaMin ?? 0) && w.ageDays >= (need?.ageMinDays ?? 0);
  });
  fits.sort((a, b) => a.places - b.places);
  return fits[0]?.id ?? null;
}

export async function watchPlace(
  db: Queryable,
  sub: string,
  now: Date,
): Promise<{ account: string | null }> {
  const place = await placeBySub(db, sub);
  if (place.judged && !place.judged.mayComment)
    throw new ReachRefusal(`r/${place.name} doesn't allow our comments: ${place.judged.rules}`);
  const accountId = place.accountId ?? (await accountFor(db, place, now));
  await db
    .update(redditPlaces)
    .set({ state: "watching", accountId })
    .where(eq(redditPlaces.subreddit, place.subreddit));
  return { account: accountId };
}

export async function skipPlace(db: Queryable, sub: string): Promise<void> {
  await db
    .update(redditPlaces)
    .set({ state: "skipped" })
    .where(eq(redditPlaces.subreddit, key(sub)));
}

/** William moves a place to another of our Reddit accounts, named as reach names it or by handle. */
export async function movePlace(db: Queryable, sub: string, account: string): Promise<void> {
  const want = account.replace(/^u\//i, "").trim().toLowerCase();
  const [a] = await db
    .select({ id: reachAccounts.id })
    .from(reachAccounts)
    .where(
      and(
        eq(reachAccounts.platform, "reddit"),
        or(
          eq(sql`lower(${reachAccounts.account})`, want),
          eq(sql`lower(${reachAccounts.handle})`, want),
        ),
      ),
    );
  if (!a) throw new ReachRefusal(`no Reddit account ${account} in reach`);
  await placeBySub(db, sub);
  await db
    .update(redditPlaces)
    .set({ accountId: a.id })
    .where(eq(redditPlaces.subreddit, key(sub)));
}

/** A place Reddit wouldn't show (private, banned, gone): read again next month, not every pass. */
export async function failPlace(db: Queryable, sub: string, why: string, now: Date): Promise<void> {
  await db
    .update(redditPlaces)
    .set({ readAt: now, fit: null, judged: null, raw: { error: why.slice(0, 300) } })
    .where(eq(redditPlaces.subreddit, key(sub)));
}

/** Watched places whose threads were last read over `everyMs` ago, oldest first. */
export async function placesDue(db: Queryable, now: Date, everyMs: number, limit: number) {
  return db
    .select()
    .from(redditPlaces)
    .where(
      and(
        eq(redditPlaces.state, "watching"),
        or(
          isNull(redditPlaces.threadsAt),
          lt(redditPlaces.threadsAt, new Date(now.getTime() - everyMs)),
        ),
      ),
    )
    .orderBy(sql`${redditPlaces.threadsAt} nulls first`)
    .limit(limit);
}

export async function threadsRead(db: Queryable, sub: string, now: Date): Promise<void> {
  await db.update(redditPlaces).set({ threadsAt: now }).where(eq(redditPlaces.subreddit, sub));
}
