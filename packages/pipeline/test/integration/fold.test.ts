/**
 * `foldDeals` on a real Postgres (designs/2026-10-18-journeys.md, "Folding `@wren/deals`"):
 * Wren's old deals and one client's become journeys with their moves as spine events; a second
 * run makes nothing; a dry run writes nothing. The old tables are made here (the drop migration
 * removes them), shaped as migration 0208 made them. Synthetic data only.
 */
import { addClient } from "@wren/core/clients";
import { events } from "@wren/core/schema";
import { cachedDb, clientAdminUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FOLD_BY, type FoldOptions, foldDeals } from "../../src/fold.js";
import { rebuildJourney } from "../../src/moves.js";
import {
  funnels,
  funnelVersions,
  journeys,
  offerVersions,
  pipelineDeals,
} from "../../src/schema.js";
import { Refused } from "../../src/store.js";

let pg: TestPostgres;
let acme: Db;
const day = (n: number) => `2026-01-${String(n).padStart(2, "0")}T10:00:00Z`;
const OLD = {
  wren: "00000000-0000-4000-8000-0000000000a1",
  partner: "00000000-0000-4000-8000-0000000000a2",
  acme: "00000000-0000-4000-8000-0000000000a3",
};
const D = (n: number) => `00000000-0000-4000-8000-0000000000d${n}`;

const DEFAULT_STAGES = JSON.stringify([
  { key: "new", label: "New", kind: "open" },
  { key: "contacted", label: "Contacted", kind: "open" },
  { key: "booked", label: "Booked", kind: "open" },
  { key: "quoted", label: "Quoted", kind: "open" },
  { key: "won", label: "Won", kind: "won" },
  { key: "lost", label: "Lost", kind: "lost" },
]);
const PARTNER_STAGES = JSON.stringify([
  { key: "lead", label: "Lead", kind: "open" },
  { key: "2nd", label: "Second call", kind: "open" },
  { key: "signed", label: "Signed", kind: "won" },
  { key: "out", label: "Out", kind: "lost" },
]);

/** The old tables as migration 0208 made them. */
async function oldTables(db: Db) {
  await db.execute(sql`create table if not exists deal_pipelines (
    id uuid primary key default gen_random_uuid(),
    client varchar(40) references clients(id) on delete cascade,
    name varchar(80) not null, stages jsonb not null,
    created_at timestamptz not null default now(), created_by text not null,
    updated_at timestamptz not null default now(), updated_by text not null)`);
  await db.execute(sql`create table if not exists deals (
    id uuid primary key default gen_random_uuid(),
    client varchar(40) references clients(id) on delete cascade,
    pipeline uuid not null references deal_pipelines(id) on delete cascade,
    stage varchar(40) not null, status varchar(4) not null default 'open',
    name varchar(200) not null, value_cents integer, currency varchar(3) not null default 'usd',
    contact_name text, contact_email text, contact_phone varchar(20),
    source varchar(8) not null default 'manual', source_ref text, owner text, note text,
    next_on date, moved_at timestamptz not null default now(), closed_at timestamptz,
    created_at timestamptz not null default now(), created_by text not null,
    updated_at timestamptz not null default now(), updated_by text not null)`);
  await db.execute(sql`create table if not exists deal_moves (
    id bigserial primary key,
    deal uuid not null references deals(id) on delete cascade,
    "from" varchar(40), "to" varchar(40) not null,
    at timestamptz not null default now(), by text not null)`);
}

interface Seed {
  id: string;
  client?: string;
  pipeline: string;
  stage: string;
  status?: "open" | "won" | "lost";
  name: string;
  email?: string;
  phone?: string;
  value?: number;
  created: number;
  moved: number;
  moves?: [string | null, string, number][];
}
async function deal(db: Db, s: Seed) {
  await db.execute(sql`insert into deals (id, client, pipeline, stage, status, name, value_cents,
      contact_email, contact_phone, source, note, moved_at, closed_at, created_at, created_by, updated_by)
    values (${s.id}, ${s.client ?? null}, ${s.pipeline}, ${s.stage}, ${s.status ?? "open"}, ${s.name},
      ${s.value ?? null}, ${s.email ?? null}, ${s.phone ?? null}, 'form', 'a note',
      ${day(s.moved)}, ${s.status && s.status !== "open" ? day(s.moved) : null}, ${day(s.created)}, 't', 't')`);
  for (const [from, to, at] of s.moves ?? [])
    await db.execute(
      sql`insert into deal_moves (deal, "from", "to", at, by) values (${s.id}, ${from}, ${to}, ${day(at)}, 't')`,
    );
}

beforeAll(async () => {
  pg = await startTestPostgres({ own: true });
  await addClient(pg.db, pg.url, { id: "acme", name: "Acme Dental", products: {} });
  // Main's login: a client's own has no grant on the `pipeline` schema (see the report).
  acme = cachedDb(clientAdminUrl(pg.url, "wren_client_acme"));
  await oldTables(pg.db);
  await pg.db.execute(sql`insert into deal_pipelines (id, client, name, stages, created_by, updated_by) values
    (${OLD.wren}, null, 'Sales', ${DEFAULT_STAGES}::jsonb, 't', 't'),
    (${OLD.partner}, null, 'Partner Deals', ${PARTNER_STAGES}::jsonb, 't', 't'),
    (${OLD.acme}, 'acme', 'Sales', ${DEFAULT_STAGES}::jsonb, 't', 't')`);
  await deal(pg.db, {
    id: D(1),
    pipeline: OLD.wren,
    stage: "booked",
    name: "Ada deal",
    email: "ada@example.test",
    value: 12345,
    created: 1,
    moved: 3,
    moves: [
      [null, "new", 1],
      ["new", "contacted", 2],
      ["contacted", "booked", 3],
    ],
  });
  await deal(pg.db, {
    id: D(2),
    pipeline: OLD.wren,
    stage: "won",
    status: "won",
    name: "Bo deal",
    email: "bo@example.test",
    created: 1,
    moved: 4,
    moves: [
      [null, "new", 1],
      ["new", "won", 4],
    ],
  });
  await deal(pg.db, {
    id: D(3),
    pipeline: OLD.wren,
    stage: "lost",
    status: "lost",
    name: "Cy deal",
    phone: "+15550100001",
    created: 1,
    moved: 5,
    moves: [
      [null, "new", 1],
      ["new", "lost", 5],
    ],
  });
  await deal(pg.db, {
    id: D(4),
    pipeline: OLD.wren,
    stage: "new",
    name: "No contact",
    created: 2,
    moved: 2,
  });
  // Ada again, same pipeline, still open: her journey is open already.
  await deal(pg.db, {
    id: D(5),
    pipeline: OLD.wren,
    stage: "new",
    name: "Ada twice",
    email: "ADA@example.test",
    created: 6,
    moved: 6,
  });
  await deal(pg.db, {
    id: D(6),
    pipeline: OLD.partner,
    stage: "2nd",
    name: "Partner one",
    email: "pat@example.test",
    created: 1,
    moved: 2,
    moves: [
      [null, "lead", 1],
      ["lead", "2nd", 2],
    ],
  });
  await deal(pg.db, {
    id: D(7),
    client: "acme",
    pipeline: OLD.acme,
    stage: "new",
    name: "Fay",
    email: "fay@example.test",
    created: 1,
    moved: 1,
  });
  await pg.db.insert(offerVersions).values({
    offer: "offer-a",
    number: 1,
    hash: "1".repeat(64),
    body: {} as never,
    why: "t",
    createdBy: "t",
  });
});
afterAll(() => pg.stop());

const deps = () => ({
  main: pg.db,
  workspace: <T>(owner: string | null, fn: (db: Db) => Promise<T>) =>
    fn(owner === null ? pg.db : acme),
});
const opts = (over: Partial<FoldOptions> = {}): FoldOptions => ({
  by: "t",
  triggers: new Set(),
  offer: "offer-a",
  ...over,
});
const foldEvents = (db: Db) => db.select({ n: count() }).from(events).where(eq(events.by, FOLD_BY));
const wren = (r: Awaited<ReturnType<typeof foldDeals>>) => r.owners.find((o) => o.owner === null);
const client = (r: Awaited<ReturnType<typeof foldDeals>>) =>
  r.owners.find((o) => o.owner === "acme");

describe("foldDeals", () => {
  it("writes nothing on a dry run, and says what it would do", async () => {
    const r = await foldDeals(deps(), opts({ dry: true }));
    expect(r.tables).toBe(true);
    expect(wren(r)).toMatchObject({
      funnels: [
        { pipeline: "Sales", funnel: "sales", made: true },
        { pipeline: "Partner Deals", funnel: "partner-deals", made: true },
      ],
      journeys: { made: 5, had: 0 },
    });
    expect(wren(r)?.events).toBe(10);
    expect(wren(r)?.conflicts).toHaveLength(1);
    expect(client(r)).toMatchObject({ journeys: { made: 1 }, removed: 0 });
    expect((await pg.db.select({ n: count() }).from(funnels))[0]?.n).toBe(0);
    expect((await pg.db.select({ n: count() }).from(journeys))[0]?.n).toBe(0);
    expect((await foldEvents(pg.db))[0]?.n).toBe(0);
    const left = await pg.db.execute(sql`select count(*)::int n from deals`);
    expect((left as unknown as { n: number }[])[0]?.n).toBe(7);
  });

  it("asks for an offer when a funnel must be made, and writes nothing", async () => {
    await expect(foldDeals(deps(), opts({ offer: undefined as never }))).rejects.toBeInstanceOf(
      Refused,
    );
    expect((await pg.db.select({ n: count() }).from(funnels))[0]?.n).toBe(0);
  });

  it("makes funnels, journeys, events and the deal row", async () => {
    const r = await foldDeals(deps(), opts());
    const w = wren(r);
    expect(w).toMatchObject({ journeys: { made: 5, had: 0 }, events: 10, deals: 1 });
    expect(w?.conflicts).toHaveLength(1);
    expect(w?.conflicts[0]).toMatch(/already has an open journey/);
    expect(client(r)).toMatchObject({ journeys: { made: 1 }, events: 1, deals: 0, removed: 1 });

    const fs = await pg.db.select().from(funnels);
    expect(fs.map((f) => f.id).sort()).toEqual(["partner-deals", "sales"]);
    const [pv] = await pg.db
      .select()
      .from(funnelVersions)
      .where(eq(funnelVersions.funnel, "partner-deals"));
    expect(pv?.why).toBe(`Folded from deal pipeline ${OLD.partner}`);
    expect(pv?.body.stages.map((s) => s.key)).toEqual(["lead", "s_2nd", "signed"]);
    expect(pv?.body.stages.find((s) => s.sale)?.key).toBe("signed");

    const byDeal = async (db: Db, id: string) => {
      const [j] = await db.select().from(journeys).where(eq(journeys.legacyDeal, id));
      return j;
    };
    const ada = await byDeal(pg.db, D(1));
    expect(ada).toMatchObject({
      funnel: "sales",
      stage: "booked",
      status: "open",
      entry: "manual",
      version: 1,
    });
    expect(ada?.entryRef).toMatchObject({
      legacy: { name: "Ada deal", value_cents: 12345, note: "a note" },
    });
    expect(await byDeal(pg.db, D(2))).toMatchObject({ stage: "won", status: "done" });
    expect(await byDeal(pg.db, D(3))).toMatchObject({
      stage: "new",
      status: "dropped",
      dropReason: "Lost",
    });
    expect(await byDeal(pg.db, D(4))).toMatchObject({ stage: "new", status: "open" });
    expect(await byDeal(pg.db, D(5))).toBeUndefined();
    expect(await byDeal(pg.db, D(6))).toMatchObject({ funnel: "partner-deals", stage: "s_2nd" });

    // The rows agree with their events.
    for (const d of [1, 2, 3, 4, 6]) {
      const j = await byDeal(pg.db, D(d));
      expect((await rebuildJourney(pg.db, j?.id as string)).changed).toBe(false);
    }
    const trail = await pg.db
      .select({ node: events.node, by: events.by, data: events.data })
      .from(events)
      .where(and(eq(events.subject, `journey:${ada?.id}`), eq(events.by, FOLD_BY)))
      .orderBy(events.at);
    expect(trail.map((e) => e.node)).toEqual(["s_new", "s_contacted", "s_booked"]);
    expect(trail[2]?.data).toMatchObject({
      from: "contacted",
      to: "booked",
      cause: { kind: "import", ref: D(1) },
    });

    // A deal at the sale stage gets an open deal row with no terms.
    const j2 = await byDeal(pg.db, D(2));
    const [row] = await pg.db
      .select()
      .from(pipelineDeals)
      .where(eq(pipelineDeals.journey, j2?.id as string));
    expect(row).toMatchObject({
      offer: "offer-a",
      offerVersion: 1,
      status: "open",
      termsVersion: null,
    });

    // The client's journey is in its own database; its old row left main.
    const fay = await byDeal(acme, D(7));
    expect(fay).toMatchObject({ funnel: "sales", stage: "new" });
    expect(
      (
        await pg.db
          .select({ n: count() })
          .from(journeys)
          .where(eq(journeys.legacyDeal, D(7)))
      )[0]?.n,
    ).toBe(0);
    const left = (await pg.db.execute(
      sql`select id::text id, client from deals order by id`,
    )) as unknown as {
      id: string;
      client: string | null;
    }[];
    expect(left.map((x) => x.id)).toEqual([D(1), D(2), D(3), D(4), D(5), D(6)]);
    expect(left.every((x) => x.client === null)).toBe(true);
  });

  it("makes nothing the second time", async () => {
    const before = (await foldEvents(pg.db))[0]?.n;
    const r = await foldDeals(deps(), opts());
    expect(wren(r)).toMatchObject({
      funnels: [
        { funnel: "sales", made: false },
        { funnel: "partner-deals", made: false },
      ],
      journeys: { made: 0, had: 5 },
      events: 0,
      deals: 0,
    });
    expect(wren(r)?.conflicts).toHaveLength(1);
    expect(client(r)).toMatchObject({
      journeys: { made: 0, had: 0 },
      skipped: ["Sales: the default pipeline, no deals"],
    });
    expect((await foldEvents(pg.db))[0]?.n).toBe(before);
    expect((await pg.db.select({ n: count() }).from(journeys))[0]?.n).toBe(5);
    expect((await pg.db.select({ n: count() }).from(funnels))[0]?.n).toBe(2);
  });

  it("folds one owner when asked", async () => {
    const r = await foldDeals(deps(), opts({ owners: [null] }));
    expect(r.owners.map((o) => o.owner)).toEqual([null]);
  });

  it("does nothing once the old tables are gone", async () => {
    const none = { ...deps(), main: pg.db };
    await pg.db.execute(sql`alter table deal_moves rename to deal_moves_kept`);
    try {
      expect(await foldDeals(none, opts())).toMatchObject({ tables: false, owners: [] });
    } finally {
      await pg.db.execute(sql`alter table deal_moves_kept rename to deal_moves`);
    }
  });
});
