/**
 * The audit log over the portal and the demo reset, both through a client's own
 * login. A write is logged as the viewer (actor) and the client role (db_user),
 * and the actor must not leak to the next write on the same pooled connection.
 * The demo reset logs a truncate for each audited table and none of the skipped
 * ones. Nothing here is expected to fail; these are the guarantees that hold.
 */
import { addMember, clients } from "@wren/core/clients";
import {
  clientDatabaseName,
  clientDatabaseUrl,
  createDatabase,
  createDb,
  type Db,
  type DbHandle,
  migrateClient,
  sealAudit,
  verifyAudit,
} from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetCrmData, seedDemo } from "../../src/demo/seed.js";
import { portalApi } from "../../src/portal/service.js";
import { deps as seedDeps, today } from "./demo-fixture.js";

const ACME = clientDatabaseName("acme");
const DEMO = clientDatabaseName("demo");

let pg: TestPostgres;
const handles = new Map<string, DbHandle>();
let api: ReturnType<typeof portalApi>;

function handle(database: string): DbHandle {
  let h = handles.get(database);
  if (!h) {
    h = createDb(clientDatabaseUrl(pg.url, database), { max: 1, app: "wren-worker" });
    handles.set(database, h);
  }
  return h;
}
const open = (client: { database: string }): Db => handle(client.database).db;

const maxId = async (db: Db): Promise<number> =>
  (await db.execute<{ n: number }>(sql`select coalesce(max(id), 0)::int n from audit_events`))[0]
    ?.n ?? 0;

type Ev = { table_name: string; op: string; db_user: string; app: string; actor: string | null };
const since = (db: Db, marker: number, table?: string) =>
  db.execute<Ev>(sql`
    select table_name, op, db_user, app, actor from audit_events
    where id > ${marker} ${table ? sql`and table_name = ${table}` : sql``} order by id`);

async function draftEnrollment(
  db: Db,
  person: number,
  company: number,
  email: string,
): Promise<number> {
  const [enr] = await db.execute<{ id: number }>(sql`
    insert into enrollments (person_id, company_id, niche, sequence_name, sequence_snapshot, offer,
      state, kind, to_email, sender)
    values (${person}, ${company}, 'reactivation', 'reactivation', '{}'::jsonb, 'reactivation',
      'active', 'person', ${email}, 'sam@acme-talent.example')
    returning id`);
  const id = enr?.id ?? 0;
  await db.execute(sql`
    insert into messages (enrollment_id, step, template, template_version, to_email, subject, body,
      provenance, state)
    values (${id}, 0, 'reactivation_opener', 'v1', ${email}, 'hi',
      'Hi Cara', '{}'::jsonb, 'draft')`);
  return id;
}

let enrApprove = 0;
let enrSkip = 0;
let enrMixed = 0;

/** A company, a person there, and an active reactivation enrollment with a draft. */
async function seedEnrollment(db: Db, tag: string, email: string): Promise<number> {
  const [c] = await db.execute<{ id: number }>(
    sql`insert into companies (name, domain) values (${`Co ${tag}`}, ${`${tag}.example`}) returning id`,
  );
  const [p] = await db.execute<{ id: number }>(sql`
    insert into people (company_id, full_name, is_compliance, origin, origin_ref, raw)
    values (${c?.id}, ${`Person ${tag}`}, false, 'manual', ${`ref-${tag}`}, '{}'::jsonb) returning id`);
  return draftEnrollment(db, p?.id ?? 0, c?.id ?? 0, email);
}

beforeAll(async () => {
  pg = await startTestPostgres();
  for (const database of [ACME, DEMO]) {
    await createDatabase(pg.db, database);
    await migrateClient(pg.url, database);
  }
  await pg.db.insert(clients).values({
    id: "acme",
    name: "Acme",
    database: ACME,
    accounts: {},
    products: { reactivation: { on: true } },
  });
  for (const email of ["owner@acme.example", "ops@acme.example"])
    await addMember(pg.db, "acme", email);
  await pg.db
    .insert(clients)
    .values({ id: "demo", name: "Demo", database: DEMO, accounts: {}, products: {}, demo: true });

  const acme = open({ database: ACME });
  enrApprove = await seedEnrollment(acme, "approve", "cara.approve@initech.example");
  enrSkip = await seedEnrollment(acme, "skip", "cara.skip@initech.example");
  enrMixed = await seedEnrollment(acme, "mixed", "cara.mixed@initech.example");

  api = portalApi({ main: pg.db, open });
}, 180_000);
afterAll(async () => {
  for (const h of handles.values()) await h.close();
  await pg.stop();
});

describe("a portal approve", () => {
  it("logs the change as the viewer and the client role, under app wren-worker", async () => {
    const acme = open({ database: ACME });
    const marker = await maxId(acme);
    const res = await api.approve({
      viewer: { email: "owner@acme.example" },
      ids: [enrApprove],
    });
    expect(res.done).toEqual([enrApprove]);
    const evs = await since(acme, marker, "messages");
    expect(evs.length).toBeGreaterThan(0);
    for (const e of evs) {
      expect(e.op).toBe("update");
      expect(e.db_user).toBe(ACME);
      expect(e.app).toBe("wren-worker");
      expect(e.actor).toBe("owner@acme.example");
    }
  });

  it("does not leak the actor to the next write on the same pooled connection", async () => {
    const acme = open({ database: ACME });
    const marker = await maxId(acme);
    await acme.execute(
      sql`insert into suppressions (kind, value, reason) values ('email', 'leak@x.example', 'manual')`,
    );
    const [e] = await since(acme, marker, "suppressions");
    expect(e?.op).toBe("insert");
    expect(e?.db_user).toBe(ACME);
    expect(e?.actor).toBeNull();
  });
});

describe("a portal skip", () => {
  it("logs the enrollment stop as the viewer who skipped it", async () => {
    const acme = open({ database: ACME });
    const marker = await maxId(acme);
    const res = await api.skip({ viewer: { email: "ops@acme.example" }, ids: [enrSkip] });
    expect(res.done).toEqual([enrSkip]);
    const evs = await since(acme, marker, "enrollments");
    expect(evs.length).toBeGreaterThan(0);
    for (const e of evs) {
      expect(e.db_user).toBe(ACME);
      expect(e.actor).toBe("ops@acme.example");
    }
  });
});

describe("the actor is the viewer's email verbatim", () => {
  it("logs mixed case as given, though the client is matched case-insensitively", async () => {
    const acme = open({ database: ACME });
    const marker = await maxId(acme);
    await api.approve({ viewer: { email: "Owner@Acme.Example" }, ids: [enrMixed] });
    const [e] = await since(acme, marker, "messages");
    expect(e?.actor).toBe("Owner@Acme.Example");
  });
});

describe("the demo reset", () => {
  it("logs a truncate for each audited table and none of the skipped ones, as the demo role", async () => {
    const demo = open({ database: DEMO });
    await seedDemo(demo, seedDeps, { agency: "northside.example", today });
    const marker = await maxId(demo);
    await resetCrmData(demo);
    const evs = await since(demo, marker);
    const truncated = evs.filter((e) => e.op === "truncate");
    const names = new Set(truncated.map((e) => e.table_name));
    // Every audited table in the reset list logged a truncate (CASCADE may add more).
    for (const audited of [
      "briefs",
      "companies",
      "contact_scores",
      "crm_contacts",
      "findings",
      "imports",
      "people",
    ])
      expect(names.has(audited)).toBe(true);
    // None of the skipped tables in the reset list did.
    for (const skipped of [
      "documents",
      "sightings",
      "contact_candidates",
      "verifications",
      "company_checks",
      "person_lookups",
      "import_errors",
    ])
      expect(names.has(skipped)).toBe(false);
    expect(truncated.length).toBeGreaterThan(0);
    for (const e of truncated) expect(e.db_user).toBe(DEMO);
  });

  it("continues ids across a reset (no RESTART IDENTITY) and stays sealable", async () => {
    const demo = open({ database: DEMO });
    await seedDemo(demo, seedDeps, { agency: "northside.example", today });
    const before = (
      await demo.execute<{ n: number }>(sql`select coalesce(max(id), 0)::int n from people`)
    )[0]?.n as number;
    // seedDemo resets then re-imports; ids must carry on, not restart at 1.
    await seedDemo(demo, seedDeps, { agency: "northside.example", today });
    const minAfter = (await demo.execute<{ n: number }>(sql`select min(id)::int n from people`))[0]
      ?.n as number;
    expect(before).toBeGreaterThan(0);
    expect(minAfter).toBeGreaterThan(before);
    await sealAudit(demo);
    expect(await verifyAudit(demo)).toMatchObject({ broken: null });
  });
});
