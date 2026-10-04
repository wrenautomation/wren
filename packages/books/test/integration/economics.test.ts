/**
 * Unit economics against the migrated schema, on a made-up set of spend, clients, contracts,
 * invoices and funnel rows from January to June 2026. Every figure below was worked by hand
 * from that set. Delivery and channel tables are written by SQL name, as the views read them.
 *
 * Spend (CAD): outreach (email) 300 a month Jan to May; ads 200 in Feb; software made shared
 * acquisition, 120 in Feb and 60 in Apr; hosting made delivery, 50 a month Feb to May; ai 100
 * and fees (no bucket, so overhead) 10 in Jan.
 * Clients:
 * - a (email): setup 1000 in Feb, then monthly bills for Feb to May, each 300 plus units at the
 *   contract's 100. Still running. A June bill is open, so it never counts.
 * - b (ads): one bill of 200 USD in Mar at the Mar 13 rate, 1.40. Ends Apr 10: churned.
 * - c (email): 400 in Apr and May. Its first engagement ends May 15 and a second starts that
 *   day, so it never churns.
 * - demo: paid in Mar, never counts.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { econChannels, econCohorts, econMonths, seedBooks } from "../../src/index.js";

let pg: TestPostgres;

async function spend(on: string, key: string, cents: number): Promise<void> {
  await pg.db.execute(sql`
    with e as (insert into books.entries (posted_on, memo) values (${on}, 'test spend') returning id)
    insert into books.lines (entry_id, account_id, cad_cents, amount_cents, currency, rate, rate_source)
    select e.id, a.id, x.cents, x.cents, 'CAD', 1, 'same'
    from e, books.accounts a, lateral (select case when a.key = ${key} then ${cents}::bigint
      else ${-cents}::bigint end cents) x
    where a.key in (${key}, 'card-bmo')`);
}

async function engagement(
  client: string,
  startsOn: string,
  status: string,
  opts: { endedOn?: string; source?: string } = {},
): Promise<number> {
  const r = await pg.db.execute<{ id: number }>(sql`
    insert into delivery.engagements (client_id, offer_id, starts_on, status, ended_on, source_channel, created_by)
    values (${client}, 'test', ${startsOn}, ${status}, ${opts.endedOn ?? null}, ${opts.source ?? null}, 'ops')
    returning id`);
  return r[0]?.id ?? 0;
}

let invoiceNo = 0;
async function invoice(
  engagementId: number,
  cents: number,
  paidOn: string | null,
  opts: { currency?: string; setup?: boolean; period?: string; units?: number } = {},
): Promise<void> {
  invoiceNo += 1;
  const day = paidOn ?? "2026-06-01";
  await pg.db.execute(sql`
    insert into delivery.invoices (engagement_id, number, description, cents, currency, issued_on,
      due_on, status, paid_on, setup, period, units, created_by)
    values (${engagementId}, ${`T-${invoiceNo}`}, 'test', ${cents}, ${opts.currency ?? "CAD"}, ${day},
      ${day}, ${paidOn ? "paid" : "open"}, ${paidOn}, ${opts.setup ?? false}, ${opts.period ?? null},
      ${opts.units ?? null}, 'ops')`);
}

beforeAll(async () => {
  pg = await startTestPostgres();
  await seedBooks(pg.db);
  await pg.db.execute(sql`update books.accounts set bucket = 'acquisition' where key = 'software'`);
  await pg.db.execute(sql`update books.accounts set bucket = 'delivery' where key = 'hosting'`);
  await pg.db.execute(sql`update books.accounts set bucket = null where key = 'fees'`);

  await spend("2026-01-15", "outreach", 30000);
  await spend("2026-01-15", "ai", 10000);
  await spend("2026-01-05", "fees", 1000);
  await spend("2026-02-15", "outreach", 30000);
  await spend("2026-02-15", "ads", 20000);
  await spend("2026-02-15", "software", 12000);
  for (const m of ["02", "03", "04", "05"]) await spend(`2026-${m}-15`, "hosting", 5000);
  await spend("2026-03-15", "outreach", 30000);
  await spend("2026-04-15", "outreach", 30000);
  await spend("2026-04-15", "software", 6000);
  await spend("2026-05-15", "outreach", 30000);

  await pg.db.execute(sql`
    insert into books.rates ("on", currency, source, cad_per_unit) values
      ('2026-03-13', 'USD', 'boc', 1.40), ('2026-03-20', 'USD', 'boc', 1.50),
      ('2026-03-15', 'USD', 'card', 2.00)`);
  await pg.db.execute(sql`
    insert into public.clients (id, name, database, demo) values
      ('a', 'Client A', 'wren_client_a', false), ('b', 'Client B', 'wren_client_b', false),
      ('c', 'Client C', 'wren_client_c', false), ('demo', 'Demo', 'wren_client_demo', true)`);

  const a = await engagement("a", "2026-02-01", "active", { source: "email" });
  await pg.db.execute(sql`
    insert into delivery.agreements (engagement_id, version, terms, body, sha256, issued_by)
    values (${a}, 'v1', '{"perUnitCents": 10000}', 'x', 'x', 'ops')`);
  await invoice(a, 100000, "2026-02-05", { setup: true });
  await invoice(a, 50000, "2026-02-28", { period: "2026-02", units: 2 });
  await invoice(a, 40000, "2026-03-30", { period: "2026-03", units: 1 });
  await invoice(a, 30000, "2026-04-30", { period: "2026-04", units: 0 });
  await invoice(a, 30000, "2026-05-29", { period: "2026-05", units: 0 });
  await invoice(a, 30000, null, { period: "2026-06", units: 0 });

  const b = await engagement("b", "2026-03-01", "done", { source: "ads", endedOn: "2026-04-10" });
  await invoice(b, 20000, "2026-03-15", { currency: "USD", period: "2026-03" });

  const c1 = await engagement("c", "2026-04-01", "done", {
    source: "email",
    endedOn: "2026-05-15",
  });
  const c2 = await engagement("c", "2026-05-15", "active");
  await invoice(c1, 40000, "2026-04-02", { period: "2026-04" });
  await invoice(c2, 40000, "2026-05-20", { period: "2026-05" });

  const demo = await engagement("demo", "2026-02-01", "active", { source: "email" });
  await invoice(demo, 99900, "2026-03-10", { period: "2026-03" });

  // The email funnel. Foreign keys are off for these rows only: the views read counts and times.
  await pg.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    // Apr 30 23:30 in Toronto is May 1 in UTC: it counts in April.
    await tx.execute(sql`
      insert into leads (email, status, raw, import_id, created_at) values
        ('l1@example.com', 'imported', '{}', 1, '2026-05-01T03:30:00Z'),
        ('l2@example.com', 'imported', '{}', 1, '2026-05-05T12:00:00Z'),
        ('l3@example.com', 'imported', '{}', 1, '2026-05-05T12:00:00Z'),
        ('l4@example.com', 'imported', '{}', 1, '2026-05-05T12:00:00Z')`);
    // May 31 22:00 in Toronto is June 1 in UTC: it counts in May. A draft never counts.
    await tx.execute(sql`
      insert into messages (enrollment_id, step, template, template_version, to_email, body, provenance,
        state, message_id, sent_at) values
        (1, 1, 't', '1', 'x@example.com', 'x', '{}', 'sent', 'm1', '2026-05-06T12:00:00Z'),
        (2, 1, 't', '1', 'x@example.com', 'x', '{}', 'sent', 'm2', '2026-05-06T12:00:00Z'),
        (3, 1, 't', '1', 'x@example.com', 'x', '{}', 'sent', 'm3', '2026-05-06T12:00:00Z'),
        (4, 1, 't', '1', 'x@example.com', 'x', '{}', 'sent', 'm4', '2026-06-01T02:00:00Z'),
        (5, 1, 't', '1', 'x@example.com', 'x', '{}', 'draft', null, null)`);
    await tx.execute(sql`
      insert into thread_events (id, enrollment_id, kind, received_at, disposition, disposition_source) values
        (1, 1, 'reply', '2026-05-07T12:00:00Z', 'interested', 'rule'),
        (2, 1, 'reply', '2026-05-08T12:00:00Z', 'not_interested', 'rule'),
        (3, 1, 'auto_reply', '2026-05-08T12:00:00Z', null, null)`);
    await tx.execute(sql`
      insert into call_invites (thread_event_id, enrollment_id, state, email, booking_uid, start, updated_at) values
        (1, 1, 'booked', 'x@example.com', 'b1', '2026-05-25T15:00:00Z', '2026-05-20T12:00:00Z'),
        (2, 1, 'proposed', 'x@example.com', null, null, '2026-05-20T12:00:00Z')`);
  });
});

afterAll(() => pg.stop());

async function months(): Promise<Map<string, Record<string, unknown>>> {
  const ids = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
  const rows = await pg.db.select().from(econMonths).where(inArray(econMonths.id, ids));
  return new Map(rows.map((r) => [r.id ?? "", r]));
}

describe("a paid invoice", () => {
  it("takes the closest later rate when Books has none before it", async () => {
    const got = await pg.db
      .transaction(async (tx) => {
        await tx.execute(sql`
          insert into public.clients (id, name, database) values ('e', 'Client E', 'wren_client_e')`);
        await tx.execute(sql`
          insert into books.rates ("on", currency, source, cad_per_unit) values
            ('2026-01-12', 'EUR', 'boc', 1.50), ('2026-01-30', 'EUR', 'boc', 1.60)`);
        const r = await tx.execute<{ id: number }>(sql`
          insert into delivery.engagements (client_id, offer_id, starts_on, status, created_by)
          values ('e', 'test', '2026-01-01', 'active', 'ops') returning id`);
        await tx.execute(sql`
          insert into delivery.invoices (engagement_id, number, description, cents, currency, issued_on,
            due_on, status, paid_on, created_by)
          values (${r[0]?.id}, 'T-eur', 'test', 10000, 'EUR', '2026-01-10', '2026-01-10', 'paid',
            '2026-01-10', 'ops')`);
        const rows = await tx.execute<{ cad_cents: number }>(
          sql`select cad_cents::int from books.econ_paid where client_id = 'e'`,
        );
        throw new Rollback(rows[0]?.cad_cents);
      })
      .catch((e: unknown) => (e instanceof Rollback ? e.value : Promise.reject(e)));
    expect(got).toBe(15000);
  });
});

class Rollback {
  constructor(readonly value: unknown) {}
}

describe("a month", () => {
  it("spend by bucket, an expense with none as overhead", async () => {
    const m = await months();
    expect(m.get("2026-01")).toMatchObject({
      spend: 410,
      acquisition: 300,
      delivery: 0,
      overhead: 110,
    });
    expect(m.get("2026-02")).toMatchObject({
      spend: 670,
      acquisition: 620,
      delivery: 50,
      overhead: 0,
    });
    expect(m.get("2026-04")).toMatchObject({ spend: 410, acquisition: 360, delivery: 50 });
    expect(m.get("2026-06")).toMatchObject({ spend: 0, acquisition: 0 });
  });

  it("revenue in CAD when paid, MRR as each client's running monthly bill, never the demo", async () => {
    const m = await months();
    const pick = (id: string) => {
      const r = m.get(id);
      return [r?.revenue, r?.mrr, r?.paying, r?.payingStart, r?.newClients, r?.churned];
    };
    expect(pick("2026-01")).toEqual([0, 0, 0, 0, 0, 0]);
    expect(pick("2026-02")).toEqual([1500, 300, 1, 0, 1, 0]);
    expect(pick("2026-03")).toEqual([680, 580, 2, 1, 1, 0]);
    expect(pick("2026-04")).toEqual([700, 700, 3, 2, 1, 1]);
    expect(pick("2026-05")).toEqual([700, 700, 2, 3, 0, 0]);
    expect(pick("2026-06")).toEqual([0, 700, 2, 2, 0, 0]);
  });

  it("ARPA, margin and CAC, null with nothing to divide by", async () => {
    const m = await months();
    const pick = (id: string) => {
      const r = m.get(id);
      return [r?.arpa, r?.arpa3, r?.grossMargin, r?.cac3, r?.cac6, r?.cac12];
    };
    expect(pick("2026-01")).toEqual([null, null, null, null, null, null]);
    expect(pick("2026-02")).toEqual([1500, 1500, 0.9667, 920, 920, 920]);
    expect(pick("2026-03")).toEqual([340, 726.67, 0.9265, 610, 610, 610]);
    expect(pick("2026-04")).toEqual([233.33, 480, 0.9286, 426.67, 526.67, 526.67]);
    expect(pick("2026-05")).toEqual([350, 297.14, 0.9286, 480, 626.67, 626.67]);
    expect(pick("2026-06")).toEqual([0, 200, null, 660, 626.67, 626.67]);
  });

  it("churn, LTV and payback; no LTV until someone churns", async () => {
    const m = await months();
    const pick = (id: string) => {
      const r = m.get(id);
      return [r?.logoChurn, r?.revenueChurn, r?.ltv, r?.ltvCac, r?.payback];
    };
    expect(pick("2026-01")).toEqual([null, null, null, null, null]);
    expect(pick("2026-02")).toEqual([null, null, null, null, 0.6]);
    expect(pick("2026-03")).toEqual([0, 0, null, null, 0.9]);
    expect(pick("2026-04")).toEqual([0.5, 0.4828, 1365, 2.59, 1.2]);
    expect(pick("2026-05")).toEqual([0, 0, 2535, 4.05, 1.5]);
    expect(pick("2026-06")).toEqual([0, 0, 2704, 4.31, 1.9]);
  });

  it("realized LTV over churned clients and over everyone", async () => {
    const m = await months();
    const pick = (id: string) => [m.get(id)?.realizedLtv, m.get(id)?.realizedLtvAll];
    expect(pick("2026-01")).toEqual([null, null]);
    expect(pick("2026-02")).toEqual([null, 1450]);
    expect(pick("2026-03")).toEqual([null, 1040]);
    expect(pick("2026-04")).toEqual([265.42, 910]);
    expect(pick("2026-05")).toEqual([264.36, 1126.67]);
  });
});

describe("a channel", () => {
  async function channels(): Promise<Map<string, Record<string, unknown>>> {
    const rows = await pg.db.select().from(econChannels);
    return new Map(rows.map((r) => [r.id ?? "", r]));
  }

  it("direct spend plus shared spend by the new clients it won", async () => {
    const c = await channels();
    expect(c.get("email/2026-02")).toMatchObject({ spend: 420, newClients: 1, cac3: 720 });
    expect(c.get("ads/2026-02")).toMatchObject({ spend: 200, newClients: 0, cac3: null });
    expect(c.get("email/2026-03")).toMatchObject({ spend: 300, cac3: 960 });
    expect(c.get("ads/2026-03")).toMatchObject({ spend: 0, newClients: 1, cac3: 260 });
    expect(c.get("email/2026-04")).toMatchObject({ spend: 360, cac3: 510, cac6: 660 });
    expect(c.get("ads/2026-04")).toMatchObject({ spend: 0, cac3: 260 });
    expect(c.get("email/2026-05")).toMatchObject({ cac3: 930 });
  });

  it("each stage and its cost, by the month in Toronto", async () => {
    const c = await channels();
    expect(c.get("email/2026-04")).toMatchObject({
      leads: 1,
      perLead: 360,
      sends: 0,
      perSend: null,
    });
    expect(c.get("email/2026-05")).toMatchObject({
      spend: 300,
      leads: 3,
      sends: 4,
      replies: 2,
      interested: 1,
      booked: 1,
      perLead: 100,
      perSend: 75,
      perReply: 150,
      perInterested: 300,
      perBooked: 300,
    });
    expect(c.get("sms/2026-05")).toMatchObject({ spend: 0, replies: 0, perReply: null });
    expect(c.get("unknown/2026-05")).toMatchObject({ spend: 0, newClients: 0, cac3: null });
  });
});

describe("a cohort", () => {
  it("the share still paying and the revenue kept, setup fees left out", async () => {
    const rows = await pg.db.select().from(econCohorts);
    const c = new Map(rows.map((r) => [r.id ?? "", r]));
    expect(c.get("2026-02/0")).toMatchObject({
      clients: 1,
      stillPaying: 1,
      revenue: 500,
      revenueKept: 1,
    });
    expect(c.get("2026-02/1")).toMatchObject({ stillPaying: 1, revenue: 400, revenueKept: 0.8 });
    expect(c.get("2026-03/1")).toMatchObject({ stillPaying: 1, revenue: 0, revenueKept: 0 });
    expect(c.get("2026-03/2")).toMatchObject({ paying: 0, stillPaying: 0 });
    expect(c.get("2026-04/1")).toMatchObject({ stillPaying: 1, revenue: 400, revenueKept: 1 });
  });
});

describe("what the views read", () => {
  // Read by name across products: a rename there must fail here, not in prod.
  it("keeps every column it reads", async () => {
    const read: Record<string, string[]> = {
      "delivery.invoices": [
        "id",
        "engagement_id",
        "cents",
        "currency",
        "status",
        "paid_on",
        "setup",
        "period",
        "units",
      ],
      "delivery.engagements": [
        "id",
        "client_id",
        "starts_on",
        "status",
        "ended_on",
        "source_channel",
      ],
      "delivery.agreements": ["engagement_id", "terms"],
      "public.clients": ["id", "demo"],
      "public.leads": ["created_at"],
      "public.messages": ["state", "sent_at"],
      "public.thread_events": ["kind", "received_at", "disposition"],
      "public.call_invites": ["state", "updated_at"],
      "public.sms_contacts": ["created_at"],
      "public.sms_messages": ["direction", "sent_at", "received_at", "created_at", "disposition"],
      "public.reach_contacts": ["created_at"],
      "public.reach_messages": ["direction", "sent_at", "created_at"],
    };
    for (const [table, columns] of Object.entries(read)) {
      const [schema, name] = table.split(".");
      const got = await pg.db.execute<{ column_name: string }>(sql`
        select column_name from information_schema.columns
        where table_schema = ${schema} and table_name = ${name}`);
      const have = new Set(got.map((r) => r.column_name));
      expect(
        columns.filter((c) => !have.has(c)),
        table,
      ).toEqual([]);
    }
  });
});
