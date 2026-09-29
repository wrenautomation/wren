/**
 * Where a client's reactivation stands and what runs next: one screen, so
 * nobody has to remember the order of the stages. `crm run` does the next
 * stages that are due; this says which those are.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { briefsDue } from "./brief.js";
import { composeDue } from "./compose.js";
import { type CrmHealth, crmHealth } from "./crm/health.js";
import { dueForLookup } from "./lookup.js";
import type { ClientProfile } from "./schema.js";
import { scoreDue } from "./score.js";
import type { ReactivationSettings } from "./settings.js";
import { dueForCheck } from "./signals.js";

/** The stages `crm run` walks, in order. */
export const CRM_STAGES = ["verify", "lookup", "signals", "score", "brief", "compose"] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

export interface CrmStatus {
  health: CrmHealth;
  lookup: {
    matched: number;
    unresolved: number;
    capped: number;
    /** Never looked up, or parked by a cap that has lifted. */
    due: number;
    /** When the next parked person can go; null when none waits. */
    waitingUntil: string | null;
  };
  /** Companies checked for open roles. */
  signals: {
    hiring: number;
    noOpenings: number;
    unresolved: number;
    capped: number;
    due: number;
    waitingUntil: string | null;
  };
  /** People scored, people to rescore (everyone, when anything changed), and the best so far. */
  score: { scored: number; due: number; top: { score: number; count: number }[] };
  briefs: { written: number; empty: number; failed: number; due: number };
  /** Emails written and where they stand; `blocked` says why none would be written now. */
  emails: {
    drafted: number;
    awaiting: number;
    approved: number;
    sent: number;
    failed: number;
    due: number;
    blocked: string | null;
  };
  /** The stages `crm run` would do now, in order; empty when nothing is due. */
  due: CrmStage[];
  /** One line: what to do next. */
  next: string;
}

export interface CrmStatusOptions {
  today?: Date;
  /** The client's settings and profile; without them compose is never due. */
  compose?: { settings: ReactivationSettings; profile: ClientProfile | null };
}

export async function crmStatus(db: Queryable, opts: CrmStatusOptions = {}): Promise<CrmStatus> {
  const health = await crmHealth(db, opts.today ?? new Date());
  const [l] = await db.execute<{
    matched: number;
    unresolved: number;
    capped: number;
    due: number;
    waiting_until: string | null;
  }>(sql`
    select
      count(*) filter (where l.state = 'matched')::int matched,
      count(*) filter (where l.state = 'unresolved')::int unresolved,
      count(*) filter (where l.state = 'capped')::int capped,
      count(*) filter (where ${dueForLookup(sql`c.person_id`)})::int due,
      min(l.retry_at) filter (where l.state = 'capped' and l.retry_at > now())::text waiting_until
    from (select distinct person_id from crm_contacts) c
    left join person_lookups l on l.person_id = c.person_id`);
  const lookup = {
    matched: l?.matched ?? 0,
    unresolved: l?.unresolved ?? 0,
    capped: l?.capped ?? 0,
    due: l?.due ?? 0,
    waitingUntil: l?.waiting_until ?? null,
  };
  const [k] = await db.execute<{
    hiring: number;
    no_openings: number;
    unresolved: number;
    capped: number;
    due: number;
    waiting_until: string | null;
  }>(sql`
    select
      count(*) filter (where k.state = 'hiring')::int hiring,
      count(*) filter (where k.state = 'no_openings')::int no_openings,
      count(*) filter (where k.state = 'unresolved')::int unresolved,
      count(*) filter (where k.state = 'capped')::int capped,
      count(*) filter (where ${dueForCheck(sql`c.company_id`)})::int due,
      min(k.retry_at) filter (where k.state = 'capped' and k.retry_at > now())::text waiting_until
    from (select distinct company_id from crm_contacts) c
    left join company_checks k on k.company_id = c.company_id`);
  const signals = {
    hiring: k?.hiring ?? 0,
    noOpenings: k?.no_openings ?? 0,
    unresolved: k?.unresolved ?? 0,
    capped: k?.capped ?? 0,
    due: k?.due ?? 0,
    waitingUntil: k?.waiting_until ?? null,
  };
  const top = await db.execute<{ score: number; count: number }>(sql`
    select s.score, count(*)::int count from contact_scores s
    where s.person_id in (select person_id from crm_contacts) and s.score > 0
    group by s.score order by s.score desc limit 3`);
  const [scored] = await db.execute<{ n: number }>(sql`
    select count(*)::int n from contact_scores
    where person_id in (select person_id from crm_contacts)`);
  const score = { scored: scored?.n ?? 0, due: await scoreDue(db), top: [...top] };
  const [b] = await db.execute<{ written: number; empty: number; failed: number }>(sql`
    select
      count(*) filter (where b.state = 'written')::int written,
      count(*) filter (where b.state = 'empty')::int empty,
      count(*) filter (where b.state = 'failed')::int failed
    from briefs b where b.person_id in (select person_id from crm_contacts)`);
  const briefs = {
    written: b?.written ?? 0,
    empty: b?.empty ?? 0,
    failed: b?.failed ?? 0,
    due: await briefsDue(db),
  };
  const [e] = await db.execute<{
    drafted: number;
    awaiting: number;
    approved: number;
    sent: number;
    failed: number;
  }>(sql`
    select
      (select count(*) from compositions where state = 'drafted')::int drafted,
      (select count(*) from compositions where state = 'failed')::int failed,
      count(*) filter (where m.state = 'draft' and en.state = 'active')::int awaiting,
      count(*) filter (where m.state = 'approved')::int approved,
      count(*) filter (where m.state = 'sent')::int sent
    from messages m join enrollments en on en.id = m.enrollment_id
    where en.offer = 'reactivation' and m.step = 0`);
  const compose = opts.compose
    ? await composeDue(db, opts.compose.settings, opts.compose.profile)
    : { due: 0, blocked: "settings not given" };
  const emails = {
    drafted: e?.drafted ?? 0,
    awaiting: e?.awaiting ?? 0,
    approved: e?.approved ?? 0,
    sent: e?.sent ?? 0,
    failed: e?.failed ?? 0,
    ...compose,
  };
  const count: Record<CrmStage, number> = {
    verify: health.verification.unchecked,
    lookup: lookup.due,
    signals: signals.due,
    score: score.due,
    brief: briefs.due,
    compose: emails.due,
  };
  const does: Record<CrmStage, string> = {
    verify: `verify ${count.verify} addresses`,
    lookup: `look up ${count.lookup} people`,
    signals: `check ${count.signals} companies for open roles`,
    score: `score ${count.score} people`,
    brief: `write ${count.brief} briefs`,
    compose: `write ${count.compose} emails`,
  };
  const due = CRM_STAGES.filter((s) => count[s] > 0);
  const parked = [
    lookup.waitingUntil && `${lookup.capped} people until ${lookup.waitingUntil}`,
    signals.waitingUntil && `${signals.capped} companies until ${signals.waitingUntil}`,
  ].filter(Boolean);
  const next =
    health.rows === 0
      ? "import the CRM export: `wren --client <id> crm import <file> --format <name>`"
      : due.length
        ? `\`wren --client <id> crm run\`: ${due.map((s) => does[s]).join(", then ")}`
        : parked.length
          ? `wait: parked on a daily cap: ${parked.join("; ")}`
          : briefs.failed
            ? `wait: ${briefs.failed} failed briefs retry a day after they failed`
            : "nothing due: everyone is verified, looked up, scored and briefed";
  return { health, lookup, signals, score, briefs, emails, due, next };
}

export function formatCrmStatus(s: CrmStatus): string[] {
  const l = s.lookup;
  const k = s.signals;
  const b = s.briefs;
  return [
    ...formatHealthBrief(s.health),
    `looked up: matched ${l.matched}  unresolved ${l.unresolved}  parked ${l.capped}  due ${l.due}`,
    `companies: hiring ${k.hiring}  no openings ${k.noOpenings}  unresolved ${k.unresolved}  parked ${k.capped}  due ${k.due}`,
    `scores: ${
      !s.score.scored
        ? "not scored yet"
        : `${s.score.top.length ? s.score.top.map((t) => `${t.count} at ${t.score}`).join(", ") : "none above zero"}${s.score.due ? "  (stale)" : ""}`
    }`,
    `briefs: written ${b.written}  empty ${b.empty}  failed ${b.failed}  due ${b.due}`,
    `emails: written ${s.emails.drafted}  awaiting approval ${s.emails.awaiting}  approved ${s.emails.approved}  sent ${s.emails.sent}  failed ${s.emails.failed}  due ${s.emails.due}${s.emails.blocked ? `  (${s.emails.blocked})` : ""}`,
    `next: ${s.next}`,
  ];
}

function formatHealthBrief(h: CrmHealth): string[] {
  const v = h.verification;
  return [
    `people ${h.people}  companies ${h.companies}  rows ${h.rows}`,
    `emails: valid ${v.valid}  invalid ${v.invalid}  risky ${v.risky}  catch-all ${v.catch_all}  unchecked ${v.unchecked}`,
    `send gate: ${h.gate.reason}`,
  ];
}
