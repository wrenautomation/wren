/**
 * `crm run` events stage: each CRM company's dated news, and each found mover's new firm's
 * (designs/2026-10-06-company-events.md). Google's page while its day has room, else Exa's free
 * daily credit; a cap parks the rest until it lifts. One search per company a month.
 */
import { type Feed, NO_FEED } from "@wren/core";
import type { SiteClient } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { type EventsResult, recordCompanyEvents, searchEvents } from "@wren/research/companies";
import { googleLeft } from "@wren/research/enrichment";
import { type SQL, sql } from "drizzle-orm";
import { failedLine } from "./feed.js";

const ERROR_STREAK = 5;
const RECHECK_DAYS = 30;
export const EVENTS_TIMEZONE = "America/Chicago";

export interface CrmEventsStats {
  selected: number;
  found: number;
  none: number;
  unresolved: number;
  capped: number;
  errors: number;
  aborted: string | null;
}

export const NO_EVENTS: CrmEventsStats = {
  selected: 0,
  found: 0,
  none: 0,
  unresolved: 0,
  capped: 0,
  errors: 0,
  aborted: null,
};

/** Never searched, a month since the last, or a cap that has lifted. */
export const eventsDue = (companyId: SQL) =>
  sql`not exists (select 1 from company_event_checks k where k.company_id = ${companyId} and (
    (k.state = 'capped' and k.retry_at > now())
    or (k.state <> 'capped' and k.checked_at > now() - make_interval(days => ${RECHECK_DAYS}))))`;

/** The firms CRM people work at now: their CRM company, or a found mover's new one. */
export const EVENT_FIRMS = sql`
  select company_id from crm_contacts
  union
  select co.id from mover_addresses m join companies co on co.domain = m.domain
  where m.outcome = 'found'`;

export async function crmEventSubjects(db: Queryable, opts: { limit?: number } = {}) {
  return db.execute<{ company_id: number; name: string | null; domain: string | null }>(sql`
    select co.id company_id, co.name, co.domain
    from (${EVENT_FIRMS}) f join companies co on co.id = f.company_id
    where ${eventsDue(sql`co.id`)}
    order by co.id
    limit ${opts.limit ?? 1_000_000}`);
}

export async function checkCrmEvents(
  db: Queryable,
  sites: SiteClient,
  opts: {
    limit?: number;
    runId?: string | null;
    now?: () => Date;
    timezone?: string;
    feed?: Feed;
  } = {},
): Promise<CrmEventsStats> {
  const subjects = await crmEventSubjects(db, opts);
  const stats: CrmEventsStats = { ...NO_EVENTS, selected: subjects.length };
  const clock = opts.now ?? (() => new Date());
  const feed = opts.feed ?? NO_FEED;
  let google = await googleLeft(db, {
    now: clock(),
    timezone: opts.timezone ?? EVENTS_TIMEZONE,
  });
  let streak = 0;
  for (const s of subjects) {
    const firm = s.name ?? s.domain ?? "A company";
    let r: EventsResult;
    try {
      r = await searchEvents(
        sites,
        { name: s.name, domain: s.domain },
        {
          google: google > 0,
          now: clock,
        },
      );
      await recordCompanyEvents(db, s.company_id, r, opts.runId ?? null);
    } catch (err) {
      await feed.emit(failedLine("events", firm, err));
      stats.errors += 1;
      streak += 1;
      if (streak >= ERROR_STREAK) {
        stats.aborted = `${ERROR_STREAK} errors in a row, last: ${err instanceof Error ? err.message : String(err)}`;
        break;
      }
      continue;
    }
    streak = 0;
    if (r.googleStopped) google = 0;
    else if (r.tried.some((t) => t.step === "google")) google -= 1;
    stats[r.state] += 1;
    const first = r.events[0];
    await feed.emit(
      first
        ? {
            step: "events",
            subject: firm,
            kind: "found",
            line: `${firm}: ${first.title} (${first.date})`,
            count: r.events.length,
          }
        : r.state === "capped"
          ? { step: "events", subject: firm, kind: "waiting", line: `${firm}: news search capped` }
          : { step: "events", subject: firm, kind: "did", line: `${firm}: no dated news` },
    );
    if (r.state === "capped") {
      stats.aborted = `exa capped until ${r.retryAt?.toISOString() ?? "tomorrow"}`;
      break;
    }
  }
  return stats;
}
