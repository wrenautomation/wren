/**
 * Checks on a stage's units (designs/2026-10-05-checks.md). Restate retries a step that throws;
 * a step that returns a wrong answer counts as done, so the checks are ours:
 *
 * - `after` says why a source's answer is wrong; the stage's ladder tries its next source.
 * - A unit out of retries, or whose sources disagree, is held: 7 days, then tried once more,
 *   then held until a person releases it. Selection skips a held subject (`isHeld`).
 * - Every outcome is counted per stage and source. Under 70% passes over the last 50 pauses
 *   that source on that stage (a `source:<name>` hold) until a person releases it.
 */
import type { Queryable } from "@wren/db";
import { type SQL, sql } from "drizzle-orm";

export interface Check<In, Out> {
  name: string;
  /** Why not to spend on this input; null = go. */
  before?(input: In): string | null;
  /** Why this answer is wrong; null = keep. */
  after(input: In, out: Out): string | null;
}

export const HOLD_DAYS = 7;
/** Outcomes a source is judged on, and the pass rate under which it pauses. */
export const PAUSE_WINDOW = 50;
export const PAUSE_UNDER = 0.7;
/** `released_by` when a later read settled the hold, not a person. */
export const SETTLED = "checks";

const active = (stage: string, subject: SQL) =>
  sql`select 1 from unit_holds h where h.stage = ${stage} and h.subject = ${subject}
    and h.released_at is null`;

/** Held now: selection skips it. */
export const isHeld = (stage: string, subject: SQL) =>
  sql`exists (${active(stage, subject)} and h.until > now())`;

/** Its hold ran out and its one retry is due. */
export const retryDue = (stage: string, subject: SQL) =>
  sql`exists (${active(stage, subject)} and h.until <= now())`;

/**
 * Hold a unit. A new hold, or one released before, lasts `HOLD_DAYS`. `spent`: the unit just
 * used its retry, so a hold that ran out stays until a person releases it.
 */
export async function hold(
  db: Queryable,
  h: { stage: string; subject: string; reason: string; spent?: boolean; forever?: boolean },
): Promise<void> {
  const until = h.forever
    ? sql`'infinity'::timestamptz`
    : sql`now() + ${`${HOLD_DAYS} days`}::interval`;
  const escalate = sql`(${h.spent ?? false} and unit_holds.released_at is null
    and unit_holds.until <= now())`;
  const reopen = sql`unit_holds.released_at is not null`;
  await db.execute(sql`
    insert into unit_holds (stage, subject, reason, until)
    values (${h.stage}, ${h.subject.slice(0, 200)}, ${h.reason}, ${until})
    on conflict (stage, subject) do update set
      reason = excluded.reason,
      held_at = case when ${reopen} then now() else unit_holds.held_at end,
      tries = case when ${reopen} then 1 when ${escalate} then unit_holds.tries + 1
        else unit_holds.tries end,
      until = case when ${reopen} then excluded.until when ${escalate} then 'infinity'::timestamptz
        else unit_holds.until end,
      released_at = null, released_by = null`);
}

/** Its retry worked, or a later read agreed: these subjects' holds end. */
export async function settle(
  db: Queryable,
  stage: string,
  subjects: readonly string[],
): Promise<number> {
  if (subjects.length === 0) return 0;
  const rows = await db.execute(sql`
    update unit_holds set released_at = now(), released_by = ${SETTLED}
    where stage = ${stage} and released_at is null
      and subject in (${sql.join(
        subjects.map((s) => sql`${s}`),
        sql`, `,
      )})
    returning id`);
  return rows.length;
}

/** A person lets these go: the units run again, a paused source resumes. */
export async function release(db: Queryable, ids: readonly number[], by: string) {
  if (ids.length === 0) return [];
  return db.execute<{ id: number }>(sql`
    update unit_holds set released_at = now(), released_by = ${by}
    where released_at is null and id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
    returning id`);
}

/** A stage's units on hold: `held` are skipped, `due` get their one retry now. Sources aside. */
export async function holdsOn(
  db: Queryable,
  stage: string,
): Promise<{ held: string[]; due: string[] }> {
  const rows = await db.execute<{ subject: string; held: boolean }>(sql`
    select subject, until > now() held from unit_holds
    where stage = ${stage} and released_at is null and subject not like 'source:%'`);
  return {
    held: rows.filter((r) => r.held).map((r) => r.subject),
    due: rows.filter((r) => !r.held).map((r) => r.subject),
  };
}

const sourceSubject = (source: string) => `source:${source}`;

/**
 * Count one outcome. When `pauses` and the source's last `PAUSE_WINDOW` outcomes since it was
 * last released pass under `PAUSE_UNDER`, the source pauses on the stage; returns whether it did.
 */
export async function counted(
  db: Queryable,
  o: {
    stage: string;
    source: string;
    check: string;
    ok: boolean;
    subject?: string | null;
    reason?: string | null;
    pauses?: boolean;
  },
): Promise<boolean> {
  await db.execute(sql`
    insert into check_outcomes (stage, source, "check", subject, ok, reason)
    values (${o.stage}, ${o.source}, ${o.check}, ${o.subject?.slice(0, 200) ?? null},
      ${o.ok}, ${o.reason ?? null})`);
  if (o.ok || o.pauses === false) return false;
  const [w] = await db.execute<{ n: number; passed: number }>(sql`
    with since as (
      select coalesce(max(released_at), '-infinity'::timestamptz) at from unit_holds
      where stage = ${o.stage} and subject = ${sourceSubject(o.source)}),
    last as (
      select o.ok from check_outcomes o, since
      where o.stage = ${o.stage} and o.source = ${o.source} and o.at > since.at
      order by o.id desc limit ${PAUSE_WINDOW})
    select count(*)::int n, count(*) filter (where ok)::int passed from last`);
  if (!w || w.n < PAUSE_WINDOW || w.passed / w.n >= PAUSE_UNDER) return false;
  await hold(db, {
    stage: o.stage,
    subject: sourceSubject(o.source),
    reason: `${w.passed} of the last ${w.n} passed "${o.check}"`,
    forever: true,
  });
  return true;
}

/** The sources paused on a stage. */
export async function pausedSources(db: Queryable, stage: string): Promise<Set<string>> {
  const rows = await db.execute<{ subject: string }>(sql`
    select subject from unit_holds
    where stage = ${stage} and subject like 'source:%' and released_at is null`);
  return new Set(rows.map((r) => r.subject.slice("source:".length)));
}
