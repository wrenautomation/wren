/**
 * The client's say on drafts (R11): approve some, or don't send some. One unit
 * is an enrollment, the opener and its follow-up together. The portal and
 * `crm approve` both land here; a second click finds nothing left to do.
 */
import type { ApprovalSource } from "@wren/channel-email";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { REACTIVATION } from "./compose.js";

export interface ReviewResult {
  /** Enrollments this call changed. */
  done: number[];
  /** Asked for but not waiting on a decision: already decided, stopped, or not ours. */
  skipped: number[];
}

/** Which drafts: these enrollments, or every one waiting. */
export type DraftSelector = { enrollmentIds: readonly number[] } | { all: true };

const idsOf = (s: DraftSelector): number[] | null =>
  "all" in s ? null : [...new Set(s.enrollmentIds)].filter((n) => Number.isSafeInteger(n));

const list = (ids: number[]) =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

/** Active reactivation enrollments with a draft, among the chosen. */
const waiting = (ids: number[] | null) => sql`
  SELECT DISTINCT e.id FROM enrollments e JOIN messages m ON m.enrollment_id = e.id
  WHERE e.niche = ${REACTIVATION} AND e.state = 'active' AND m.state = 'draft'
    ${ids === null ? sql`` : sql`AND e.id IN (${list(ids)})`}`;

const result = (ids: number[] | null, done: number[]): ReviewResult => ({
  done,
  skipped: ids === null ? [] : ids.filter((id) => !done.includes(id)),
});

/** Approve every draft step of the chosen enrollments; the send loop takes it from there. */
export async function approveDrafts(
  db: Queryable,
  selector: DraftSelector,
  by: Extract<ApprovalSource, "client" | "operator">,
  now: Date = new Date(),
): Promise<ReviewResult> {
  const ids = idsOf(selector);
  if (ids?.length === 0) return result(ids, []);
  const rows = await db.execute<{ enrollment_id: number }>(sql`
    UPDATE messages SET state = 'approved', approved_at = ${now.toISOString()}::timestamptz, approved_by = ${by}
    WHERE state = 'draft' AND enrollment_id IN (${waiting(ids)})
    RETURNING enrollment_id`);
  return result(
    ids,
    [...new Set(rows.map((r) => Number(r.enrollment_id)))].sort((a, b) => a - b),
  );
}

/**
 * Don't send these: the drafts are rejected and the enrollment stops, so the
 * composer never writes to that person again.
 */
export async function skipDrafts(
  db: Queryable,
  selector: DraftSelector,
  by: Extract<ApprovalSource, "client" | "operator">,
  now: Date = new Date(),
): Promise<ReviewResult> {
  const ids = idsOf(selector);
  if (ids?.length === 0) return result(ids, []);
  return db.transaction(async (tx) => {
    const stopped = await tx.execute<{ id: number }>(sql`
      UPDATE enrollments SET state = 'stopped', stop_reason = 'manual', stopped_at = ${now.toISOString()}::timestamptz
      WHERE id IN (${waiting(ids)})
      RETURNING id`);
    const done = stopped.map((r) => Number(r.id)).sort((a, b) => a - b);
    if (done.length)
      await tx.execute(sql`
        UPDATE messages SET state = 'rejected', review_reason = 'other',
          detail = ${`not sent: the ${by} chose to skip it`}
        WHERE state IN ('draft', 'approved') AND enrollment_id IN (${list(done)})`);
    return result(ids, done);
  });
}

/**
 * Undo an approve: approved steps go back to drafts while nothing of the email has started
 * sending. Locks the steps first, so a send that took one already wins and this does nothing.
 */
export async function unapproveDrafts(
  db: Queryable,
  ids: readonly number[],
): Promise<ReviewResult> {
  const asked = idsOf({ enrollmentIds: ids }) ?? [];
  if (!asked.length) return result(asked, []);
  return db.transaction(async (tx) => {
    const steps = await tx.execute<{ enrollment_id: number; state: string }>(sql`
      SELECT m.enrollment_id, m.state FROM messages m JOIN enrollments e ON e.id = m.enrollment_id
      WHERE e.niche = ${REACTIVATION} AND e.state = 'active' AND e.id IN (${list(asked)})
      FOR UPDATE OF m`);
    const of = new Map<number, { state: string }[]>();
    for (const s of steps)
      of.set(Number(s.enrollment_id), [...(of.get(Number(s.enrollment_id)) ?? []), s]);
    const done = [...of]
      .filter(
        ([, ss]) =>
          ss.every((s) => s.state === "draft" || s.state === "approved") &&
          ss.some((s) => s.state === "approved"),
      )
      .map(([id]) => id)
      .sort((a, b) => a - b);
    if (done.length)
      await tx.execute(sql`
        UPDATE messages SET state = 'draft', approved_at = NULL, approved_by = NULL
        WHERE state = 'approved' AND enrollment_id IN (${list(done)})`);
    return result(asked, done);
  });
}
