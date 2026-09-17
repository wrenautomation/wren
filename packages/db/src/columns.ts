import { sql } from "drizzle-orm";
import { check, timestamp, uuid } from "drizzle-orm/pg-core";

/** Columns every table has. Spread first so `id` and `created_at` lead the DDL. */
export const baseColumns = {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

/** CHECK (col >= 0) for each counter. Name: ck_<table>_<col>_non_negative. */
export function nonNegative(table: string, cols: Record<string, { name: string }>) {
  return Object.values(cols).map((c) =>
    check(`ck_${table}_${c.name}_non_negative`, sql`${sql.identifier(c.name)} >= 0`),
  );
}

/**
 * CHECK (col IN (...)) for a string-enum column, written in Postgres's own canonical
 * form so the stored definition is byte-identical to the legacy schema.
 * Pair with `varchar(..., { enum })` so DDL and TS agree.
 */
export function oneOf(name: string, col: { name: string }, values: readonly string[]) {
  const list = values.map((v) => `'${v.replaceAll("'", "''")}'::character varying`).join(", ");
  return check(name, sql.raw(`("${col.name}")::text = ANY ((ARRAY[${list}])::text[])`));
}
