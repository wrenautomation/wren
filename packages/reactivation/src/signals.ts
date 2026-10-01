/**
 * `crm run` signals stage: is each CRM company hiring (R8)? One company per
 * unit, checked, written, and not picked again until its answer goes stale:
 * a week for an answer, a month for "couldn't tell", the cap's own time for a
 * capped one. Biggest companies (most CRM people) first, so a cap costs the
 * small ones. Ctrl-C is a pause; re-running resumes.
 */
import { eachConcurrently } from "@wren/channel-email";
import { type Feed, NO_FEED } from "@wren/core";
import type { SiteClient } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { failedRead } from "@wren/research";
import {
  type CompanySubject,
  checkHiring,
  type HiringOptions,
  linkedinCompany,
  recordCompanyCheck,
} from "@wren/research/companies";
import type { Fetcher } from "@wren/research/fetch";
import { type SQL, sql } from "drizzle-orm";
import { failedLine, hiringLine } from "./feed.js";
import { LATEST_CRM_ROW } from "./score.js";

/** Errors in a row that stop the run: something is down, not one odd company. */
const ERROR_STREAK = 5;

export interface CrmSignalsStats {
  selected: number;
  hiring: number;
  no_openings: number;
  unresolved: number;
  capped: number;
  errors: number;
  aborted: string | null;
}

export interface CrmSignalsDeps {
  /** For the firm's own site and its job board; null = LinkedIn only. */
  fetcher: Fetcher | null;
  sites: SiteClient;
}

export interface CrmSignalsOptions {
  /** The account for logged-in LinkedIn reads; null = job boards only. */
  linkedin: string | null;
  limit?: number;
  concurrency?: number;
  runId?: string | null;
  now?: () => Date;
  feed?: Feed;
}

/**
 * Is this company due a check: never checked, an answer older than a week,
 * "couldn't tell" older than a month, or parked by a cap that has lifted (or
 * never said when)? `crm status` counts with the same rule.
 */
export const dueForCheck = (companyId: SQL) =>
  sql`not exists (select 1 from company_checks k where k.company_id = ${companyId} and (
    (k.state = 'capped' and k.retry_at > now())
    or (k.state in ('hiring', 'no_openings') and k.checked_at > now() - interval '7 days')
    or (k.state = 'unresolved' and k.checked_at > now() - interval '30 days')))`;

interface Row extends Record<string, unknown> {
  company_id: number;
  name: string | null;
  domain: string | null;
  social_url: string | null;
  profile_page: string | null;
}

/**
 * Each company a CRM row points at, with its LinkedIn page when something we
 * trust already tied it to the firm: a matched profile's current role there
 * (freshest first; only people whose latest CRM row is this firm, since that
 * is the firm their lookup read), else the company's own social link.
 */
export async function crmSignalSubjects(
  db: Queryable,
  opts: { limit?: number } = {},
): Promise<CompanySubject[]> {
  const rows = await db.execute<Row>(sql`
    with crm as (
      select company_id, count(distinct person_id) people from crm_contacts group by company_id
    )
    select co.id company_id, co.name, co.domain, co.social_url,
      (select f.value->>'companyUrl' from findings f
        where f.kind = 'still_there' and f.value->>'companyUrl' is not null
          and f.person_id in (select l.person_id from (${LATEST_CRM_ROW}) l where l.company_id = co.id)
        order by f.observed_at desc, f.id desc limit 1) profile_page
    from crm join companies co on co.id = crm.company_id
    where ${dueForCheck(sql`co.id`)}
    order by crm.people desc, co.id
    limit ${opts.limit ?? 1_000_000}`);
  return rows.map((r) => ({
    companyId: r.company_id,
    firm: { name: r.name, domain: r.domain },
    linkedinPage: linkedinCompany(r.profile_page) ?? linkedinCompany(r.social_url),
  }));
}

export async function checkCrmCompanies(
  db: Queryable,
  deps: CrmSignalsDeps,
  opts: CrmSignalsOptions,
): Promise<CrmSignalsStats> {
  const subjects = await crmSignalSubjects(db, opts);
  const stats: CrmSignalsStats = {
    selected: subjects.length,
    hiring: 0,
    no_openings: 0,
    unresolved: 0,
    capped: 0,
    errors: 0,
    aborted: null,
  };
  // Nothing to read with: every check would come back "couldn't tell" and park a month.
  if (!deps.fetcher && !opts.linkedin) {
    stats.aborted = "signals need a site fetcher or a LinkedIn account: set WREN_FETCH_CONTACT";
    return stats;
  }
  const hiring: HiringOptions = { linkedin: opts.linkedin, ...(opts.now ? { now: opts.now } : {}) };
  const feed = opts.feed ?? NO_FEED;
  let streak = 0;
  await eachConcurrently(
    subjects,
    opts.concurrency ?? 3,
    async (s) => {
      let r: Awaited<ReturnType<typeof checkHiring>>;
      const firm = s.firm.name ?? s.firm.domain ?? "A company";
      try {
        r = await checkHiring(deps, s, hiring);
        await recordCompanyCheck(db, s.companyId, r, opts.runId ?? null);
      } catch (err) {
        await feed.emit(failedLine("signals", firm, err));
        stats.errors += 1;
        if (failedRead(err, "linkedin"))
          stats.aborted ??= `LinkedIn failed a read, so stopped asking it: ${(err as Error).message}`;
        streak += 1;
        if (streak >= ERROR_STREAK)
          stats.aborted ??= `${ERROR_STREAK} errors in a row, last: ${err instanceof Error ? err.message : String(err)}`;
        return;
      }
      streak = 0;
      await feed.emit(hiringLine(firm, r));
      stats[r.state] += 1;
      if (r.state !== "capped" || !r.retryAt) return;
      // LinkedIn capped: the rest still get their job board, and park after.
      // Search capped: no page can be found for anyone else today.
      if (r.cappedBy === "linkedin") hiring.linkedinCappedUntil = r.retryAt;
      else stats.aborted ??= `${r.cappedBy} capped until ${r.retryAt.toISOString()}`;
    },
    () => stats.aborted !== null,
  );
  return stats;
}
