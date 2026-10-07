/**
 * Speed to lead's first text, end to end on a Restate test environment: a hook post with the
 * lead's form → the run → the first text queued within a minute (live on), or "would send" with
 * nothing queued (live off). Synthetic leads and a fake carrier; nothing leaves.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { addHook, makeSpine, SPINE } from "@wren/core/spine";
import { startTestRestate } from "@wren/core/testing";
import { defineWorkflow } from "@wren/core/workflows";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeBookings } from "../../src/bookings.js";
import { SMS_COMPONENTS } from "../../src/components.js";
import { tick } from "../../src/deliver.js";
import { touch } from "../../src/follow.js";
import { FakeProvider } from "../../src/provider.js";
import { smsContacts, smsMessages, speedRuns } from "../../src/schema.js";
import { firstText, firstTextStep, SPEED, SPEED_SEQUENCES } from "../../src/speed.js";
import { fillTemplates, numbers, POLICY, TABLES } from "./fixtures.js";

let pg: TestPostgres;
let env: RestateTestEnvironment;
const provider = new FakeProvider();
const looked: string[] = [];
const lookup = provider.lookup.bind(provider);
provider.lookup = async (e164) => {
  looked.push(e164);
  return lookup(e164);
};
let live = true;
const nudged: string[] = [];
const ingress = () => clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));

const FLOW = defineWorkflow({
  id: "speed_test",
  stage: "follow",
  name: "Speed test",
  blurb: "The first text only.",
  icon: "clock",
  for: "client",
  in: [{ id: "forms", label: "new leads", kind: "form" }],
  nodes: [{ id: "text", uses: "sms.forms" }],
  wires: [{ from: "in.forms", to: "text.forms", via: "events" }],
});

const WORDS = {
  [`${SPEED}#1`]: "hi {first_name|there}, {sender} here, thanks for asking. reply STOP to opt out",
  [`${SPEED}#2`]: "{sender} again, still want a call? {booking_link|reply here}",
  [`${SPEED}#3`]: "{sender} here, one more nudge",
  [`${SPEED}#4`]: "{sender}, last one from me",
};

const texts = () => ({
  db: pg.db,
  live,
  why: live ? null : "WREN_SMS_LIVE is off",
  policy: POLICY,
  provider,
  senderName: "Test Co",
  bookingLink: null,
  nudge: async (key: string) => {
    nudged.push(key);
  },
});

beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [
      makeSpine({
        main: pg.db,
        clientDb: () => pg.db,
        workflows: [FLOW],
        components: SMS_COMPONENTS,
        steps: { "sms.forms": firstTextStep(async () => texts()) },
        rule: async () => false,
      }),
    ],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [...TABLES, "speed_runs", "hooks", "events", "enrollments"]);
  await fillTemplates(pg.db, WORDS);
  await numbers(pg.db, provider, ["+13125550100"]);
  looked.length = 0;
  nudged.length = 0;
  provider.sent.length = 0;
  live = true;
});

type Door = {
  hook: (
    ctx: unknown,
    req: { token: string; payload: unknown },
  ) => Promise<{ status: number; subject?: string; error?: string }>;
};

async function post(payload: unknown) {
  const token = await addHook(pg.db, {
    name: "site form",
    client: null,
    workflow: FLOW.id,
    input: "forms",
    subject: "contact.email",
    fields: { name: "contact.full_name", phone: "contact.cell", consent: "agree_sms" },
  });
  // The phone Worker's call for `POST /hooks/<token>`.
  return ingress().serviceClient<Door>(SPINE).hook({ token, payload });
}

const LEAD = {
  contact: { full_name: "Ada Test", cell: "(212) 555-0187", email: "ada@example.test" },
  agree_sms: "yes",
  utm_source: "site",
};

async function until<T>(read: () => Promise<T | undefined>, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await read();
    if (got !== undefined) return got;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe("speed to lead, first text", () => {
  it("a hook post queues the first text within a minute, and the sender sends it", async () => {
    const t0 = Date.now();
    expect(await post(LEAD)).toMatchObject({ status: 202, subject: "form:ada@example.test" });
    const msg = await until(async () => (await pg.db.select().from(smsMessages))[0]);
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(msg).toMatchObject({ state: "queued", step: 1, toE164: "+12125550187" });
    expect(msg.body).toContain("hi Ada, Test Co here");

    const [run] = await pg.db.select().from(speedRuns);
    expect(run).toMatchObject({
      workflow: FLOW.id,
      subject: "form:ada@example.test",
      name: "Ada Test",
      e164: "+12125550187",
      consent: true,
      source: "site",
      firstTouch: "queued",
      firstTouchAt: null,
      smsContactId: msg.contactId,
    });
    const [contact] = await pg.db.select().from(smsContacts);
    expect(contact).toMatchObject({ sourceKind: "hook", basis: "opt_in", sequence: SPEED });
    expect(looked).toEqual(["+12125550187"]);
    expect(nudged).toEqual([`speed:${FLOW.id}:${run?.id}`]);

    // The sender's pass, at 14:00 ET the next day: sent, and the run's first touch with it.
    const now = new Date(Date.now() + 86_400_000);
    now.setUTCHours(18, 0, 0, 0);
    await tick(pg.db, {
      provider,
      policy: POLICY,
      live: false,
      sequences: new Map(SPEED_SEQUENCES.map((s) => [s.name, s])),
      senderName: "Test Co",
      now,
    });
    expect(provider.sent).toHaveLength(1);
    const [after] = await pg.db.select().from(speedRuns);
    expect(after).toMatchObject({ firstTouch: "sent", firstTouchAt: now });
  });

  it("with texts off, the run says would send and nothing more happens", async () => {
    live = false;
    const lead = { ...LEAD, contact: { ...LEAD.contact, email: "cy@example.test" } };
    expect(await post(lead)).toMatchObject({ status: 202, subject: "form:cy@example.test" });
    const run = await until(async () => (await pg.db.select().from(speedRuns))[0]);
    expect(run).toMatchObject({
      firstTouch: "would_send",
      firstTouchDetail: "WREN_SMS_LIVE is off",
      smsContactId: null,
    });
    expect(run.firstTouchAt).not.toBeNull();
    expect(await pg.db.select().from(smsContacts)).toEqual([]);
    expect(await pg.db.select().from(smsMessages)).toEqual([]);
    expect(looked).toEqual([]);
    expect(nudged).toEqual([]);
  });
});

describe("firstText", () => {
  const r = (lead: Partial<Parameters<typeof firstText>[1]["lead"]>, subject = "s1") => ({
    workflow: "w",
    subject,
    leadAt: new Date(),
    lead: {
      name: "Bo Test",
      phone: "(212) 555-0101",
      email: "bo@example.test",
      consent: true,
      consentDetail: "ticked the box",
      source: "site",
      zone: null,
      ...lead,
    },
  });

  it("no consent: no text, said why", async () => {
    const got = await firstText(pg.db, r({ consent: false }), texts(), new Date());
    expect(got.contactId).toBeNull();
    expect(got.run).toMatchObject({ firstTouch: "no_consent" });
    expect(await pg.db.select().from(smsContacts)).toEqual([]);
  });

  it("no phone, or one the fleet can't text", async () => {
    expect((await firstText(pg.db, r({ phone: null }), texts(), new Date())).run).toMatchObject({
      firstTouch: "no_phone",
      firstTouchDetail: "no phone",
    });
    expect(
      (await firstText(pg.db, r({ phone: "12" }, "s2"), texts(), new Date())).run,
    ).toMatchObject({ firstTouch: "no_phone" });
  });

  it("an empty template enrolls no one", async () => {
    await pg.db.delete(smsContacts);
    await truncate(pg.db, ["templates", "template_versions"]);
    const got = await firstText(pg.db, r({}), texts(), new Date());
    expect(got.run).toMatchObject({ firstTouch: "refused" });
    expect(got.run.firstTouchDetail).toMatch(/speed-to-lead#1 is empty/);
  });

  it("a retry finds the first run and queues nothing more", async () => {
    const one = await firstText(pg.db, r({}), texts(), new Date());
    const two = await firstText(pg.db, r({}), texts(), new Date());
    expect(two.run.id).toBe(one.run.id);
    expect(two.contactId).toBe(one.contactId);
    expect(await pg.db.select().from(smsMessages)).toHaveLength(1);
    const [c] = await pg.db
      .select()
      .from(smsContacts)
      .where(eq(smsContacts.id, one.contactId as number));
    expect(c?.state).toBe("enrolled");
  });
});

describe("the follow-up", () => {
  const SEQS = new Map(SPEED_SEQUENCES.map((q) => [q.name, q]));
  const lead = {
    name: "Di Test",
    phone: "(212) 555-0102",
    email: "di@example.test",
    consent: true,
    consentDetail: "ticked the box",
    source: "site",
    zone: null,
  };
  const start = async () => {
    const got = await firstText(
      pg.db,
      { workflow: "w", subject: "form:di", lead, leadAt: new Date() },
      texts(),
      new Date(),
    );
    return got.contactId as number;
  };

  it("a booking ends it, and the run shows booked", async () => {
    const id = await start();
    const bookings = new FakeBookings(["di@example.test"]);
    const now = new Date();
    expect(
      await touch(pg.db, id, 2, { sequences: SEQS, senderName: "Test Co", bookings, now }),
    ).toBe("booked");
    const [c] = await pg.db.select().from(smsContacts).where(eq(smsContacts.id, id));
    expect(c).toMatchObject({ state: "finished", stateReason: "booked a call on fake" });
    const [run] = await pg.db.select().from(speedRuns);
    expect(run?.bookedAt).toEqual(now);
  });

  it("a lead in an active email sequence gets no follow-up texts", async () => {
    const id = await start();
    const [firm] = (await pg.db.execute(
      sql`INSERT INTO companies (domain) VALUES ('di.example') RETURNING id`,
    )) as unknown as { id: number }[];
    const f = (firm as { id: number }).id;
    await pg.db.execute(sql`
      INSERT INTO enrollments (niche, sequence_name, sequence_snapshot, offer, state, company_id,
        kind, to_email, sender)
      VALUES ('test', 's', '{}', 'o', 'active', ${f}, 'role_inbox', 'hi@di.example', 'me@wren.example')`);
    await pg.db.update(smsContacts).set({ companyId: f }).where(eq(smsContacts.id, id));
    const opts = { sequences: SEQS, senderName: "Test Co", bookings: null, now: new Date() };
    expect(await touch(pg.db, id, 2, opts)).toBe("ended");
    const [c] = await pg.db.select().from(smsContacts).where(eq(smsContacts.id, id));
    expect(c?.stateReason).toMatch(/active email sequence/);
    expect(await pg.db.select().from(smsMessages)).toHaveLength(1);
  });

  it("no booking, no other sequence: the next text is queued", async () => {
    const id = await start();
    const opts = {
      sequences: SEQS,
      senderName: "Test Co",
      bookings: new FakeBookings(),
      now: new Date(),
    };
    expect(await touch(pg.db, id, 2, opts)).toBe("queued");
    expect(await pg.db.select().from(smsMessages)).toHaveLength(2);
  });
});
