/**
 * Trace (wren designs/2026-11-27-central-queue.md, phase 3): a run with its moves (`rt.events`),
 * its durable steps (`rt.journal`) and the calls it made; or a job's last runs.
 * Job names: a schedule (`capture`: CommandRun rows keyed by it), `Service/key` (a loop key) or
 * `Service` (every key).
 */
import type postgres from "postgres";

export interface TraceEvent {
  seq: number;
  status: string;
  attempt: number;
  failures: number;
  failure: unknown;
  lease_until: Date | null;
  build: string | null;
  at: Date;
}

export interface TraceStep {
  seq: number;
  kind: string;
  name: string;
  done: boolean;
  tries: number;
  error: unknown;
  wake_at: Date | null;
  ref: string | null;
  at: Date;
}

export interface TraceRun {
  id: string;
  service: string;
  handler: string;
  key: string | null;
  status: string;
  attempt: number;
  failures: number;
  error: unknown;
  last_failure: unknown;
  build: string | null;
  parent_id: string | null;
  idem_key: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface RunTrace {
  run: TraceRun;
  events: TraceEvent[];
  steps: TraceStep[];
  /** Calls this run made (`parent_id`), newest last. */
  calls: TraceRun[];
}

const RUN_COLS = `id, service, handler, key, status, attempt, failures, error, last_failure, build,
  parent_id, idem_key, created_at, started_at, completed_at`;

export const isRunId = (s: string) => /^inv_[a-z0-9]+$/.test(s);

export async function traceRun(sql: postgres.Sql, id: string): Promise<RunTrace | null> {
  const [run] = await sql.unsafe<TraceRun[]>(
    `SELECT ${RUN_COLS} FROM rt.invocations WHERE id = $1`,
    [id],
  );
  if (!run) return null;
  const [events, steps, calls] = await Promise.all([
    sql<TraceEvent[]>`SELECT seq::int, status, attempt, failures, failure, lease_until, build, at
      FROM rt.events WHERE invocation_id = ${id} ORDER BY seq`,
    sql<TraceStep[]>`SELECT seq, kind, name, done, tries, error, wake_at, ref, at
      FROM rt.journal WHERE invocation_id = ${id} ORDER BY seq`,
    sql.unsafe<TraceRun[]>(
      `SELECT ${RUN_COLS} FROM rt.invocations WHERE parent_id = $1 ORDER BY created_at`,
      [id],
    ),
  ]);
  return { run, events, steps, calls };
}

/** Which rows a job name covers: a schedule's, a loop key's or a service's. */
export async function jobRuns(sql: postgres.Sql, job: string, limit = 10): Promise<TraceRun[]> {
  const [schedule] = await sql<{ service: string }[]>`
    SELECT service FROM rt.schedules WHERE name = ${job}`;
  const slash = job.indexOf("/");
  const [service, key] = schedule
    ? [schedule.service, job]
    : slash > 0
      ? [job.slice(0, slash), job.slice(slash + 1)]
      : [job, null];
  return key === null
    ? sql.unsafe<TraceRun[]>(
        `SELECT ${RUN_COLS} FROM rt.invocations WHERE service = $1 ORDER BY created_at DESC LIMIT $2`,
        [service, limit],
      )
    : sql.unsafe<TraceRun[]>(
        `SELECT ${RUN_COLS} FROM rt.invocations WHERE service = $1 AND key = $2
         ORDER BY created_at DESC LIMIT $3`,
        [service, key, limit],
      );
}
