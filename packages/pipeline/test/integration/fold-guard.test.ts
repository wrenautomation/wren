/**
 * The guard in migration 0303 (designs/2026-10-18-journeys.md, "Folding `@wren/deals`"): the old
 * tables go only when every deal has a journey and no workflow names `trigger.deal`. The guard is
 * run here against tables shaped as migration 0208 made them, because 0303 has already dropped
 * them in the test database. Synthetic data only.
 */
import { readFileSync } from "node:fs";
import { addClient } from "@wren/core/clients";
import { resolveProfile } from "@wren/core/profiles";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { funnels, funnelVersions, journeys } from "../../src/schema.js";

const FILE = new URL("../../../db/drizzle/0303_deals_guard_and_drop.sql", import.meta.url);
const [GUARD = "", ...DROPS] = readFileSync(FILE, "utf8").split("--> statement-breakpoint");

let pg: TestPostgres;
const PIPE = "00000000-0000-4000-8000-0000000000a1";
const DEAL = "00000000-0000-4000-8000-0000000000d1";
const CLIENT_DEAL = "00000000-0000-4000-8000-0000000000d2";

beforeAll(async () => {
  pg = await startTestPostgres({ own: true });
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme Dental", products: {} });
  await pg.db.execute(sql`create table deal_pipelines (
    id uuid primary key default gen_random_uuid(),
    client varchar(40) references clients(id) on delete cascade,
    name varchar(80) not null, stages jsonb not null,
    created_by text not null default 't', updated_by text not null default 't')`);
  await pg.db.execute(sql`create table deals (
    id uuid primary key default gen_random_uuid(),
    client varchar(40) references clients(id) on delete cascade,
    pipeline uuid not null references deal_pipelines(id) on delete cascade,
    stage varchar(40) not null, name varchar(200) not null,
    created_by text not null default 't', updated_by text not null default 't')`);
  await pg.db.execute(sql`create table deal_moves (
    id bigserial primary key, deal uuid not null references deals(id) on delete cascade,
    "to" varchar(40) not null)`);
  await pg.db.execute(
    sql`insert into deal_pipelines (id, name, stages) values (${PIPE}, 'Sales', '[]'::jsonb)`,
  );
  await pg.db.insert(funnels).values({ id: "sales", name: "Sales" });
  await pg.db.insert(funnelVersions).values({
    funnel: "sales",
    number: 1,
    body: {
      name: "Sales",
      offer: "offer-a",
      stages: [{ key: "new", label: "New", on: [] }],
      entries: [],
    },
    why: "t",
    createdBy: "t",
  });
});
afterAll(() => pg.stop());

/** What Postgres said, not drizzle's wrapper. */
async function guard(db: Db = pg.db): Promise<string | null> {
  try {
    await db.execute(sql.raw(GUARD));
    return null;
  } catch (e) {
    return String((e as { cause?: { message?: string } }).cause?.message ?? e);
  }
}

const save = (edits: unknown, live = true) =>
  pg.db.execute(
    sql`insert into workflow_saves (client, workflow, edits, live, by) values (null, 'close', ${JSON.stringify(edits)}::jsonb, ${live}, 't')`,
  );

describe("the deals guard", () => {
  it("is the first statement, and the drops follow it", () => {
    expect(GUARD.trim().startsWith("DO $$")).toBe(true);
    expect(DROPS.map((d) => d.trim().replace(/[ \t]+/g, " "))).toEqual([
      'DROP TABLE "deal_moves" CASCADE;',
      'DROP TABLE "deal_pipelines" CASCADE;',
      'DROP TABLE "deals" CASCADE;',
      expect.stringMatching(/^-- A client with the old Opportunities app.*\nUPDATE "clients"/),
      expect.stringMatching(/^-- The webhook event "deal.moved".*\nUPDATE "webhook_subscriptions"/),
    ]);
  });

  it("passes with no deals", async () => {
    expect(await guard()).toBeNull();
  });

  it("raises for a deal with no journey", async () => {
    await pg.db.execute(
      sql`insert into deals (id, pipeline, stage, name) values (${DEAL}, ${PIPE}, 'new', 'Test deal')`,
    );
    expect(await guard()).toMatch(/1 row\(s\) are not folded/);
  });

  it("passes once the deal has its journey", async () => {
    const p = await resolveProfile(pg.db, [{ kind: "email", value: "ada@example.test" }], "test");
    await pg.db.insert(journeys).values({
      profileId: p?.id as number,
      funnel: "sales",
      version: 1,
      stage: "new",
      entry: "manual",
      legacyDeal: DEAL,
    });
    expect(await guard()).toBeNull();
  });

  it("raises for a client's deal still in main, even with a journey elsewhere", async () => {
    await pg.db.execute(
      sql`insert into deals (id, client, pipeline, stage, name) values (${CLIENT_DEAL}, 'acme', ${PIPE}, 'new', 'Client deal')`,
    );
    expect(await guard()).toMatch(/1 row\(s\) are not folded/);
    await pg.db.execute(sql`delete from deals where id = ${CLIENT_DEAL}`);
    expect(await guard()).toBeNull();
  });

  it("raises for a workflow save that names trigger.deal, until a newer save drops it", async () => {
    await save({ parts: [{ id: "n1", type: "trigger.deal" }] });
    expect(await guard()).toMatch(/trigger\.deal is used by a workflow save \(close\)/);
    await save({ parts: [{ id: "n1", type: "trigger.journey" }] });
    expect(await guard()).toBeNull();
  });

  it("raises for a saved template that names trigger.deal", async () => {
    await pg.db.execute(sql`insert into workflow_templates (id, name, workflow, edits, by)
      values ('saved_x', 'X', 'close', ${JSON.stringify({ parts: [{ type: "trigger.deal" }] })}::jsonb, 't')`);
    expect(await guard()).toMatch(/workflow template \(saved_x\)/);
    await pg.db.execute(sql`delete from workflow_templates`);
    expect(await guard()).toBeNull();
  });

  it("drops the tables when it passes, swaps a client's Opportunities app for Journeys and renames deal.moved", async () => {
    await pg.db.execute(sql`insert into webhook_subscriptions (name, url, events, secret, by)
      values ('Hook', 'https://hooks.example.test/in', array['deal.moved', 'deal.won'], 's', 't')`);
    await pg.db.execute(
      sql`update clients set products = '{"deals.board": {}, "texts": {"on": true}}'::jsonb where id = 'acme'`,
    );
    for (const d of DROPS) await pg.db.execute(sql.raw(d));
    const gone = (await pg.db.execute(sql`select to_regclass('public.deals') t`)) as unknown as {
      t: string | null;
    }[];
    expect(gone[0]?.t).toBeNull();
    const rows = (await pg.db.execute(
      sql`select products p from clients where id = 'acme'`,
    )) as unknown as { p: Record<string, unknown> }[];
    expect(rows[0]?.p).toEqual({ "pipeline.journeys": {}, texts: { on: true } });
    const hooks = (await pg.db.execute(
      sql`select events e from webhook_subscriptions`,
    )) as unknown as { e: string[] }[];
    expect(hooks[0]?.e).toEqual(["journey.moved", "deal.won"]);
  });
});
