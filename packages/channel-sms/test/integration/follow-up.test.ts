/**
 * Follow-up and Nurture's text touch (designs/2026-10-07-follow-up-nurture.md): a node with no
 * `step` queues one `follow_up` text from the node's copy, only to someone who asked to be texted,
 * only with the global gate and the client's flag on. Off, it records "would send" and queues
 * nothing. Synthetic leads; nothing leaves (no tick runs with a live provider).
 */
import { clients } from "@wren/core/clients";
import { leadThreads } from "@wren/core/leads";
import type { SpineEvent, StepAt } from "@wren/core/spine";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tick } from "../../src/deliver.js";
import { type TouchTexts, touchStep } from "../../src/follow.js";
import { FakeProvider } from "../../src/provider.js";
import { smsContacts, smsMessages, smsNumbers } from "../../src/schema.js";
import { company, numbers, OPEN, POLICY, SEQUENCES, TABLES } from "./fixtures.js";

let pg: TestPostgres;
const provider = new FakeProvider();
let off: string | null = null;

const texts = (): TouchTexts => ({
  db: pg.db,
  main: pg.db,
  off,
  sequences: SEQUENCES,
  senderName: "Test Co",
  bookingLink: null,
  bookings: null,
});
const step = touchStep(() => texts());

const at = (o: Partial<StepAt> = {}): StepAt => ({
  client: null,
  workflow: "keep_warm",
  node: "follow.text1",
  with: {},
  template: { kind: "sms", system: "texts", name: "follow-up#1" },
  part: "follow_up",
  ...o,
});
const lead = (id: number, data: Record<string, unknown> = {}): SpineEvent => ({
  subject: `lead:sms:${id}`,
  kind: "lead",
  data: { contactId: id, ...data },
});

async function contact(o: Partial<typeof smsContacts.$inferInsert> = {}): Promise<number> {
  const [n] = await pg.db.select().from(smsNumbers).limit(1);
  const [c] = await pg.db
    .insert(smsContacts)
    .values({
      e164: `+1212555${String(Math.floor(Math.random() * 9000) + 1000)}`,
      sourceKind: "form",
      sourceRef: String(Math.random()),
      basis: "opt_in",
      name: "dana smith",
      numberId: n?.id ?? null,
      state: "finished",
      ...o,
    })
    .returning({ id: smsContacts.id });
  return c?.id as number;
}

const queued = () => pg.db.select().from(smsMessages).where(eq(smsMessages.kind, "follow_up"));

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [...TABLES, "reach_messages", "reach_contacts", "clients"]);
  await numbers(pg.db, provider, ["+15550000000"]);
  off = null;
});

describe("a follow-up text", () => {
  it("queues the node's default copy once, kind follow_up, and passes the lead on", async () => {
    const id = await contact();
    const out = await step("lead", lead(id), at());
    expect(out).toEqual([
      {
        port: "sent",
        event: expect.objectContaining({
          data: expect.objectContaining({
            follow: {
              part: "follow_up",
              node: "follow.text1",
              channel: "text",
              did: "queued",
              why: null,
            },
          }),
        }),
      },
    ]);
    await step("lead", lead(id), at());
    const rows = await queued();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      state: "queued",
      ref: "keep_warm/follow.text1",
      template: "follow-up#1",
    });
    expect(rows[0]?.body).toMatch(/^Hi Dana, Test Co here\./);
  });

  it("records would send, and queues nothing, with the global gate or the client's flag off", async () => {
    const id = await contact();
    off = "WREN_SMS_LIVE is off";
    const [o1] = await step("lead", lead(id), at());
    expect(o1?.event.data.follow).toMatchObject({ did: "would_send", why: "WREN_SMS_LIVE is off" });
    off = null;
    await pg.db.insert(clients).values({ id: "acme", name: "Acme", database: "wren_client_acme" });
    const [o2] = await step("lead", lead(id), at({ client: "acme" }));
    expect(o2?.event.data.follow).toMatchObject({
      did: "would_send",
      why: "sends are off for this client",
    });
    expect(await queued()).toEqual([]);
    // On for Nurture is not on for Follow-up.
    await pg.db
      .update(clients)
      .set({ sends: ["nurture"] })
      .where(eq(clients.id, "acme"));
    const [o3] = await step("lead", lead(id), at({ client: "acme" }));
    expect(o3?.event.data.follow).toMatchObject({ did: "would_send" });
    await pg.db
      .update(clients)
      .set({ sends: ["follow_up"] })
      .where(eq(clients.id, "acme"));
    const [o4] = await step("lead", lead(id), at({ client: "acme" }));
    expect(o4?.event.data.follow).toMatchObject({ did: "queued" });
  });

  it("never texts someone who didn't ask, and answers for someone who replied", async () => {
    const cold = await contact({ sourceKind: "tel_link", basis: "published" });
    const [o1] = await step("lead", lead(cold), at());
    expect(o1?.event.data.follow).toMatchObject({
      did: "skipped",
      why: "never asked to be texted",
    });
    const replied = await contact({ state: "replied" });
    expect(await step("lead", lead(replied), at())).toEqual([
      expect.objectContaining({
        port: "replied",
        event: expect.objectContaining({ kind: "reply" }),
      }),
    ]);
    // A Wait let them go on an answer: out by replied, whatever the tables say.
    const quiet = await contact();
    const [o3] = await step("lead", lead(quiet, { happened: { kind: "reply" } }), at());
    expect(o3?.port).toBe("replied");
    expect(await queued()).toEqual([]);
  });

  it("finds a DM lead's text thread through the person, and a reply on one frees the other", async () => {
    const firm = await company(pg.db, "Acme Plumbing");
    const [p] = (await pg.db.execute(sql`INSERT INTO people
      (company_id, full_name, is_compliance, origin, origin_ref, raw)
      VALUES (${firm}, 'Dana Smith', false, 'manual', 'test', '{}'::jsonb) RETURNING id`)) as unknown as {
      id: number;
    }[];
    const text = await contact({ companyId: firm, personId: p?.id ?? null });
    const [dm] = (await pg.db.execute(sql`INSERT INTO reach_contacts
      (platform, handle, url, found_in, company_id, person_id, state)
      VALUES ('linkedin', 'dana-smith', 'https://linkedin.test/in/dana-smith', 'manual', ${firm},
        ${p?.id}, 'finished') RETURNING id`)) as unknown as { id: number }[];
    const dmLead: SpineEvent = { subject: `lead:reach:${dm?.id}`, kind: "lead", data: {} };
    const [o] = await step("lead", dmLead, at());
    expect(o?.event.data.follow).toMatchObject({ did: "queued" });
    expect((await queued())[0]?.contactId).toBe(text);
    expect((await leadThreads(pg.db, [`reach:${dm?.id}`])).sort()).toEqual(
      [`reach:${dm?.id}`, `sms:${text}`].sort(),
    );
  });

  it("the sender skips a queued follow-up once they replied, and sends the rest (to the fake)", async () => {
    const replied = await contact();
    const quiet = await contact();
    await step("lead", lead(replied), at());
    await step("lead", lead(quiet), at());
    // Due before the test's clock, in texting hours.
    await pg.db.update(smsMessages).set({ dueAt: new Date(OPEN.getTime() - 60_000) });
    await pg.db.update(smsContacts).set({ state: "replied" }).where(eq(smsContacts.id, replied));
    const opts = {
      provider,
      policy: POLICY,
      sequences: SEQUENCES,
      senderName: "Test Co",
      live: false,
      now: OPEN,
    };
    const stats = await tick(pg.db, opts);
    expect(stats).toMatchObject({ due: 2, skipped: 1, sent: 1 });
    const rows = await queued();
    expect(rows.find((r) => r.contactId === replied)?.state).toBe("skipped");
    expect(rows.find((r) => r.contactId === quiet)?.state).toBe("sent");
  });
});
