/**
 * `wren crm lookup`: where is each CRM contact now (R7)? One person per unit:
 * a person is looked up, written, and never picked again unless a cap parked
 * them (then once the cap lifts) or `again` asks for a fresh pass. Ctrl-C is a
 * pause; re-running resumes.
 */
import { eachConcurrently } from "@wren/channel-email";
import { type Feed, NO_FEED } from "@wren/core";
import type { SiteClient } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import type { FindingKind } from "@wren/research";
import { failedRead } from "@wren/research/pacing";
import {
  type LookupOptions,
  type LookupSubject,
  lookUpPerson,
  recordLookup,
} from "@wren/research/people";
import { type SQL, sql } from "drizzle-orm";
import { failedLine, fullName, headline, lookupLine } from "./feed.js";

/** Errors in a row that stop the run: something is down, not one odd person. */
const ERROR_STREAK = 5;

export interface CrmLookupStats {
  selected: number;
  matched: number;
  unresolved: number;
  capped: number;
  errors: number;
  findings: Partial<Record<FindingKind, number>>;
  /** People, by the finding their line names: one person is one move or one departure. */
  moved: number;
  left: number;
  aborted: string | null;
}

export interface CrmLookupOptions {
  /** The account for logged-in LinkedIn reads; null = web search only. */
  linkedin: string | null;
  limit?: number;
  concurrency?: number;
  /** Look up people already looked up, too. */
  again?: boolean;
  runId?: string | null;
  now?: () => Date;
  feed?: Feed;
}

interface Row extends Record<string, unknown> {
  person_id: number;
  first_name: string | null;
  last_name: string | null;
  linkedin_url: string | null;
  firm_name: string | null;
  firm_domain: string | null;
  email: string | null;
  result: string | null;
  verifier: string | null;
}

/**
 * Is this person due a lookup: never looked up, or parked by a cap that has
 * lifted (or never said when)? `crm status` counts with the same rule.
 */
export const dueForLookup = (personId: SQL) =>
  sql`not exists (select 1 from person_lookups l where l.person_id = ${personId}
    and (l.state <> 'capped' or l.retry_at > now()))`;

/**
 * Each CRM person once, at the firm of their latest CRM row, with the latest
 * verdict on a CRM address, the firm's own domain first: a work mailbox that
 * rejects mail is the signal, a later gmail verdict says nothing.
 */
export async function crmLookupSubjects(
  db: Queryable,
  opts: { limit?: number; again?: boolean } = {},
): Promise<LookupSubject[]> {
  const due = opts.again ? sql`true` : dueForLookup(sql`p.id`);
  const rows = await db.execute<Row>(sql`
    with latest as (
      select distinct on (c.person_id) c.person_id, c.company_id
      from crm_contacts c order by c.person_id, c.id desc
    )
    select p.id person_id, p.first_name, p.last_name, p.linkedin_url,
      co.name firm_name, co.domain firm_domain, vd.email, vd.result, vd.verifier
    from latest
    join people p on p.id = latest.person_id
    join companies co on co.id = latest.company_id
    left join lateral (
      select cc.email, v.result, v.verifier
      from contact_candidates cc join verifications v on v.contact_candidate_id = cc.id
      -- Only a verdict that can mint a fact: a stub verifier calls every mailbox live. Local is authoritative.
      where cc.person_id = p.id and cc.evidence = 'crm'
        and (v.verifier = 'local' or (v.raw->>'authoritative')::boolean)
      order by (lower(split_part(cc.email, '@', 2)) = lower(co.domain)) desc nulls last,
        v.checked_at desc, v.id desc
      limit 1
    ) vd on true
    where ${due}
    order by p.id
    limit ${opts.limit ?? 1_000_000}`);
  return rows.map((r) => ({
    personId: r.person_id,
    firstName: r.first_name,
    lastName: r.last_name,
    firm: { name: r.firm_name, domain: r.firm_domain },
    linkedinUrl: r.linkedin_url,
    email:
      r.email && r.result && r.verifier
        ? { address: r.email, result: r.result, verifier: r.verifier }
        : null,
  }));
}

export async function lookUpCrmPeople(
  db: Queryable,
  sites: SiteClient,
  opts: CrmLookupOptions,
): Promise<CrmLookupStats> {
  const subjects = await crmLookupSubjects(db, opts);
  const stats: CrmLookupStats = {
    selected: subjects.length,
    matched: 0,
    unresolved: 0,
    capped: 0,
    errors: 0,
    findings: {},
    moved: 0,
    left: 0,
    aborted: null,
  };
  const lookup: LookupOptions = { linkedin: opts.linkedin, ...(opts.now ? { now: opts.now } : {}) };
  const feed = opts.feed ?? NO_FEED;
  let streak = 0;
  await eachConcurrently(
    subjects,
    opts.concurrency ?? 2,
    async (s) => {
      let r: Awaited<ReturnType<typeof lookUpPerson>>;
      const name = fullName(s.firstName, s.lastName);
      try {
        r = await lookUpPerson(sites, s, lookup);
        await recordLookup(db, s.personId, r, opts.runId ?? null);
      } catch (err) {
        await feed.emit(failedLine("lookup", name, err));
        stats.errors += 1;
        if (failedRead(err, "linkedin"))
          stats.aborted ??= `LinkedIn failed a read, so stopped asking it: ${(err as Error).message}`;
        // Exa's cache and people search are metered: one failed read stops them too.
        if (failedRead(err, "web"))
          stats.aborted ??= `web failed a read, so stopped asking it: ${(err as Error).message}`;
        streak += 1;
        if (streak >= ERROR_STREAK)
          stats.aborted ??= `${ERROR_STREAK} errors in a row, last: ${err instanceof Error ? err.message : String(err)}`;
        return;
      }
      streak = 0;
      await feed.emit(lookupLine(name, r));
      stats[r.state] += 1;
      for (const f of r.findings) stats.findings[f.kind] = (stats.findings[f.kind] ?? 0) + 1;
      const top = r.state === "matched" ? headline(r.findings)?.kind : null;
      if (top === "job_change") stats.moved += 1;
      else if (top === "left") stats.left += 1;
      if (r.state !== "capped" || !r.retryAt) return;
      // LinkedIn capped: the rest go on by search alone and park at step 3.
      // Search capped: nobody else can get anywhere today.
      if (r.cappedBy === "linkedin") lookup.linkedinCappedUntil = r.retryAt;
      else stats.aborted ??= `${r.cappedBy} capped until ${r.retryAt.toISOString()}`;
    },
    () => stats.aborted !== null,
  );
  return stats;
}
