/**
 * Keep over the seeded demo (designs/2026-10-07-health.md, "Keep"): accounts placed with in the
 * last 24 months, the usual gap, and the signal and risk. Synthetic data only.
 */
import type { Queryable } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importJobOrders, ORDER_FORMATS, readJobOrders } from "../../src/crm/job-orders.js";
import { seedDemo } from "../../src/demo/seed.js";
import { readVisits } from "../../src/keep.js";
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
      expect([
        "champion_left",
        "overdue",
        "hiring",
        "visited",
        "news",
        "orders",
        "steady",
      ]).toContain(r.signal);
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

  it("an open job order holds off overdue; closed, it's overdue again", async () => {
    const firm = await overdueFirm(2);
    const [co] = await pg.db.execute<{ name: string }>(
      sql`select coalesce(name, domain) name from companies where id = ${firm}`,
    );
    const csv = (status: string) =>
      new TextEncoder().encode(
        `Job ID,Job Title,Company,Status\nJ-1,Engineer,${co?.name},${status}\n`,
      );
    const format = ORDER_FORMATS.get("ats-generic");
    if (!format) throw new Error("no generic format");
    const open = await importJobOrders(
      pg.db,
      format,
      readJobOrders(format, "jobs.csv", csv("Open")),
    );
    expect(open).toMatchObject({ orders: 1, open: 1, matched: 1, unmatched: 0 });
    const [r] = await keep(firm);
    expect(r).toMatchObject({ signal: "orders", risk: 0, why: "1 open job order" });

    // Again with the order filled: the same row, now shut.
    await importJobOrders(pg.db, format, readJobOrders(format, "jobs.csv", csv("Filled")));
    const [n] = await pg.db.execute<{ n: number }>(sql`select count(*)::int n from job_orders`);
    expect(n?.n).toBe(1);
    expect((await keep(firm))[0]).toMatchObject({ signal: "overdue", risk: 30 });
  });

  it("a form from the account's domain shows it on your site; free mail doesn't", async () => {
    const firm = await overdueFirm(4);
    await pg.db.execute(sql`update crm_contacts set last_placement_on = (now() - interval '20 days')::date
      where company_id = ${firm}`);
    const at = new Date();
    const rows = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        what: "Hiring brief",
        at,
        email: "sam@keep-4.example",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        what: "Hiring brief",
        at,
        email: "sam@gmail.com",
      },
    ];
    // Wren's Sites side, as `site_entry_records` gives it.
    const main = { execute: async () => rows } as unknown as Queryable;
    expect(await readVisits(main, pg.db, "acme", at)).toEqual({ read: 2, added: 1 });
    expect(await readVisits(main, pg.db, "acme", at)).toEqual({ read: 2, added: 0 });
    expect((await keep(firm))[0]).toMatchObject({
      signal: "visited",
      why: "Filled Hiring brief on your site",
    });
  });
});

/** A new firm with two contacts placed 500 and 300 days ago, both contacted 10 days ago. */
async function overdueFirm(n: number): Promise<number> {
  const [co] = await pg.db.execute<{ id: number }>(sql`
    insert into companies (name, domain) values (${`Keep Test ${n}`}, ${`keep-${n}.example`})
    returning id`);
  const [imp] = await pg.db.execute<{ id: number }>(sql`
    insert into imports (source_type, source_ref, stats) values ('crm-generic', 'keep-test', '{}')
    returning id`);
  if (!co || !imp) throw new Error("no firm");
  for (const [i, days] of [500, 300].entries()) {
    const [p] = await pg.db.execute<{ id: number }>(sql`
      insert into people (company_id, full_name, is_compliance, origin, origin_ref, raw)
      values (${co.id}, ${`Pat Keep${n}${i}`}, false, 'crm', 'keep-test', '{}') returning id`);
    await pg.db.execute(sql`
      insert into crm_contacts (person_id, company_id, import_id, row_number, format, crm_key,
        last_placement_on, last_contacted_on, raw)
      values (${p?.id}, ${co.id}, ${imp.id}, ${i + 1}, 'crm-generic', ${`keep-${n}-${i}`},
        (now() - make_interval(days => ${days}))::date, (now() - interval '10 days')::date, '{}')`);
  }
  return co.id;
}
