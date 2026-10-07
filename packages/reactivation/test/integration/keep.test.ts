/**
 * Keep over the seeded demo (designs/2026-10-07-health.md, "Keep"): accounts placed with in the
 * last 24 months, the usual gap, and the signal and risk. Synthetic data only.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "../../src/demo/seed.js";
import { deps as seedDeps, today } from "./demo-fixture.js";

let pg: TestPostgres;
type Keep = {
  id: number;
  signal: string;
  risk: number;
  why: string;
  usual_gap: number;
  since: number;
  placements: number;
};
const keep = async (id?: number) =>
  pg.db.execute<Keep>(
    id === undefined
      ? sql`select * from reactivation_keep order by id`
      : sql`select * from reactivation_keep where id = ${id}`,
  );

beforeAll(async () => {
  pg = await startTestPostgres();
  await seedDemo(pg.db, seedDeps, { agency: "northside.example", today });
});
afterAll(() => pg.stop());

describe("keep", () => {
  it("reads every account placed with in 24 months, each with a signal and why", async () => {
    const rows = await keep();
    for (const r of rows) {
      expect(["champion_left", "overdue", "hiring", "news", "steady"]).toContain(r.signal);
      expect([0, 20, 30, 50, 70, 80, 100]).toContain(r.risk);
      expect(r.why.length).toBeGreaterThan(0);
      expect(r.since).toBeLessThan(731);
    }
  });

  it("finds the usual gap, past it by a quarter, and a champion who left", async () => {
    // Two contacts at one firm, placed 500 and 300 days ago: a 200-day gap, 300 days on.
    const [a, b] = await pg.db.execute<{ id: number; person_id: number; company_id: number }>(sql`
      select c.id, c.person_id, c.company_id from crm_contacts c
      where not exists (select 1 from findings f where f.person_id = c.person_id
        and f.kind in ('still_there', 'job_change', 'left'))
      order by c.id limit 2`);
    if (!a || !b) throw new Error("the demo has too few contacts");
    const firm = a.company_id;
    await pg.db.execute(
      sql`update crm_contacts set last_placement_on = null where company_id = ${firm}`,
    );
    await pg.db.execute(sql`update crm_contacts set company_id = ${firm},
      last_placement_on = (now() - interval '500 days')::date,
      last_contacted_on = (now() - interval '10 days')::date where id = ${b.id}`);
    await pg.db.execute(sql`update crm_contacts set
      last_placement_on = (now() - interval '300 days')::date,
      last_contacted_on = (now() - interval '10 days')::date where id = ${a.id}`);
    const [r] = await keep(firm);
    expect(r).toMatchObject({
      signal: "overdue",
      risk: 30,
      usual_gap: 200,
      since: 300,
      placements: 2,
    });
    expect(r?.why).toBe("300 days since the last placement; usually 200");

    // The champion, the person behind the latest placement, left.
    await pg.db.execute(sql`insert into findings (kind, person_id, fact_key, value, confidence, via)
      values ('left', ${a.person_id}, ${`keep-test:${a.person_id}`}, '{}'::jsonb, 0.9, 'linkedin')`);
    const [gone] = await keep(firm);
    expect(gone).toMatchObject({ signal: "champion_left", risk: 80 });
    expect(gone?.why).toMatch(/ left$/);
  });
});
