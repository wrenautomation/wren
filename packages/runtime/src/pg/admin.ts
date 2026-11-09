/**
 * Restate's admin API over schema `rt` (designs/2026-11-09-own-runtime.md, "Phase 3"): the same SQL
 * runs on the `rt_admin` views; resume and kill act on rt rows.
 */
import type postgres from "postgres";

/** Undefined table, column or function: a query that only Restate's schema answers. */
const NOT_HERE = new Set(["42P01", "42703", "42883"]);

/** Restate admin SQL against the rt views. A query the views can't answer gives no rows. */
export const rtAdmin =
  (sql: postgres.Sql) =>
  async (query: string): Promise<Record<string, unknown>[]> => {
    try {
      return await sql.begin(async (tx) => {
        await tx`SET LOCAL search_path = rt_admin`;
        await tx`SET LOCAL statement_timeout = 30000`;
        return [...(await tx.unsafe(query))] as Record<string, unknown>[];
      });
    } catch (e) {
      if (NOT_HERE.has((e as { code?: string }).code ?? "")) return [];
      throw e;
    }
  };

const PATH = /^\/invocations\/([^/?]+)\/(resume|kill|cancel)\b/;

/**
 * Restate's `PATCH /invocations/<id>/<verb>` on an rt row. False when the id is not an rt row.
 * - resume: a paused row runs again now, on the newest build (`deployment=latest`)
 * - kill: the row and its open calls end with an error; the parent's journal gets it
 * - cancel: the handler sees a cancel at its next await
 */
export const rtPatch =
  (sql: postgres.Sql) =>
  async (path: string): Promise<boolean> => {
    const m = PATH.exec(path);
    if (!m) return false;
    const id = decodeURIComponent(m[1] as string);
    const [row] = await sql<
      { status: string }[]
    >`SELECT status FROM rt.invocations WHERE id = ${id}`;
    if (!row) return false;
    if (m[2] === "resume") await resume(sql, id);
    else if (m[2] === "kill") await kill(sql, id);
    else await sql`SELECT rt.cancel(${id}, now())`;
    return true;
  };

export async function resume(sql: postgres.Sql, id: string): Promise<void> {
  await sql`
    UPDATE rt.invocations SET status = 'pending', failures = 0, run_at = now(), build = NULL
    WHERE id = ${id} AND status = 'paused'`;
  await sql`SELECT pg_notify('rt_wake', '')`;
}

const KILLED = JSON.stringify({ message: "killed", code: 409 });

/** As `finish` ends a row: the row and every open call under it, each parent's journal entry. */
export async function kill(sql: postgres.Sql, id: string): Promise<number> {
  return sql.begin(async (tx) => {
    const ended = await tx<{ id: string; parent_id: string | null; parent_seq: number | null }[]>`
      WITH RECURSIVE tree AS (
        SELECT id FROM rt.invocations WHERE id = ${id}
        UNION SELECT c.id FROM rt.invocations c JOIN tree t ON c.parent_id = t.id
      )
      UPDATE rt.invocations i SET status = 'killed', error = ${KILLED}::text::jsonb, holds = false,
        lease_until = NULL, completed_at = now()
      FROM tree WHERE i.id = tree.id AND i.status NOT IN ('done', 'killed')
      RETURNING i.id, i.parent_id, i.parent_seq`;
    for (const r of ended)
      if (r.parent_id && r.parent_seq !== null) {
        await tx`
          UPDATE rt.journal SET done = true, value = NULL, error = ${KILLED}::text::jsonb, at = now()
          WHERE invocation_id = ${r.parent_id} AND seq = ${r.parent_seq} AND NOT done`;
        await tx`SELECT rt.wake(${r.parent_id}, now())`;
      }
    const ids = ended.map((r) => r.id);
    if (ids.length)
      await tx`
        WITH a AS (
          UPDATE rt.journal SET done = true, value = NULL, error = ${KILLED}::text::jsonb, at = now()
          WHERE kind = 'attach' AND ref = ANY(${ids}) AND NOT done RETURNING invocation_id)
        SELECT rt.wake(invocation_id, now()) FROM (SELECT DISTINCT invocation_id FROM a) d`;
    for (const r of ended) await tx`SELECT pg_notify('rt_done', ${r.id})`;
    await tx`SELECT pg_notify('rt_wake', '')`;
    return ended.length;
  });
}
