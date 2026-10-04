/**
 * `crm run` score stage: who goes first (R10). Hiring at their company beats
 * a job change, which beats still there and recently in touch, which beats
 * stale; someone who left scores nothing. Every CRM person is rescored from
 * one read of what the other stages found (no calls, no per-person queries),
 * with the reasons in a recruiter's words and the facts behind each, so the
 * portal can say why. The score also says what to do: only a signal (a move
 * with a firm to write to, or open roles) is a reason to reach out; the rest
 * are kept warm.
 */
import type { Queryable } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";
import { contactScores, type NextStep } from "./schema.js";

export const POINTS = {
  /** Still there, and their company has open roles. */
  hiringThere: 60,
  /** Their company has open roles; whether they're still there is unknown. */
  hiringUnknown: 30,
  moved: 70,
  stillThere: 40,
  /** Nothing new about them yet. */
  unknown: 10,
  placedRecently: 15,
  contactedRecently: 10,
} as const;
const PLACED_MONTHS = 24;
const CONTACTED_MONTHS = 12;
const CHUNK = 500;

/** The kinds that say where someone works now. */
export const WHERE_KINDS = ["still_there", "job_change", "left"] as const;
type WhereKind = (typeof WHERE_KINDS)[number];

/**
 * The one finding that says where this person works now: the surest reading,
 * the latest on a tie. Scores and briefs stand on the same one.
 */
export const whereFinding = (personId: SQL) =>
  sql`(select f.id from findings f where f.person_id = ${personId}
    and f.kind in ('still_there', 'job_change', 'left')
    order by f.confidence desc, f.observed_at desc, f.id desc limit 1)`;

/**
 * The company's open roles, while its last real check still says so and the
 * reading is under a month old.
 */
export const hiringFinding = (companyId: SQL) =>
  sql`(select h.id from company_checks k join findings h on h.id = k.finding_id
    where k.company_id = ${companyId} and h.observed_at > now() - interval '30 days')`;

/** Each person's latest CRM row names their firm; `crm lookup` reads the same. */
export const LATEST_CRM_ROW = sql`select distinct on (c.person_id) c.person_id, c.company_id
  from crm_contacts c order by c.person_id, c.id desc`;

export interface ScoreInput {
  firm: string;
  where: { id: number; kind: WhereKind; value: Record<string, unknown> } | null;
  hiring: { id: number; count: number } | null;
  /** YYYY-MM-DD and the CRM row that says so. */
  placed: { on: string; crmId: number } | null;
  contacted: { on: string; crmId: number } | null;
}

export interface Reason {
  reason: string;
  points: number;
  /** `f<id>` findings and `c<id>` CRM rows, the marks a brief cites. */
  cites: string[];
}

export interface Scored {
  score: number;
  /** Biggest first: the first one is the signal, in one line. */
  reasons: Reason[];
  nextStep: NextStep;
}

/** The same day `months` back, held to that month's last day (Feb 29 less 12 months is Feb 28). */
const monthsBefore = (today: Date, months: number): string => {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() - months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(today.getUTCDate(), last))).toISOString().slice(0, 10);
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2024-12-09" as "Dec 2024". */
const monthOf = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1] ?? "?"} ${day.slice(0, 4)}`;

const START = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? (\d{4})\b/;

/** The month a role began, from its dates as a profile shows them: "Sep 2025", or null. */
export function startedIn(dates: unknown): string | null {
  const m = text(dates)?.match(START);
  return m?.[1] && m[2] ? `${m[1]} ${m[2]}` : null;
}

/**
 * How long ago a role began, from its dates as a profile shows them ("Feb 2026
 * - Present (7 months)"): " 7 months ago", " this month", " 4 years ago".
 * Empty when the dates name no month and year.
 */
export function startedAgo(dates: unknown, today: Date): string {
  const m = text(dates)?.match(START);
  if (!m?.[1] || !m[2]) return "";
  const n =
    (today.getUTCFullYear() - Number(m[2])) * 12 + today.getUTCMonth() - MONTHS.indexOf(m[1]);
  if (n < 0) return "";
  if (n === 0) return " this month";
  if (n < 24) return ` ${n} month${n === 1 ? "" : "s"} ago`;
  return ` ${Math.floor(n / 12)} years ago`;
}

const roles = (n: number) => `${n} open role${n === 1 ? "" : "s"}`;

export function scoreContact(s: ScoreInput, today = new Date()): Scored {
  const reasons: Reason[] = [];
  const w = s.where;
  const f = (id: number) => `f${id}`;
  const to = w?.kind === "job_change" ? text(w.value.to) : null;
  // Gone, and nobody knows where: nothing to write to.
  if (w?.kind === "left" || (w?.kind === "job_change" && !to)) {
    const from = text(w.value.from) ?? s.firm;
    return {
      score: 0,
      reasons: [{ reason: `Left ${from}, new firm unknown`, points: 0, cites: [f(w.id)] }],
      nextStep: "none",
    };
  }
  let signal = false;
  if (w?.kind === "job_change") {
    const title = text(w.value.title);
    reasons.push({
      reason: `Moved to ${to}${startedAgo(w.value.dates, today)}${title ? `, now ${title}` : ""}`,
      points: POINTS.moved,
      cites: [f(w.id)],
    });
    signal = true;
  } else {
    const there = w?.kind === "still_there";
    const quiet = s.hiring ? "" : ", nothing new";
    reasons.push(
      there
        ? { reason: `Still at ${s.firm}${quiet}`, points: POINTS.stillThere, cites: [f(w.id)] }
        : { reason: `Not found yet${quiet}`, points: POINTS.unknown, cites: [] },
    );
    if (s.hiring) {
      reasons.push({
        reason: `${s.firm} has ${roles(s.hiring.count)}`,
        points: there ? POINTS.hiringThere : POINTS.hiringUnknown,
        cites: [f(s.hiring.id)],
      });
      signal = true;
    }
  }
  if (s.placed && s.placed.on >= monthsBefore(today, PLACED_MONTHS))
    reasons.push({
      reason: `Last placement ${monthOf(s.placed.on)}`,
      points: POINTS.placedRecently,
      cites: [`c${s.placed.crmId}`],
    });
  if (s.contacted && s.contacted.on >= monthsBefore(today, CONTACTED_MONTHS))
    reasons.push({
      reason: `Last contacted ${monthOf(s.contacted.on)}`,
      points: POINTS.contactedRecently,
      cites: [`c${s.contacted.crmId}`],
    });
  reasons.sort((a, b) => b.points - a.points);
  return {
    score: reasons.reduce((n, r) => n + r.points, 0),
    reasons,
    nextStep: signal ? "reach_out" : "keep_warm",
  };
}

export interface CrmScoreStats {
  /** Everyone is rescored each time. */
  selected: number;
  hiringThere: number;
  moved: number;
  stillThere: number;
  unknown: number;
  left: number;
  /** No signal: no draft, kept warm. */
  keepWarm: number;
  aborted: string | null;
}

interface Row extends Record<string, unknown> {
  person_id: number;
  firm: string;
  where_id: number | null;
  where_kind: WhereKind | null;
  where_value: Record<string, unknown> | null;
  hiring_id: number | null;
  hiring_count: number | null;
  placed_on: string | null;
  placed_row: number | null;
  contacted_on: string | null;
  contacted_row: number | null;
}

export async function loadScoreInputs(
  db: Queryable,
): Promise<{ personId: number; input: ScoreInput }[]> {
  const rows = await db.execute<Row>(sql`
    with latest as (${LATEST_CRM_ROW}),
    crm as (
      select person_id,
        max(last_placement_on)::text placed_on,
        (array_agg(id order by last_placement_on desc nulls last, id desc))[1] placed_row,
        max(last_contacted_on)::text contacted_on,
        (array_agg(id order by last_contacted_on desc nulls last, id desc))[1] contacted_row
      from crm_contacts group by person_id
    ),
    picked as (
      select l.person_id, coalesce(co.name, co.domain, 'their firm') firm,
        ${whereFinding(sql`l.person_id`)} where_id,
        ${hiringFinding(sql`l.company_id`)} hiring_id
      from latest l join companies co on co.id = l.company_id
    )
    select p.person_id, p.firm, p.where_id, w.kind where_kind, w.value where_value,
      p.hiring_id, (h.value->>'count')::int hiring_count,
      crm.placed_on, crm.placed_row, crm.contacted_on, crm.contacted_row
    from picked p
    join crm on crm.person_id = p.person_id
    left join findings w on w.id = p.where_id
    left join findings h on h.id = p.hiring_id
    order by p.person_id`);
  return rows.map((r) => ({
    personId: r.person_id,
    input: {
      firm: r.firm,
      where:
        r.where_id !== null && r.where_kind
          ? { id: r.where_id, kind: r.where_kind, value: r.where_value ?? {} }
          : null,
      hiring: r.hiring_id !== null ? { id: r.hiring_id, count: r.hiring_count ?? 0 } : null,
      placed:
        r.placed_on && r.placed_row !== null ? { on: r.placed_on, crmId: r.placed_row } : null,
      contacted:
        r.contacted_on && r.contacted_row !== null
          ? { on: r.contacted_on, crmId: r.contacted_row }
          : null,
    },
  }));
}

/** Rescore every CRM person. Cheap: one read, bulk writes. */
export async function scoreCrmContacts(db: Queryable, today = new Date()): Promise<CrmScoreStats> {
  const inputs = await loadScoreInputs(db);
  const stats: CrmScoreStats = {
    selected: inputs.length,
    hiringThere: 0,
    moved: 0,
    stillThere: 0,
    unknown: 0,
    left: 0,
    keepWarm: 0,
    aborted: null,
  };
  const rows = inputs.map(({ personId, input }) => {
    const s = scoreContact(input, today);
    const kind = input.where?.kind;
    if (s.nextStep === "none") stats.left += 1;
    else if (kind === "job_change") stats.moved += 1;
    else if (kind === "still_there") stats[input.hiring ? "hiringThere" : "stillThere"] += 1;
    else stats.unknown += 1;
    if (s.nextStep === "keep_warm") stats.keepWarm += 1;
    return { personId, score: s.score, reasons: s.reasons, nextStep: s.nextStep };
  });
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(contactScores)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: contactScores.personId,
        set: {
          score: sql`excluded.score`,
          reasons: sql`excluded.reasons`,
          nextStep: sql`excluded.next_step`,
          computedAt: sql`now()`,
        },
      });
  }
  return stats;
}

/**
 * Scores are due when someone has none (or one from before `next_step`), when
 * anything they stand on changed since, or once a day (recency windows move
 * with the calendar).
 */
export async function scoreDue(db: Queryable): Promise<number> {
  const [r] = await db.execute<{ people: number; unscored: number; stale: boolean }>(sql`
    with crm as (select distinct person_id from crm_contacts),
    scored as (
      select min(s.computed_at) at from contact_scores s join crm on crm.person_id = s.person_id
    )
    select (select count(*) from crm)::int people,
      (select count(*) from crm where not exists (select 1 from contact_scores s
        where s.person_id = crm.person_id and s.next_step is not null))::int unscored,
      coalesce((select at from scored) < greatest(
        (select max(observed_at) from findings),
        (select max(checked_at) from company_checks),
        (select max(updated_at) from crm_contacts),
        now() - interval '1 day'), false) stale`);
  if (!r) return 0;
  return r.unscored > 0 || r.stale ? r.people : 0;
}
