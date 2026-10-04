/**
 * The portal's records handlers over the seeded demo list: every type and saved view reads,
 * the demo answers masked rows on list, get and export, a login reads only its own client, bad
 * input is refused (never a raw error, which Restate retries forever), and demo writes stay refused.
 */
import { addMember, type Client, clients } from "@wren/core/clients";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "../../src/demo/seed.js";
import { REACTIVATION_RECORDS } from "../../src/portal/records.js";
import {
  PORTAL_ROUTES,
  PORTAL_WRITES,
  PortalRefusal,
  portalApi,
} from "../../src/portal/service.js";
import { deps as seedDeps, today } from "./demo-fixture.js";

let pg: TestPostgres;
let api: ReturnType<typeof portalApi>;
let jane = 0;
let pair = 0;
const opened: string[] = [];

beforeAll(async () => {
  pg = await startTestPostgres();
  await seedDemo(pg.db, seedDeps, { agency: "northside.example", today });
  const [p] = await pg.db.execute<{ id: number; company_id: number }>(
    sql`select id, company_id from people where full_name = 'Jane Doe'`,
  );
  jane = p?.id ?? 0;
  const [e] = await pg.db.execute<{ id: number }>(sql`
    insert into enrollments (person_id, company_id, niche, sequence_name, sequence_snapshot, offer,
      state, kind, to_email, sender)
    values (${jane}, ${p?.company_id}, 'reactivation', 'reactivation', '{}'::jsonb, 'reactivation',
      'active', 'person', 'jane.doe@globex.example', 'sam@northside.example')
    returning id`);
  pair = e?.id ?? 0;
  await pg.db.execute(sql`
    insert into messages (enrollment_id, step, template, template_version, to_email, subject, body,
      provenance, state)
    values (${pair}, 0, 'reactivation_opener', 'v1', 'jane.doe@globex.example', 'Jane Doe, quick one',
      'Hi Jane Doe.', '{}'::jsonb, 'draft')`);
  await pg.db.insert(clients).values([
    { id: "demo", name: "Northside Talent", database: "wren_client_demo", demo: true },
    { id: "acme", name: "Acme Staffing", database: "wren_client_acme" },
    { id: "beta", name: "Beta Search", database: "wren_client_beta" },
  ]);
  await addMember(pg.db, "acme", "owner@acme.example");
  api = portalApi({
    main: pg.db,
    open: (c: Client) => {
      opened.push(c.id);
      return pg.db;
    },
  });
});
afterAll(() => pg.stop());

const demo = { viewer: { demo: true as const } };
const operator = { viewer: { email: "william@wren.example", operator: true } };
const owner = { viewer: { email: "owner@acme.example" } };
const PERSON = "reactivation.person";
const EMAIL = "reactivation.email";
const leaks = (v: unknown) => /Doe|Northside/.test(JSON.stringify(v));

/** Resolves, or refuses with a PortalRefusal: never a raw error. */
const clean = async (p: Promise<unknown>) => {
  try {
    await p;
    return "answered";
  } catch (err) {
    if (err instanceof PortalRefusal) return "refused";
    return `raw error: ${String((err as { cause?: unknown }).cause ?? err).slice(0, 120)}`;
  }
};

describe("every type reads", () => {
  it("each saved view lists and counts, for the operator and the demo", async () => {
    for (const who of [operator, demo])
      for (const t of REACTIVATION_RECORDS)
        for (const v of t.views) {
          const page = await api.recordsList({ ...who, record: t.id, view: v.id });
          expect(page.total).toBe(page.counts[v.id]);
        }
  });

  it("the views say what they hold", async () => {
    const all = await api.recordsList({ ...operator, record: PERSON, view: "all", limit: 200 });
    expect(all.total).toBeGreaterThan(0);
    const call = await api.recordsList({ ...operator, record: PERSON, view: "call", limit: 200 });
    expect(call.rows.every((r) => r.now === "moved" || r.now === "hiring")).toBe(true);
    const warm = await api.recordsList({ ...operator, record: PERSON, view: "warm", limit: 200 });
    expect(warm.rows.every((r) => r.nextStep === "keep_warm")).toBe(true);
    const mails = await api.recordsList({ ...operator, record: EMAIL, view: "approve" });
    expect(mails.rows.map((r) => r.id)).toContain(pair);
  });

  it("a person's record has related counts, activity and detail", async () => {
    const one = await api.recordsGet({ ...operator, record: PERSON, id: jane });
    expect(one.row.name).toBe("Jane Doe");
    expect(one.related.find((r) => r.record === EMAIL)?.count).toBe(1);
    expect(one.activity).not.toBeNull();
    expect(one.detail).toHaveProperty("reasons");
    const mails = await api.recordsList({
      ...operator,
      record: EMAIL,
      of: { record: PERSON, id: jane },
    });
    expect(mails.rows.map((r) => r.id)).toEqual([pair]);
    const mail = await api.recordsGet({ ...operator, record: EMAIL, id: pair });
    expect(mail.detail).toMatchObject({ opener: "Hi Jane Doe." });
  });

  it("a mover's run line opens the address hunt", async () => {
    await pg.db.execute(sql`
      with f as (insert into findings (kind, person_id, fact_key, value, confidence, via)
        values ('job_change', ${jane}, 'test:jane-moved', '{"to": "Initech"}'::jsonb, 0.9, 'test')
        returning id)
      insert into mover_addresses (finding_id, person_id, domain, outcome)
      select id, ${jane}, 'initech.example', 'not_found' from f`);
    const work = await api.work({ ...operator, step: "movers", subject: "Jane Doe" });
    expect(work.steps[0]?.did).toBe("Looked for their email at initech.example");
    expect(work.facts).toHaveLength(1);
    const shown = await api.work({ ...demo, step: "movers", subject: "Jane D." });
    expect(leaks(shown)).toBe(false);
  });

  it("the types say which fields the demo can filter", async () => {
    const mine = await api.recordsTypes(operator);
    const shown = await api.recordsTypes(demo);
    const name = (m: typeof mine) => m[0]?.fields.find((f) => f.key === "name");
    expect(name(mine)?.searchable).toBe(true);
    expect(name(shown)).toMatchObject({ ops: [], sortable: false, searchable: false });
  });
});

describe("the demo", () => {
  it("masks list, get and export", async () => {
    for (const t of REACTIVATION_RECORDS) {
      expect(leaks(await api.recordsList({ ...demo, record: t.id, limit: 200 }))).toBe(false);
      expect(leaks(await api.recordsExport({ ...demo, record: t.id }))).toBe(false);
    }
    const one = await api.recordsGet({ ...demo, record: PERSON, id: jane });
    expect(one.row.name).toBe("Jane D.");
    expect(leaks(one)).toBe(false);
    expect(leaks(await api.recordsGet({ ...demo, record: EMAIL, id: pair }))).toBe(false);
    // The operator's own export is the real list.
    expect((await api.recordsExport({ ...operator, record: PERSON })).csv).toContain("Jane Doe");
  });

  it("can't search, filter or sort by a name", async () => {
    for (const ask of [
      { q: "Doe" },
      { where: { name: { contains: "Do" } } },
      { where: { company: "Globex" } },
      { where: { title: { contains: "a" } } },
      { sort: "name" },
      { sort: "title" },
    ])
      expect(await clean(api.recordsList({ ...demo, record: PERSON, ...ask }))).toBe("refused");
  });

  it("still refuses approve, skip and book", async () => {
    expect(await clean(api.approve({ ...demo, ids: [pair] }))).toBe("refused");
    expect(await clean(api.skip({ ...demo, ids: [pair] }))).toBe("refused");
    expect(await clean(api.book({ ...demo, threadEventId: 1 }))).toBe("refused");
    expect(PORTAL_WRITES.filter((w) => w.startsWith("records"))).toEqual([]);
    expect(PORTAL_ROUTES).toEqual(
      expect.arrayContaining(["recordsTypes", "recordsList", "recordsGet", "recordsExport"]),
    );
  });
});

describe("who reads which client", () => {
  it("a login reads only its own client's database", async () => {
    opened.length = 0;
    await api.recordsList({ ...owner, record: PERSON });
    expect(opened).toEqual(["acme"]);
    for (const client of ["beta", "demo", "ACME"]) {
      expect(await clean(api.recordsList({ ...owner, client, record: PERSON }))).toBe("refused");
      expect(await clean(api.recordsGet({ ...owner, client, record: PERSON, id: jane }))).toBe(
        "refused",
      );
      expect(await clean(api.recordsExport({ ...owner, client, record: PERSON }))).toBe("refused");
    }
    expect(await clean(api.recordsList({ ...demo, client: "acme", record: PERSON }))).toBe(
      "refused",
    );
    expect(opened).toEqual(["acme"]);
  });
});

describe("bad input is refused, never raw", () => {
  const evil = `x"; drop table people; --`;
  const asks: Record<string, unknown>[] = [
    { record: evil },
    { record: PERSON, where: { [evil]: 1 } },
    { record: PERSON, where: { score: { [evil]: 1 } } },
    { record: PERSON, where: { score: evil } },
    { record: PERSON, where: { now: evil } },
    { record: PERSON, sort: evil },
    { record: PERSON, view: evil },
    { record: PERSON, cursor: evil },
    {
      record: PERSON,
      sort: "-score",
      cursor: Buffer.from(`["-score",false,"${evil}","1"]`).toString("base64url"),
    },
    { record: PERSON, q: { $gt: "" } },
    { record: PERSON, limit: -1 },
    { record: EMAIL, of: { record: "reactivation.finding", id: 1 } },
  ];
  for (const ask of asks)
    it(`${JSON.stringify(ask).slice(0, 70)}`, async () => {
      for (const who of [operator, demo])
        expect(await clean(api.recordsList({ ...who, ...ask } as never))).toBe("refused");
    });

  it("a get of no such id, or a hostile one, is refused", async () => {
    for (const id of [999999, evil, null, { id: 1 }])
      expect(await clean(api.recordsGet({ ...operator, record: PERSON, id: id as never }))).toBe(
        "refused",
      );
  });

  it("the list is still there", async () => {
    const [r] = await pg.db.execute<{ n: number }>(sql`select count(*)::int n from people`);
    expect(r?.n).toBeGreaterThan(0);
  });
});
