import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pg: TestPostgres;

/** Drizzle wraps Postgres errors; the constraint name lives on `cause`. */
async function violatedConstraint(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    const cause = (err as { cause?: { constraint_name?: string } }).cause;
    return cause?.constraint_name;
  }
}
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

describe("migrations", () => {
  it("create every table", async () => {
    const rows = await pg.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema='public' order by 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "competitor_posts",
      "competitors",
      "llm_calls",
      "notes",
      "post_ideas",
      "post_metrics",
      "posts",
      "research_runs",
    ]);
  });
  it("index every SET NULL foreign key column", async () => {
    const fks = await pg.db.execute<{ t: string; c: string }>(sql`
      select tc.table_name t, kcu.column_name c
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
      join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
      where tc.constraint_type='FOREIGN KEY' and rc.delete_rule='SET NULL'`);
    expect(fks.length).toBeGreaterThanOrEqual(8);
    for (const { t, c } of fks) {
      const idx = await pg.db.execute(
        sql`select 1 from pg_indexes where tablename=${t} and indexdef like ${`%(${c}%`}`,
      );
      expect(idx.length, `${t}.${c} has no index`).toBeGreaterThan(0);
    }
  });
  it("reject negative counters and out-of-range ratings", async () => {
    await expect(
      violatedConstraint(
        pg.db.execute(sql`insert into llm_calls (provider, model, prompt_name, prompt_hash, stage, input_tokens)
          values ('x','m','p','h','draft',-1)`),
      ),
    ).resolves.toBe("ck_llm_calls_input_tokens_non_negative");
    await expect(
      violatedConstraint(
        pg.db.execute(sql`insert into research_runs (search_provider, mode, manual_rating)
          values ('exa','ideas',6)`),
      ),
    ).resolves.toBe("ck_research_runs_manual_rating_range");
  });
  it("dedupe metric snapshots on (post, captured_at, source)", async () => {
    const [post] = await pg.db.execute<{ id: string }>(
      sql`insert into posts (post_type, draft_path) values ('insight','d.md') returning id`,
    );
    const insert = sql`insert into post_metrics (post_id, captured_at, source, impressions)
      values (${post?.id}, '2026-09-17T00:00:00Z', 'manual', 10) on conflict do nothing`;
    await pg.db.execute(insert);
    await pg.db.execute(insert);
    const rows = await pg.db.execute(sql`select 1 from post_metrics`);
    expect(rows.length).toBe(1);
  });
});
