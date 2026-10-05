/**
 * The `team` stage: one people search per firm (`searchTeam`), and everyone
 * with a current role there becomes a person with their LinkedIn and title.
 * Their address is then a free guess for Resolution to prove. One unit is one
 * firm; it writes before the next starts, and a searched firm is never picked
 * again unless a cap parked it, so a stop is a pause and a rerun resumes.
 *
 * Which firms come first is the caller's call; this stage takes company ids in
 * that order and keeps the ones still due.
 */
import type { SiteClient } from "@wren/core/content";
import { people } from "@wren/core/schema";
import type { Queryable } from "@wren/db";
import { eq, type SQL, sql } from "drizzle-orm";
import { noNul } from "../findings.js";
import { Capped, failedRead } from "../pacing.js";
import { sameName } from "../people/names.js";
import { searchTeam, type TeamMember } from "../people/team.js";
import { type LookupState, teamSearches } from "../schema.js";

export const TEAM_COMMAND = "enrich team";
/** Errors in a row that stop the run: something is down, not one odd firm. */
const ERROR_STREAK = 5;
/** `people.source_key` is varchar(64). */
const MAX_KEY = 64;

export interface TeamWork {
  companyId: number;
  name: string | null;
  domain: string | null;
}

export interface TeamUnit {
  companyId: number;
  state: LookupState | "skipped" | "error";
  /** People this firm's search gave: new rows. */
  added: number;
  /** People we held at the firm who got a LinkedIn or title from it. */
  filled: number;
  capped: boolean;
  failedRead: boolean;
  error: string | null;
}

export interface TeamStats {
  selected: number;
  firms_matched: number;
  firms_unresolved: number;
  /** Firms with no name worth searching: marked unresolved, no search spent. */
  firms_skipped: number;
  people_added: number;
  people_filled: number;
  errors: number;
  /** Why the run stopped early; null = it ran out of firms. */
  stopped: string | null;
}

export const emptyTeamStats = (): TeamStats => ({
  selected: 0,
  firms_matched: 0,
  firms_unresolved: 0,
  firms_skipped: 0,
  people_added: 0,
  people_filled: 0,
  errors: 0,
  stopped: null,
});

/** Not searched, or a cap parked it and has lifted. */
export const teamDue = (id: SQL) =>
  sql`not exists (select 1 from team_searches t where t.company_id = ${id}
    and (t.state <> 'capped' or t.retry_at > now()))`;

/** When a cap parked this stage, until when; null = not parked. */
export async function teamParkedUntil(db: Queryable): Promise<Date | null> {
  const [row] = await db.execute<{ until: string | null }>(sql`
    select max(retry_at) as until from team_searches where state = 'capped' and retry_at > now()`);
  return row?.until ? new Date(row.until) : null;
}

/** The due firms among `companyIds`, in that order, at most `limit`. */
export async function teamWork(
  db: Queryable,
  companyIds: readonly number[],
  opts: { limit?: number } = {},
): Promise<TeamWork[]> {
  if (companyIds.length === 0) return [];
  const ids = sql.join(
    companyIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.execute<{ id: number; name: string | null; domain: string | null }>(sql`
    select c.id, c.name, c.domain
    from unnest(array[${ids}]::int[]) with ordinality as q(id, ord)
    join companies c on c.id = q.id
    where ${teamDue(sql`c.id`)}
    order by q.ord
    limit ${opts.limit ?? 1_000_000}`);
  return rows.map((r) => ({ companyId: r.id, name: r.name, domain: r.domain }));
}

/**
 * The search's people into `people`. Someone held at the firm by the same name
 * gets the LinkedIn and title they lack; a profile held anywhere is a sighting
 * (its `li:` key); anyone else is a new person.
 */
export async function keepMembers(
  db: Queryable,
  companyId: number,
  members: readonly TeamMember[],
  ref: { query: string },
): Promise<{ added: number; filled: number }> {
  if (members.length === 0) return { added: 0, filled: 0 };
  const held = await db
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      title: people.title,
      linkedinUrl: people.linkedinUrl,
    })
    .from(people)
    .where(eq(people.companyId, companyId));
  let added = 0;
  let filled = 0;
  for (const m of members) {
    const same = held.filter((h) =>
      sameName({ firstName: h.firstName, lastName: h.lastName }, m.fullName),
    );
    // Two held people by one name: neither is surely them; the profile waits for `profiles`.
    if (same.length > 1) continue;
    const [h] = same;
    if (h) {
      if (h.linkedinUrl && h.title) continue;
      const set = {
        ...(h.linkedinUrl ? {} : { linkedinUrl: m.linkedin }),
        ...(h.title ? {} : { title: m.title }),
      };
      await db.update(people).set(set).where(eq(people.id, h.id));
      filled++;
      continue;
    }
    const key = `li:${m.vanity.toLowerCase()}`;
    const inserted = await db
      .insert(people)
      .values({
        companyId,
        sourceKey: key.length <= MAX_KEY ? key : null,
        fullName: m.fullName,
        firstName: m.firstName,
        lastName: m.lastName,
        title: m.title,
        isCompliance: false,
        origin: "linkedin",
        originRef: m.linkedin,
        linkedinUrl: m.linkedin,
        raw: noNul({ via: "team search", query: ref.query, title: m.title }),
      })
      .onConflictDoNothing({ target: people.sourceKey })
      .returning({ id: people.id });
    if (inserted.length > 0) {
      added++;
      held.push({
        id: inserted[0]?.id ?? 0,
        firstName: m.firstName,
        lastName: m.lastName,
        title: m.title,
        linkedinUrl: m.linkedin,
      });
    }
  }
  return { added, filled };
}

async function mark(
  db: Queryable,
  companyId: number,
  row: Omit<typeof teamSearches.$inferInsert, "companyId">,
): Promise<void> {
  const values = { ...row, profiles: noNul(row.profiles) };
  await db
    .insert(teamSearches)
    .values({ companyId, ...values })
    .onConflictDoUpdate({
      target: teamSearches.companyId,
      set: { ...values, searchedAt: sql`now()` },
    });
}

/**
 * One firm. Never throws: a site error is the unit's result, so a durable
 * runner never retries a metered search.
 */
export async function teamUnit(
  db: Queryable,
  sites: SiteClient,
  work: TeamWork,
  opts: { runId?: string | null; now?: () => Date; sleep?: (ms: number) => Promise<void> } = {},
): Promise<TeamUnit> {
  const unit: TeamUnit = {
    companyId: work.companyId,
    state: "error",
    added: 0,
    filled: 0,
    capped: false,
    failedRead: false,
    error: null,
  };
  const runId = opts.runId ?? null;
  const firm = { name: work.name, domain: work.domain };
  try {
    const found = await searchTeam(sites, firm, {
      ...(opts.now ? { now: opts.now } : {}),
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
    });
    if (!found) {
      // No name worth a search: marked, so it never holds the head of the queue.
      unit.state = "skipped";
      await mark(db, work.companyId, {
        state: "unresolved",
        query: "",
        profiles: [],
        retryAt: null,
        runId,
      });
      return unit;
    }
    const kept = await keepMembers(db, work.companyId, found.members, found);
    unit.state = found.members.length > 0 ? "matched" : "unresolved";
    unit.added = kept.added;
    unit.filled = kept.filled;
    await mark(db, work.companyId, {
      state: unit.state,
      query: found.query,
      profiles: found.profiles,
      kept: found.members.length,
      retryAt: null,
      runId,
    });
  } catch (err) {
    if (err instanceof Capped) {
      unit.state = "capped";
      unit.capped = true;
      await mark(db, work.companyId, {
        state: "capped",
        query: "",
        profiles: [],
        retryAt: err.retryAt,
        runId,
      });
      return unit;
    }
    unit.failedRead = failedRead(err, "web");
    unit.error = (err as Error).message;
  }
  return unit;
}

/** Adds a unit to the run's stats; returns why the run stops, or null. */
export function countTeamUnit(
  stats: TeamStats,
  u: TeamUnit,
  streak: { errors: number },
): string | null {
  if (u.state === "matched") stats.firms_matched++;
  if (u.state === "unresolved") stats.firms_unresolved++;
  if (u.state === "skipped") stats.firms_skipped++;
  stats.people_added += u.added;
  stats.people_filled += u.filled;
  if (u.capped) return "Exa's daily cap";
  if (u.state !== "error") {
    streak.errors = 0;
    return null;
  }
  stats.errors++;
  streak.errors++;
  if (u.failedRead) return `a metered search failed: ${u.error}`;
  if (streak.errors >= ERROR_STREAK) return `${ERROR_STREAK} errors in a row: ${u.error}`;
  return null;
}
