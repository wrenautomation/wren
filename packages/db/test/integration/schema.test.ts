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

describe("schema", () => {
  it("indexes every SET NULL foreign key column", async () => {
    const fks = await pg.db.execute<{ t: string; c: string }>(sql`
      select tc.table_name t, kcu.column_name c
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
      join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
      where tc.constraint_type='FOREIGN KEY' and rc.delete_rule='SET NULL'`);
    expect(fks.length).toBeGreaterThan(0);
    for (const { t, c } of fks) {
      const idx = await pg.db.execute(
        sql`select 1 from pg_indexes where tablename=${t} and indexdef like ${`%(${c}%`}`,
      );
      expect(idx.length, `${t}.${c} has no index`).toBeGreaterThan(0);
    }
  });
});
