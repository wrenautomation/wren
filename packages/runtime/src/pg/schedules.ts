/**
 * Schedules make runs (wren designs/2026-11-27-central-queue.md, phase 2). Each `rt.schedules`
 * row is a cron in a time zone; a pass inserts one `rt.invocations` row per due tick.
 * - key = the schedule's name, idem_key = the tick: one tick is one run, on any number of nodes
 * - a run of the schedule still open (pending, running, suspended): the tick is skipped, not
 *   stacked, so a Mac asleep for a week wakes to one run
 * - held (a person's pause, `held`): the tick is skipped
 * - a new schedule starts at the next tick, never a past one
 * One pass at a time on all nodes: a transaction-level advisory lock (holds behind PgBouncer too).
 */
import { Cron } from "croner";
import type postgres from "postgres";
import { newInvocationId } from "./ids.js";
import { submit } from "./store.js";

export interface Schedule {
  name: string;
  cron: string;
  tz: string;
  service: string;
  handler: string;
  input: Record<string, unknown>;
  why: string;
}

export type TickOutcome = "run" | "open" | "held";

/** The latest tick in (after, now]; null when none is due. */
export function dueTick(cron: string, tz: string, after: Date, now: Date): Date | null {
  const c = new Cron(cron, { timezone: tz, paused: true });
  let due: Date | null = null;
  // bounded: far behind, the next pass walks on from this tick (an open run skips the rest)
  for (let i = 0, at = after; i < 10_000; i++) {
    const next = c.nextRun(at);
    if (!next || next > now) return due;
    due = next;
    at = next;
  }
  return due;
}

/** Add or change a schedule. A changed cron starts at its next tick. Throws on a bad cron or zone. */
export async function putSchedule(sql: postgres.Sql, s: Schedule): Promise<void> {
  new Cron(s.cron, { timezone: s.tz, paused: true }).nextRun();
  await sql`
    INSERT INTO rt.schedules (name, cron, tz, service, handler, input, why, last_tick)
    VALUES (${s.name}, ${s.cron}, ${s.tz}, ${s.service}, ${s.handler}, ${sql.json(s.input as postgres.JSONValue)}, ${s.why}, now())
    ON CONFLICT (name) DO UPDATE SET cron = excluded.cron, tz = excluded.tz, service = excluded.service,
      handler = excluded.handler, input = excluded.input, why = excluded.why,
      last_tick = CASE WHEN rt.schedules.cron <> excluded.cron OR rt.schedules.tz <> excluded.tz
        THEN now() ELSE rt.schedules.last_tick END`;
}

export async function dropSchedule(sql: postgres.Sql, name: string): Promise<boolean> {
  return (await sql`DELETE FROM rt.schedules WHERE name = ${name}`).count > 0;
}

export interface ScheduleView extends Schedule {
  last_tick: Date | null;
  last_outcome: string | null;
  next_tick: Date | null;
  /** The newest run: its id, status, when it ended, its error. */
  last_run: { id: string; status: string; at: Date; error: string | null } | null;
}

export async function listSchedules(sql: postgres.Sql): Promise<ScheduleView[]> {
  const rows = await sql<
    (Schedule & {
      last_tick: Date | null;
      last_outcome: string | null;
      run_id: string | null;
      run_status: string | null;
      run_at: Date | null;
      run_error: string | null;
    })[]
  >`
    SELECT s.name, s.cron, s.tz, s.service, s.handler, s.input, s.why, s.last_tick, s.last_outcome,
      r.id AS run_id, r.status AS run_status, coalesce(r.completed_at, r.created_at) AS run_at,
      coalesce(r.error, r.last_failure) ->> 'message' AS run_error
    FROM rt.schedules s
    LEFT JOIN LATERAL (
      SELECT id, status, completed_at, created_at, error, last_failure FROM rt.invocations i
      WHERE i.service = s.service AND i.key = s.name ORDER BY created_at DESC LIMIT 1) r ON true
    ORDER BY s.name`;
  return rows.map(({ run_id, run_status, run_at, run_error, ...r }) => ({
    ...r,
    next_tick: new Cron(r.cron, { timezone: r.tz, paused: true }).nextRun(),
    last_run:
      run_id && run_status && run_at
        ? { id: run_id, status: run_status, at: run_at, error: run_error }
        : null,
  }));
}

/** A run of the schedule now, outside its ticks (`wren jobs run`). Queued behind an open run. */
export async function runScheduleNow(sql: postgres.Sql, name: string): Promise<string> {
  const [r] = await sql<Schedule[]>`
    SELECT name, service, handler, input FROM rt.schedules WHERE name = ${name}`;
  if (!r) throw new Error(`no schedule ${name}`);
  const at = new Date();
  const made = await submit(sql, {
    id: newInvocationId(),
    service: r.service,
    handler: r.handler,
    key: r.name,
    input: Buffer.from(
      JSON.stringify({ ...r.input, job: r.name, tick: `now:${at.toISOString()}` }),
    ),
    headers: { "x-schedule": r.name },
    idemKey: `now:${at.toISOString()}`,
    runAt: at,
  });
  return made.id;
}

/**
 * One pass over every schedule. `held`: a person's pause on this schedule, its why or null.
 * Returns each due tick and what became of it; [] when another node holds the pass.
 */
export async function schedulePass(
  sql: postgres.Sql,
  o: { now?: Date; held?: (s: Schedule) => Promise<string | null> } = {},
): Promise<{ name: string; tick: Date; outcome: TickOutcome; id?: string }[]> {
  const now = o.now ?? new Date();
  return sql.begin(async (tx) => {
    const [lock] = await tx<{ ok: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext('rt.schedules')) AS ok`;
    if (!lock?.ok) return [];
    const rows = await tx<(Schedule & { last_tick: Date | null })[]>`
      SELECT name, cron, tz, service, handler, input, why, last_tick FROM rt.schedules`;
    const out: { name: string; tick: Date; outcome: TickOutcome; id?: string }[] = [];
    for (const r of rows) {
      let tick: Date | null;
      try {
        tick = dueTick(r.cron, r.tz, r.last_tick ?? now, now);
      } catch {
        continue; // putSchedule checks the cron; a row written by hand may be bad
      }
      if (!tick) continue;
      let outcome: TickOutcome;
      let id: string | undefined;
      const [open] = await tx`
        SELECT 1 FROM rt.invocations WHERE service = ${r.service} AND key = ${r.name}
          AND status IN ('pending', 'running', 'suspended') LIMIT 1`;
      if (await o.held?.(r)) outcome = "held";
      else if (open) outcome = "open";
      else {
        const made = await submit(tx as unknown as postgres.Sql, {
          id: newInvocationId(),
          service: r.service,
          handler: r.handler,
          key: r.name,
          input: Buffer.from(JSON.stringify({ ...r.input, job: r.name, tick: tick.toISOString() })),
          headers: { "x-schedule": r.name },
          idemKey: tick.toISOString(),
          runAt: now,
        });
        outcome = "run";
        id = made.id;
      }
      await tx`UPDATE rt.schedules SET last_tick = ${tick}, last_outcome = ${outcome} WHERE name = ${r.name}`;
      out.push({ name: r.name, tick, outcome, ...(id ? { id } : {}) });
    }
    return out;
  });
}
