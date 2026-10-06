/**
 * People: a Reddit profile read into who they are (designs/2026-10-06-reddit-discovery.md,
 * People). Three signed-out reads, kept raw; code reads age, karma, places, linked domains and
 * active hours for $0; one model call reads role, business, size, location, site and struggles,
 * each quoting their words. A fact whose quote isn't in their words is dropped: never guessed.
 */
import type { Profile } from "@wren/core/outreach";
import type { Queryable } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  type PersonFacts,
  type PersonRead,
  type Quoted,
  type RedditPerson,
  redditPeople,
} from "../schema.js";
import type { Reader } from "./reads.js";

/** A profile read this recently is read from the table, not Reddit. */
export const PERSON_FRESH_MS = 30 * 86_400_000;

/** Hosts that say nothing about the person. */
const NOT_THEIRS =
  /(^|\.)(reddit\.com|redd\.it|imgur\.com|youtube\.com|youtu\.be|google\.com|x\.com|twitter\.com|github\.com|linkedin\.com|wikipedia\.org|amazon\.com|medium\.com)$/;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

const counted = (xs: string[]) =>
  [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

export function personFacts(p: Profile, now: Date): PersonFacts {
  const about = (p.raw.about ?? {}) as {
    created_utc?: number;
    total_karma?: number;
    link_karma?: number;
    comment_karma?: number;
  };
  const hours = p.recent.map((r) => new Date(r.at).getUTCHours());
  const peak = counted(hours.map(String))[0];
  return {
    ageDays: about.created_utc
      ? Math.floor((now.getTime() - about.created_utc * 1000) / 86_400_000)
      : null,
    karma: about.total_karma ?? (about.link_karma ?? 0) + (about.comment_karma ?? 0),
    places: counted(p.recent.map((r) => r.where.split(" · ")[0] ?? "")).map(([place, n]) => ({
      place,
      n,
    })),
    domains: counted(
      p.recent.flatMap((r) =>
        [...r.text.matchAll(/https?:\/\/[^\s)\]]+/g)].flatMap((m) => {
          const h = hostOf(m[0]);
          return h && !NOT_THEIRS.test(h) ? [h] : [];
        }),
      ),
    ).map(([domain, n]) => ({ domain, n })),
    peakHourUtc: peak ? Number(peak[0]) : null,
  };
}

const SYSTEM = `You read a Reddit user's recent posts and comments to learn who they are. Only \
state what their own words say; quote the exact words (a short span, copied verbatim) for every \
fact. Unknown = null. "site" is only a website they say is theirs ("my agency, acme.com"), never \
one they merely linked. Fit 0-10 is how well they match the audience. Answer JSON only: {"role": \
F, "business": F, "size": F, "location": F, "site": F, "struggles": [F], "fit": 0-10, "why": \
"<one line>"} where F = {"value": "<short>", "quote": "<their exact words>"} or null.`;

const FACT = z.object({ value: z.string(), quote: z.string() }).nullable();
const READ = z.object({
  role: FACT,
  business: FACT,
  size: FACT,
  location: FACT,
  site: FACT,
  struggles: z.array(FACT).default([]),
  fit: z.number().min(0).max(10),
  why: z.string(),
});

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Their words as the model sees them: newest first, each item trimmed. */
export const wordsOf = (p: Profile) =>
  p.recent
    .slice(0, 60)
    .map((r) => `[${r.where}] ${r.text.replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");

/** The model's read, with every fact checked against their words. */
export async function readWords(
  llm: LlmClient,
  p: Profile,
  audience: string,
): Promise<{ read: PersonRead; fit: number; site: string | null } | null> {
  const words = wordsOf(p);
  if (!words) return null;
  const out = await completeAndParse(
    llm,
    `Audience: ${audience}\nu/${p.handle} wrote:\n${words}`,
    READ,
    { maxTokens: 600, system: SYSTEM, name: "reddit.person" },
  );
  if (!out.parsed) return null;
  const said = norm(words);
  const keep = (f: Quoted | null) =>
    f && f.quote.trim().length >= 3 && said.includes(norm(f.quote)) ? f : null;
  const r = out.parsed;
  const site = keep(r.site);
  const host = site
    ? hostOf(/^https?:/.test(site.value) ? site.value : `https://${site.value}`)
    : null;
  return {
    read: {
      role: keep(r.role),
      business: keep(r.business),
      size: keep(r.size),
      location: keep(r.location),
      website: site,
      struggles: r.struggles.flatMap((f) => (keep(f) ? [f as Quoted] : [])),
      why: r.why.replace(/\s+/g, " ").trim().slice(0, 300),
    },
    fit: Math.round(r.fit),
    // A site is theirs only when the host is in their words too.
    site: host && said.includes(host) ? host : null,
  };
}

export async function personByHandle(db: Queryable, handle: string): Promise<RedditPerson | null> {
  const [p] = await db
    .select()
    .from(redditPeople)
    .where(eq(redditPeople.handle, handle.toLowerCase()));
  return p ?? null;
}

/** Keep a read profile and its reading; a re-read replaces both. */
export async function keepPerson(
  db: Queryable,
  p: Profile,
  read: Awaited<ReturnType<typeof readWords>>,
  now: Date,
): Promise<RedditPerson> {
  const row = {
    handle: p.handle.toLowerCase(),
    name: p.handle,
    raw: { about: p.raw.about ?? null, recent: p.recent },
    facts: personFacts(p, now),
    read: read?.read ?? null,
    fit: read?.fit ?? null,
    site: read?.site ?? null,
    readAt: now,
  };
  const [kept] = await db
    .insert(redditPeople)
    .values(row)
    .onConflictDoUpdate({ target: redditPeople.handle, set: row })
    .returning();
  return kept as RedditPerson;
}

/**
 * One person, read now unless the table holds a fresh read. Reddit reads go through `reader`
 * (signed out); the model call and the write are the caller's `step`, so Restate journals them.
 */
export async function readPerson(
  r: Reader,
  db: Queryable,
  llm: LlmClient | null,
  handle: string,
  o: { audience: string; now: Date; step?: <T>(name: string, fn: () => Promise<T>) => Promise<T> },
): Promise<RedditPerson> {
  const step = o.step ?? ((_n, fn) => fn());
  const known = await step("known", () => personByHandle(db, handle));
  if (known && o.now.getTime() - new Date(known.readAt).getTime() < PERSON_FRESH_MS) return known;
  const p = await r.person(handle);
  return step(`keep u/${handle}`, async () =>
    keepPerson(db, p, llm ? await readWords(llm, p, o.audience) : null, o.now),
  );
}

/** One line for a row or a prompt: "agency owner · 10 people · Austin (fit 8)". */
export function personLine(p: Pick<RedditPerson, "read" | "fit" | "site">): string | null {
  const r = p.read;
  if (!r) return null;
  const bits = [r.role?.value, r.business?.value, r.size?.value, r.location?.value, p.site].filter(
    Boolean,
  );
  return bits.length ? `${bits.join(" · ")}${p.fit != null ? ` (fit ${p.fit})` : ""}` : null;
}

/**
 * Who to read next: Reddit commenters on our posts and Reddit DM contacts with no fresh read,
 * newest first. Never a sweep of a subreddit's users.
 */
export async function peopleToRead(
  db: Queryable,
  ours: string[],
  now: Date,
  limit: number,
): Promise<string[]> {
  const stale = new Date(now.getTime() - PERSON_FRESH_MS).toISOString();
  const mine = ours.map((h) => h.toLowerCase());
  const rows = (await db.execute(sql`
    select w.handle from (
      select lower(author) handle, max(at) at from comments
        where platform = 'reddit' and sort is distinct from 'ours' group by 1
      union all
      select lower(handle), max(created_at) from reach_contacts where platform = 'reddit' group by 1
    ) w
    left join reddit_people p on p.handle = w.handle
    where (p.handle is null or p.read_at < ${stale}) and w.handle not in ('[deleted]', '')
      ${
        mine.length
          ? sql`and w.handle not in (${sql.join(
              mine.map((h) => sql`${h}`),
              sql`, `,
            )})`
          : sql``
      }
    group by w.handle order by max(w.at) desc limit ${limit}`)) as unknown as { handle: string }[];
  return rows.map((r) => r.handle);
}
