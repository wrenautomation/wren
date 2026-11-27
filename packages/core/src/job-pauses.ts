/**
 * A person's pause on a job (designs/2026-11-27-central-queue.md, `wren jobs`): one open row in
 * `job_pauses` per job. A loop (`<Service>/<key>`, or `<Service>` = every key) reads it each pass
 * (`setLoopHoldReader`); a launchd job (`launchd:<label>`) is disabled by the CLI on the Mac; a
 * pulled call (desk, studio, claude, calls) is ended at the door's claim (`callPauseJobs`).
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

export type JobPauseRow = {
  id: number;
  job: string;
  why: string;
  held_by: string;
  held_at: string;
  /** `infinity` until resumed. */
  until: string;
};

/** The open pause on this loop key, or on its whole service; null = run. */
export async function readLoopHold(
  db: Queryable,
  service: string,
  key: string,
): Promise<{ why: string; by: string; until: string } | null> {
  const [row] = await db.execute<{ why: string; by: string; until: string }>(sql`
    select why, held_by "by", until::text from job_pauses
    where released_at is null and until > now() and job in (${service}, ${`${service}/${key}`})
    order by until desc limit 1`);
  return row ?? null;
}

/** Open a pause, or replace the open one's why and end. */
export async function pauseJob(
  db: Queryable,
  p: { job: string; why: string; by: string; forMs?: number | undefined },
): Promise<JobPauseRow> {
  const until = p.forMs
    ? sql`now() + ${`${Math.round(p.forMs / 1000)} seconds`}::interval`
    : sql`'infinity'::timestamptz`;
  const [row] = await db.execute<JobPauseRow>(sql`
    insert into job_pauses (job, why, held_by, until)
    values (${p.job}, ${p.why}, ${p.by}, ${until})
    on conflict (job) where released_at is null do update set
      why = excluded.why, held_by = excluded.held_by, until = excluded.until
    returning id, job, why, held_by, held_at::text, until::text`);
  return row as JobPauseRow;
}

/** End the open pause on a job; [] when none was open. */
export async function resumeJob(db: Queryable, job: string, by: string): Promise<JobPauseRow[]> {
  return db.execute<JobPauseRow>(sql`
    update job_pauses set released_at = now(), released_by = ${by}
    where job = ${job} and released_at is null
    returning id, job, why, held_by, held_at::text, until::text`);
}

/** Every open pause still in force. */
export async function openPauses(db: Queryable): Promise<JobPauseRow[]> {
  return db.execute<JobPauseRow>(sql`
    select id, job, why, held_by, held_at::text, until::text from job_pauses
    where released_at is null and until > now() order by held_at`);
}

/**
 * The job names a pause on one pulled call may sit under: `desk`, `desk/call`, `desk:linkedin`,
 * `desk:linkedin/linkedin@wren`, `caller:wren:own-check`, a schedule's `capture`. Input is the
 * call's JSON body.
 */
export function callPauseJobs(service: string, handler: string, input: Uint8Array): string[] {
  const jobs = [service, `${service}/${handler}`];
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(input).toString("utf8"));
  } catch {
    return jobs;
  }
  if (!body || typeof body !== "object") return jobs;
  const b = body as Record<string, unknown>;
  if (typeof b.site === "string" && b.site) {
    jobs.push(`${service}:${b.site}`);
    if (typeof b.account === "string" && b.account) jobs.push(`${service}:${b.site}/${b.account}`);
  }
  if (typeof b.caller === "string" && b.caller) jobs.push(`caller:${b.caller}`);
  // a schedule's run (`CommandRun`): its job's own name, so a queued run stops with its schedule
  if (typeof b.job === "string" && b.job) jobs.push(b.job);
  return jobs;
}

/** `2h`, `30m`, `1d` → ms. */
export function durationMs(text: string): number {
  const m = /^(\d+)\s*(m|h|d)$/.exec(text.trim());
  if (!m) throw new Error(`--for takes 30m, 2h or 1d, not "${text}"`);
  return Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as "m" | "h" | "d"];
}
