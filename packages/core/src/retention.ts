/**
 * Run-ledger retention. The two chattiest loops write a `runs` row per pass (inbox sync, send
 * tick: about 70k rows in a month). Once a pass is 30 days old and nothing points at it, the row
 * has no reader. "Nothing points at it" is read off the catalog, so a table that gains a foreign
 * key to `runs` later protects its rows without anyone editing this list.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";

export const RETAINED_COMMANDS = ["outreach inbox sync", "send tick"] as const;
export const RUNS_RETENTION_DAYS = 30;
const BATCH = 5_000;

/** Delete finished, old, unreferenced runs of the chatty commands. Returns how many went. */
export async function pruneRuns(db: Queryable, now: Date): Promise<number> {
  // Cascade and set-null keys follow the delete on their own; every other key blocks it.
  const keys = await db.execute<{ t: string; c: string }>(sql`
    SELECT con.conrelid::regclass::text AS t, a.attname::text AS c
    FROM pg_constraint con JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    WHERE con.contype = 'f' AND con.confrelid = 'runs'::regclass
      AND con.confdeltype NOT IN ('c', 'n') AND cardinality(con.conkey) = 1`);
  // The names come from the catalog, quoted by regclass; nothing here is caller input.
  const unused = keys.map(
    (k) =>
      sql`AND NOT EXISTS (SELECT 1 FROM ${sql.raw(k.t)} x WHERE x.${sql.identifier(k.c)} = r.id)`,
  );
  const before = new Date(now.getTime() - RUNS_RETENTION_DAYS * 86_400_000).toISOString();
  let gone = 0;
  for (;;) {
    const rows = await db.execute(sql`
      DELETE FROM runs WHERE id IN (
        SELECT r.id FROM runs r
        WHERE r.command IN (${sql.join(
          RETAINED_COMMANDS.map((c) => sql`${c}`),
          sql`, `,
        )})
          AND r.finished_at IS NOT NULL AND r.started_at < ${before}::timestamptz
          ${sql.join(unused, sql` `)}
        LIMIT ${BATCH})
      RETURNING 1`);
    gone += rows.length;
    if (rows.length < BATCH) return gone;
  }
}
