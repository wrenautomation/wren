/**
 * When a company may get another cold sequence (designs/2026-09-30-lead-recycling.md).
 *
 * Every enrollment ends in one outcome (`contact_outcomes.outcome`). A resting outcome
 * lets the company come back after its rest; the rest are never or held. A returning
 * company also needs a sequence+offer it has not had, and stays under the yearly cap.
 * Compose, the pool-feeder's re-check and `wren email status` all read `audienceGate`,
 * so the rule lives here once.
 */
import type { Queryable } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";

/** Outcomes after which a company may come back, once rested. */
export const RESTING_OUTCOMES = [
  "no_reply",
  "not_now",
  "not_interested",
  "wrong_person",
  "referral",
  "bounced",
] as const;
export type RestingOutcome = (typeof RESTING_OUTCOMES)[number];

/** Outcomes that keep the company out of cold email: for good, or until someone acts. */
export const BLOCKING_OUTCOMES = [
  "active",
  "opted_out",
  "warm",
  "stopped_by_hand",
  "needs_a_look",
] as const;

export type ContactOutcome = RestingOutcome | (typeof BLOCKING_OUTCOMES)[number];

/** An address with one of these outcomes is never written to again, even if its company returns. */
export const DONE_ADDRESS_OUTCOMES = ["wrong_person", "referral", "bounced", "opted_out"] as const;

export interface RecontactPolicy {
  /** Days a company rests after each outcome before its next cold sequence; null = never. */
  readonly restDays: Readonly<Record<RestingOutcome, number | null>>;
  /** Cold sequences one company may get in any 365 days, the first included. */
  readonly perYear: number;
}

export const DEFAULT_RECONTACT: RecontactPolicy = {
  restDays: {
    no_reply: 90,
    not_now: 90,
    not_interested: 180,
    wrong_person: 0,
    referral: 0,
    bounced: 30,
  },
  perYear: 2,
};

/** A niche's overrides, as its spec writes them. */
export interface RecontactOverrides {
  readonly restDays?: Partial<Record<RestingOutcome, number | null>>;
  readonly perYear?: number;
}

/** Overrides over the defaults, checked: whole non-negative days, a cap of at least 1. */
export function recontactPolicy(
  overrides: RecontactOverrides = {},
  where = "recontact",
): RecontactPolicy {
  const restDays = { ...DEFAULT_RECONTACT.restDays };
  for (const [outcome, days] of Object.entries(overrides.restDays ?? {})) {
    if (!(RESTING_OUTCOMES as readonly string[]).includes(outcome))
      throw new Error(
        `${where}: '${outcome}' is not a resting outcome (${RESTING_OUTCOMES.join(", ")})`,
      );
    if (days === undefined) continue;
    if (days !== null && !(Number.isInteger(days) && days >= 0))
      throw new Error(
        `${where}: rest for '${outcome}' must be whole days ≥ 0 or null, got ${days}`,
      );
    restDays[outcome as RestingOutcome] = days;
  }
  const perYear = overrides.perYear ?? DEFAULT_RECONTACT.perYear;
  if (!(Number.isInteger(perYear) && perYear >= 1))
    throw new Error(`${where}: perYear must be a whole number ≥ 1, got ${perYear}`);
  return { restDays, perYear };
}

/** Who a compose pass writes to: companies never enrolled, or companies coming back. */
export type Audience = "first_contact" | "returning";
export const AUDIENCES: readonly Audience[] = ["first_contact", "returning"];

const list = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/**
 * True for an enrollment that still keeps its company out: a blocking outcome, an
 * outcome the policy never rests, or one still resting. `co` is a contact_outcomes row.
 */
function stillBlocks(policy: RecontactPolicy): SQL {
  const rests = RESTING_OUTCOMES.filter((o) => policy.restDays[o] !== null);
  if (rests.length === 0) return sql`true`;
  const days = sql.join(
    rests.map((o) => sql`WHEN ${o} THEN ${policy.restDays[o]}::int`),
    sql` `,
  );
  return sql`(co.outcome NOT IN (${list(rests)})
    OR co.last_touch_at > now() - make_interval(days => CASE co.outcome ${days} END))`;
}

/** What a returning company must not have had already. */
export interface Pitch {
  readonly sequence: string;
  readonly offer: string;
}

/**
 * The SQL condition `company` (a company id expression) passes for `audience`. A
 * returning company needs `pitch` new to it; the audit views pass none and ask only
 * whether the company may come back at all.
 */
export function audienceGate(
  company: SQL,
  audience: Audience,
  policy: RecontactPolicy,
  pitch: Pitch | null = null,
): SQL {
  if (audience === "first_contact")
    return sql`NOT EXISTS (SELECT 1 FROM enrollments x WHERE x.company_id = ${company})`;
  return sql`(EXISTS (SELECT 1 FROM enrollments x WHERE x.company_id = ${company})
    AND NOT EXISTS (SELECT 1 FROM contact_outcomes co WHERE co.company_id = ${company} AND ${stillBlocks(policy)})
    AND (SELECT count(*) FROM enrollments x
         WHERE x.company_id = ${company} AND x.created_at > now() - interval '365 days') < ${policy.perYear}
    ${
      pitch === null
        ? sql``
        : sql`AND NOT EXISTS (SELECT 1 FROM enrollments x WHERE x.company_id = ${company}
                AND x.sequence_name = ${pitch.sequence} AND x.offer = ${pitch.offer})`
    })`;
}

/** Every address whose enrollment ended in a done outcome, lowercased: read once per compose run. */
export async function doneAddresses(db: Queryable): Promise<Set<string>> {
  const rows = (await db.execute(
    sql`SELECT DISTINCT lower(to_email) AS email FROM contact_outcomes WHERE outcome IN (${list(DONE_ADDRESS_OUTCOMES)})`,
  )) as unknown as { email: string }[];
  return new Set(rows.map((r) => r.email));
}
