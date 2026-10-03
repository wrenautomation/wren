/**
 * Whole-schema guards over the migrated database: rules every package's
 * tables must follow, checked once here instead of per package.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestPostgres, type TestPostgres } from "../../src/testing.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

async function offenders(query: ReturnType<typeof sql>): Promise<string[]> {
  const rows = await pg.db.execute<{ o: string }>(query);
  return rows.map((r) => r.o).sort();
}

describe("schema", () => {
  // A lookup by parent or a parent delete scans the whole child table without one.
  it("indexes every foreign key column, leading", async () => {
    expect(
      await offenders(sql`
        select c.conrelid::regclass || '.' || a.attname o
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f' and array_length(c.conkey, 1) = 1
          and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])`),
    ).toEqual([]);
  });

  // A plain index that leads another (or repeats it) costs a write per row and serves nothing.
  it("has no plain index that is a prefix of another on the same table", async () => {
    expect(
      await offenders(sql`
        select a.indexrelid::regclass || ' is a prefix of ' || b.indexrelid::regclass o
        from pg_index a
        join pg_index b on b.indrelid = a.indrelid and b.indexrelid <> a.indexrelid
        join pg_class ca on ca.oid = a.indexrelid
        join pg_class cb on cb.oid = b.indexrelid
        join pg_namespace n on n.oid = ca.relnamespace
        where n.nspname = 'public' and ca.relam = cb.relam
          and not a.indisunique and a.indexprs is null and a.indpred is null and b.indpred is null
          and a.indnkeyatts <= b.indnkeyatts
          and (a.indkey::int2[])[0:a.indnkeyatts - 1] = (b.indkey::int2[])[0:a.indnkeyatts - 1]`),
    ).toEqual([]);
  });
});
