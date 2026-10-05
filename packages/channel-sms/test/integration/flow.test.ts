/**
 * The SMS channel end to end on Postgres, with the fake provider and fixed
 * clocks: lift → enroll → send → receipts → reply / STOP → health → stats,
 * plus the failure paths (crash mid-send, try-later, carrier opt-out, the live
 * gate, quiet hours, caps).
 */
import { activeSuppressionOf, addSuppression } from "@wren/core";
import { mayMarket } from "@wren/core/marketing";
import { consentEvents, topics } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { archivePages, memoryPageStore } from "@wren/research/pages";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { classifyReplies } from "../../src/classify.js";
import { addContact, startThread } from "../../src/contacts.js";
import { queueManual, reconcile, tick } from "../../src/deliver.js";
import { enroll } from "../../src/enroll.js";
import { applyEvent } from "../../src/events.js";
import { checkHealth, DEFAULT_HEALTH } from "../../src/health.js";
import { fleetDay } from "../../src/policy.js";
import { poolToday, syncNumbers } from "../../src/pool.js";
import { FakeProvider, NoProvider, type SmsEvent } from "../../src/provider.js";
import { FakePusher, pushOne, subscribe } from "../../src/push.js";
import { watchRegistration } from "../../src/registration.js";
import {
  smsContacts,
  smsMessages,
  smsNumbers,
  smsPushSubscriptions,
  smsTemplates,
} from "../../src/schema.js";
import { smsStats } from "../../src/stats.js";
import { getThread, listThreads } from "../../src/threads.js";
import {
  company,
  fillTemplates,
  lift,
  notes,
  numbers,
  OPEN,
  POLICY,
  SEQ,
  SEQUENCES,
  SHUT,
  TABLES,
} from "./fixtures.js";

let pg: TestPostgres;
let provider: FakeProvider;
const db = () => pg.db;

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
  await fillTemplates(pg.db);
  provider = new FakeProvider();
});

const tickAt = (now: Date, extra: Partial<Parameters<typeof tick>[1]> = {}) =>
  tick(db(), {
    provider,
    policy: POLICY,
    live: false,
    sequences: SEQUENCES,
    senderName: "William",
    now,
    ...extra,
  });
const enrollAt = (now: Date, limit = 10, policy = POLICY) =>
  enroll(db(), {
    sequence: SEQ,
    policy,
    provider,
    senderName: "William",
    heldNiches: ["sec_ria"],
    limit,
    now,
  });
const event = (e: SmsEvent) =>
  applyEvent(db(), { ...e, at: e.kind === "ignored" ? undefined : e.at.toISOString() }, e, {
    provider: "fake",
    now: OPEN,
  });
const messages = () => db().select().from(smsMessages).orderBy(asc(smsMessages.id));
const contact = async (e164: string) =>
  (await db().select().from(smsContacts).where(eq(smsContacts.e164, e164)))[0];

describe("lift", () => {
  it("stores published numbers with their page, skips held niches, parks toll-free", async () => {
    await company(db(), "Acme", {
      html: '<a href="tel:+12125550187">call</a>',
      text: "or 1-800-555-0199",
    });
    await company(db(), "Advisors", { niche: "sec_ria", html: '<a href="tel:+12125550142">x</a>' });
    const stats = await lift(db(), { heldNiches: ["sec_ria"] });
    expect(stats).toMatchObject({ added: 2, tollFree: 1, companies: 1 });
    const acme = await contact("+12125550187");
    expect(acme).toMatchObject({
      basis: "published",
      sourceKind: "tel_link",
      state: "new",
      niche: "agencies",
    });
    expect(acme?.sourceUrl).toContain("acme.test");
    expect(await contact("+18005550199")).toMatchObject({
      state: "unreachable",
      lineType: "toll_free",
    });
    expect(await contact("+12125550142")).toBeUndefined();
    expect((await lift(db(), { heldNiches: ["sec_ria"] })).added).toBe(0); // re-run is a no-op
  });

  it("reads an archived page's kept tel targets, never the bucket", async () => {
    await company(db(), "Acme", { html: '<a href="tel:+12125550187">call</a>', text: "hi" });
    const store = memoryPageStore();
    await archivePages(db(), store, { before: new Date(Date.now() + 86_400_000) });
    expect(await lift(db(), { heldNiches: [] })).toMatchObject({ added: 1 });
    expect(await contact("+12125550187")).toMatchObject({ sourceKind: "tel_link" });
  });
});

describe("manual contacts", () => {
  it("need a reason, dedupe by number, and enroll only when the campaign covers their basis", async () => {
    await expect(
      addContact(db(), { phone: "212 555 0101", basis: "opt_in", why: " " }),
    ).rejects.toThrow(/consent record/);
    await expect(addContact(db(), { phone: "12", basis: "opt_in", why: "x" })).rejects.toThrow(
      /not a US or Canadian number/,
    );
    const a = await addContact(db(), {
      phone: "(212) 555-0101",
      basis: "opt_in",
      why: "asked on a call 2026-09-27",
    });
    expect(a.created).toBe(true);
    expect(a.contact).toMatchObject({ e164: "+12125550101", sourceKind: "manual", state: "new" });
    expect(
      (await addContact(db(), { phone: "+12125550101", basis: "opt_in", why: "again" })).created,
    ).toBe(false);
    await numbers(db(), provider, ["+13125550001"]);
    expect((await enrollAt(SHUT, 10, { ...POLICY, bases: ["published"] })).enrolled).toBe(0);
    expect((await enrollAt(SHUT, 10, { ...POLICY, bases: ["opt_in"] })).enrolled).toBe(1);
  });
});

describe("new thread from the app", () => {
  it("needs a reason and a pool number, never enrolls, and reuses a running thread", async () => {
    const start = (phone: string, why = "asked on a call 2026-09-30") =>
      startThread(db(), { phone, why, body: "hi, William here", now: OPEN, policy: POLICY });
    await expect(start("(212) 555-0101")).rejects.toThrow(/no pool number texts US/);
    await numbers(db(), provider, ["+13125550001"]);
    await expect(start("(212) 555-0101", " ")).rejects.toThrow(/consent record/);
    const first = await start("(212) 555-0101");
    const [c] = await db().select().from(smsContacts);
    expect(c).toMatchObject({
      id: first.contactId,
      sourceKind: "manual",
      basis: "opt_in",
      basisDetail: "asked on a call 2026-09-30",
      state: "finished",
      stateReason: "started by hand in the app",
    });
    expect(c?.numberId).not.toBeNull();
    expect((await enrollAt(OPEN, 10)).considered).toBe(0);
    await tickAt(OPEN);
    expect(provider.sent.map((m) => m.text)).toEqual(["hi, William here"]);
    // The same phone again: the text joins its thread, no reason needed.
    const again = await start("+12125550101", "");
    expect(again.contactId).toBe(first.contactId);
    expect(await db().select().from(smsContacts)).toHaveLength(1);
  });
});

describe("reply alerts", () => {
  it("alerts every device on a reply or STOP, once, and drops a device that is gone", async () => {
    await numbers(db(), provider, ["+13125550001"]);
    const { contactId } = await startThread(db(), {
      phone: "+12125550101",
      why: "asked on a call 2026-09-30",
      body: "hi",
      now: OPEN,
      policy: POLICY,
    });
    const keys = { p256dh: "p", auth: "a" };
    await subscribe(db(), { endpoint: "https://push.example/phone", keys }, "w@wren");
    await subscribe(db(), { endpoint: "https://push.example/old", keys }, "w@wren");
    await expect(
      subscribe(db(), { endpoint: "http://push.example/x", keys }, "w@wren"),
    ).rejects.toThrow(/https/);
    const pusher = new FakePusher();
    pusher.gone.add("https://push.example/old");
    const inbound = (eventId: string, text: string) =>
      applyEvent(
        db(),
        {},
        {
          kind: "inbound",
          eventId,
          type: "message.received",
          messageId: eventId,
          from: "+12125550101",
          to: "+13125550001",
          text,
          at: OPEN,
        },
        { provider: "fake", now: OPEN, pusher },
      );
    await inbound("r1", "sure, call me tomorrow");
    await inbound("r1", "sure, call me tomorrow"); // the provider retried: no second alert
    expect(pusher.sent).toEqual([
      {
        endpoint: "https://push.example/phone",
        alert: {
          title: "(212) 555-0101",
          body: "sure, call me tomorrow",
          url: `/#/thread/${contactId}`,
          tag: `thread-${contactId}`,
        },
      },
    ]);
    const left = await db().select().from(smsPushSubscriptions);
    expect(left.map((s) => s.endpoint)).toEqual(["https://push.example/phone"]);
    expect(left[0]?.lastPushedAt).not.toBeNull();
    await inbound("r2", "STOP");
    await inbound("r3", "START");
    expect(pusher.sent.map((s) => s.alert.title)).toEqual([
      "(212) 555-0101",
      "(212) 555-0101 opted out",
    ]);
    const alert = { title: "t", body: "b", url: "/", tag: "t" };
    expect(await pushOne(db(), pusher, "https://push.example/old", alert)).toEqual({
      pushed: false,
      error: "this device is not subscribed",
    });
  });
});

describe("US and Canada", () => {
  const CAMPAIGN = "camp-1";
  const US = "+13125550100";
  const CA = "+14165550100";
  beforeEach(async () => {
    await numbers(db(), provider, [US, CA], "2026-09-01", { registered: false });
    await company(db(), "Acme", { html: '<a href="tel:+12125550187">x</a>' });
    await lift(db(), { heldNiches: [] });
    await addContact(db(), { phone: "647 555 0101", basis: "opt_in", why: "form, 2026-09-28" });
  });

  it("texts each country from its own number; US waits for the campaign, then attaches itself", async () => {
    expect(await enrollAt(OPEN)).toMatchObject({ enrolled: 2 });
    const numberOf = async (e164: string) =>
      (await db().select().from(smsNumbers).where(eq(smsNumbers.e164, e164)))[0];
    expect((await contact("+16475550101"))?.numberId).toBe((await numberOf(CA))?.id);
    expect((await contact("+12125550187"))?.numberId).toBe((await numberOf(US))?.id);
    // Canada needs no 10DLC; the US number holds its texts.
    expect(await tickAt(OPEN)).toMatchObject({ sent: 1, unreachable: 1 });
    expect(provider.sent.map((m) => [m.from, m.to])).toEqual([[CA, "+16475550101"]]);

    const watch = (now = OPEN) => watchRegistration(db(), provider, CAMPAIGN, now);
    expect(await watch()).toMatchObject({
      campaign: { status: "pending" },
      asked: [],
      registered: [],
    });
    provider.registration.campaignState = { status: "approved", raw: "MNO_ACCEPTED", detail: null };
    expect(await watch()).toMatchObject({ asked: [US], pending: [], registered: [] });
    expect(await watch()).toMatchObject({ asked: [], pending: [US] });
    provider.registration.settle();
    const later = new Date(OPEN.getTime() + 86_400_000);
    expect(await watch(later)).toMatchObject({ registered: [US] });
    expect(await numberOf(US)).toMatchObject({
      registeredAt: later,
      rampStartedOn: fleetDay(later),
    });
    expect(await watch(later)).toMatchObject({ skipped: "no US number waits", campaign: null });
    expect(await tickAt(later)).toMatchObject({ sent: 1, unreachable: 0 });
    expect(provider.sent.at(-1)).toMatchObject({ from: US, to: "+12125550187" });
  });

  it("a rejected campaign or another campaign's number never registers", async () => {
    provider.registration.campaignState = {
      status: "rejected",
      raw: "MNO_REJECTED",
      detail: "opt-in unclear",
    };
    expect(await watchRegistration(db(), provider, CAMPAIGN, OPEN)).toMatchObject({
      campaign: { status: "rejected" },
      asked: [],
      registered: [],
    });
    provider.registration.assignments.set(US, {
      status: "assigned",
      campaignId: "other",
      detail: null,
    });
    expect((await watchRegistration(db(), provider, CAMPAIGN, OPEN)).failed).toEqual([
      `${US}: on another campaign (other)`,
    ]);
    expect(await watchRegistration(db(), provider, null, OPEN)).toMatchObject({
      skipped: expect.stringMatching(/no campaign/),
    });
  });

  it("an operator reply waits on an unregistered number but is refused across the border", async () => {
    await enrollAt(OPEN);
    const us = await contact("+12125550187");
    await queueManual(db(), {
      policy: POLICY,
      contactId: us?.id as number,
      body: "by hand",
      now: OPEN,
    });
    expect((await tickAt(OPEN)).unreachable).toBeGreaterThan(0);
    const ca = await contact("+16475550101");
    await db()
      .update(smsContacts)
      .set({ numberId: us?.numberId })
      .where(eq(smsContacts.id, ca?.id as number));
    await expect(
      queueManual(db(), {
        policy: POLICY,
        contactId: ca?.id as number,
        body: "by hand",
        now: OPEN,
      }),
    ).rejects.toThrow(/US number; \+16475550101 is CA/);
  });
});

describe("templates", () => {
  beforeEach(async () => {
    await numbers(db(), provider, ["+13125550100"]);
    await company(db(), "Acme Studio", { html: '<a href="tel:+12125550187">x</a>' });
    await lift(db(), { heldNiches: [] });
  });

  it("enroll refuses until every step is filled, and spends nothing", async () => {
    await db().delete(smsTemplates).where(eq(smsTemplates.key, "recruiting-sms#2"));
    await expect(enrollAt(OPEN)).rejects.toThrow(/fill recruiting-sms#2 first/);
    expect(await contact("+12125550187")).toMatchObject({ state: "new", lookedUpAt: null });
    expect(await messages()).toHaveLength(0);
  });

  it("a queued text goes out in the words saved now, and an emptied step ends the thread", async () => {
    await enrollAt(OPEN);
    await fillTemplates(db(), {
      "recruiting-sms#1": "{first_name|hey}, {sender} again. STOP ends these",
    });
    await tickAt(OPEN);
    expect(provider.sent[0]?.text).toBe("hey, William again. STOP ends these");
    expect((await messages())[0]?.body).toBe("hey, William again. STOP ends these");
    await db().delete(smsTemplates).where(eq(smsTemplates.key, "recruiting-sms#2"));
    expect(await tickAt(new Date(OPEN.getTime() + 3 * 86_400_000))).toMatchObject({
      sent: 0,
      skipped: 1,
    });
    expect(provider.sent).toHaveLength(1);
    expect(await contact("+12125550187")).toMatchObject({
      state: "finished",
      stateReason: "template recruiting-sms#2 is empty",
    });
    expect((await messages())[1]?.state).toBe("skipped");
  });
});

describe("enroll → send → receipts → reply", () => {
  beforeEach(async () => {
    await numbers(db(), provider, ["+13125550100", "+13125550101"]);
    await company(db(), "Acme Studio", { html: '<a href="tel:+12125550187">x</a>' });
    await company(db(), "Beta Co", {
      html: '<a href="tel:+12125550142">x</a>',
      timezone: "America/New_York",
    });
    await company(db(), "Gamma LLC", { html: '<a href="tel:+12125550111">x</a>' });
    provider.landlines.add("+12125550111");
    await lift(db(), { heldNiches: [] });
  });

  it("enrolls mobiles on balanced sticky numbers, parks landlines", async () => {
    const stats = await enrollAt(OPEN);
    expect(stats).toMatchObject({ enrolled: 2, lookedUp: 3, notTextable: 1 });
    expect(await contact("+12125550111")).toMatchObject({
      state: "unreachable",
      lineType: "landline",
    });
    const a = await contact("+12125550187");
    const b = await contact("+12125550142");
    expect(a?.numberId).not.toBe(b?.numberId); // balanced across the pool
    const [m] = await messages();
    expect(m).toMatchObject({ step: 1, state: "queued" });
    expect(m?.body).toBe("hi there, William here. saw Acme Studio. reply STOP to opt out");
  });

  it("sends inside the window only, queues step 2, applies receipts, stops on reply", async () => {
    await enrollAt(SHUT);
    expect(await tickAt(SHUT)).toMatchObject({ sent: 0, outOfWindow: 2 });
    const t = await tickAt(OPEN);
    expect(t).toMatchObject({ sent: 2 });
    expect(provider.sent.map((s) => s.to).sort()).toEqual(["+12125550142", "+12125550187"]);
    const sent = (await messages()).filter((m) => m.state === "sent");
    expect(sent).toHaveLength(2);
    const next = (await messages()).filter((m) => m.step === 2);
    expect(next).toHaveLength(2);
    expect(next[0]?.dueAt?.getTime()).toBe(OPEN.getTime() + 3 * 86_400_000);
    // Receipts, out of order: delivered first, then a late "sent" does not walk it back.
    const pid = sent[0]?.providerId as string;
    await event({
      kind: "status",
      eventId: "e1",
      type: "message.finalized",
      messageId: pid,
      status: "delivered",
      at: OPEN,
      code: null,
      detail: null,
      parts: 1,
      costUsd: 0.004,
    });
    await event({
      kind: "status",
      eventId: "e2",
      type: "message.sent",
      messageId: pid,
      status: "sent",
      at: OPEN,
      code: null,
      detail: null,
      parts: null,
      costUsd: null,
    });
    expect((await messages()).find((m) => m.providerId === pid)?.state).toBe("delivered");
    expect(
      (
        await event({
          kind: "status",
          eventId: "e1",
          type: "x",
          messageId: pid,
          status: "failed",
          at: OPEN,
          code: null,
          detail: null,
          parts: null,
          costUsd: null,
        })
      ).duplicate,
    ).toBe(true);
    // A reply stops the sequence.
    const to = sent[0]?.toE164 as string;
    const ours = (
      await db()
        .select()
        .from(smsNumbers)
        .where(eq(smsNumbers.id, sent[0]?.numberId as string))
    )[0]?.e164 as string;
    const r = await event({
      kind: "inbound",
      eventId: "e3",
      type: "message.received",
      messageId: "in1",
      from: to,
      to: ours,
      text: "sure, what's the price?",
      at: OPEN,
    });
    expect(r.outcome).toMatch(/^reply/);
    expect((await contact(to))?.state).toBe("replied");
    expect(
      (await messages()).find((m) => m.contactId === sent[0]?.contactId && m.step === 2)?.state,
    ).toBe("skipped");
    // Threads show it unread, newest first.
    const threads = await listThreads(db(), { filter: "unread" });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      e164: to,
      unread: 1,
      lastDirection: "in",
      lastBody: "sure, what's the price?",
    });
    const thread = await getThread(db(), threads[0]?.contactId as number, { now: OPEN, cap: 4 });
    expect(thread?.messages.map((m) => m.direction)).toEqual(["out", "in"]);
    expect(thread?.month).toEqual({ sent: 1, cap: 4 });
  });

  it("STOP suppresses on every channel, START lifts, no text follows", async () => {
    await enrollAt(OPEN);
    await tickAt(OPEN);
    const [first] = (await messages()).filter((m) => m.state === "sent");
    const to = first?.toE164 as string;
    const r = await event({
      kind: "inbound",
      eventId: "s1",
      type: "message.received",
      messageId: "in-stop",
      from: to,
      to: first?.fromE164 as string,
      text: "STOP",
      at: OPEN,
    });
    expect(r.outcome).toMatch(/^stop/);
    expect(await activeSuppressionOf(db(), "phone", to)).not.toBeNull();
    expect((await contact(to))?.state).toBe("opted_out");
    await expect(
      queueManual(db(), {
        policy: POLICY,
        contactId: first?.contactId as number,
        body: "sorry!",
        now: OPEN,
      }),
    ).rejects.toThrow(/opted out/);
    const later = await tickAt(new Date(OPEN.getTime() + 3 * 86_400_000));
    expect(provider.sent.filter((s) => s.to === to)).toHaveLength(1);
    expect(later.sent).toBe(1); // only the other contact's step 2
    await event({
      kind: "inbound",
      eventId: "s2",
      type: "message.received",
      messageId: "in-start",
      from: to,
      to: first?.fromE164 as string,
      text: "start",
      at: OPEN,
    });
    expect(await activeSuppressionOf(db(), "phone", to)).toBeNull();
  });

  it("a bare YES lifts an opt-out, and from anyone else is a reply", async () => {
    await enrollAt(OPEN);
    await tickAt(OPEN);
    const [a, b] = (await messages()).filter((m) => m.state === "sent");
    const inbound = (from: string, to: string, id: string, text: string) =>
      event({
        kind: "inbound",
        eventId: id,
        type: "message.received",
        messageId: `in-${id}`,
        from,
        to,
        text,
        at: OPEN,
      });
    const yes = await inbound(b?.toE164 as string, b?.fromE164 as string, "y0", "Yes!");
    expect(yes.outcome).toMatch(/^reply/);
    expect((await contact(b?.toE164 as string))?.state).toBe("replied");
    const to = a?.toE164 as string;
    await inbound(to, a?.fromE164 as string, "y1", "stop");
    expect(await activeSuppressionOf(db(), "phone", to)).not.toBeNull();
    expect((await inbound(to, a?.fromE164 as string, "y2", "yes")).outcome).toMatch(
      /^start: lifted/,
    );
    expect(await activeSuppressionOf(db(), "phone", to)).toBeNull();
  });

  it("a topic's keyword alone signs up with the text as proof, never lifting an opt-out", async () => {
    await db().insert(topics).values({
      name: "sms-deals",
      publicName: "Text deals",
      line: "A text when there's a deal.",
      channel: "sms",
      cadence: "now and then",
      keyword: "JOIN",
    });
    const say = (from: string, id: string, text: string) =>
      event({
        kind: "inbound",
        eventId: id,
        type: "message.received",
        messageId: `in-${id}`,
        from,
        to: "+13652428903",
        text,
        at: OPEN,
      });
    const fan = "+15550100101";
    expect((await say(fan, "k0", "join us")).outcome).toMatch(/^reply/);
    expect((await say(fan, "k1", " Join! ")).outcome).toMatch(/^keyword JOIN: signed up/);
    expect(
      await mayMarket(db(), { channel: "sms", address: fan, topic: "sms-deals", now: OPEN }),
    ).toMatchObject({
      send: true,
    });
    const [proof] = await db().select().from(consentEvents);
    expect(proof?.evidence).toMatchObject({ text: " Join! " });
    expect(proof?.by).toBe("subscriber");
    // An opted-out phone gets the consent recorded but stays unsendable until START.
    const gone = "+15550100102";
    await say(gone, "k2", "STOP");
    await say(gone, "k3", "JOIN");
    expect(
      await mayMarket(db(), { channel: "sms", address: gone, topic: "sms-deals", now: OPEN }),
    ).toMatchObject({
      send: false,
      why: "suppressed",
    });
  });

  it("a short-code text is kept and readable, with no contact made", async () => {
    const r = await event({
      kind: "inbound",
      eventId: "g1",
      type: "message.received",
      messageId: "in-g1",
      from: "22000",
      to: "+13652428903",
      text: "G-123456 is your Google verification code.",
      at: OPEN,
    });
    expect(r.duplicate).toBe(false);
    expect(r.outcome).toBe(
      "from 22000 (not a phone number): G-123456 is your Google verification code.",
    );
    expect(await contact("22000")).toBeUndefined();
  });

  it("one phone gets at most the month's texts, under any contact row", async () => {
    const policy = { ...POLICY, monthlyPerContact: 2 };
    await enrollAt(OPEN);
    await tickAt(OPEN, { policy });
    const c = await contact("+12125550187");
    const manual = (body: string, now = OPEN) =>
      queueManual(db(), { contactId: c?.id as number, body, now, policy });
    await manual("one more");
    expect((await tickAt(OPEN, { policy })).sent).toBe(1);
    await expect(manual("and another")).rejects.toThrow(
      /already got 2 texts in the last 31 days.*next can go 2026-10-30/,
    );
    // Step 2 comes due 3 days on and waits for room instead of sending.
    const later = new Date(OPEN.getTime() + 3 * 86_400_000);
    expect(await tickAt(later, { policy })).toMatchObject({ capped: 1 });
    const [step2] = (await messages()).filter((m) => m.contactId === c?.id && m.step === 2);
    expect(step2).toMatchObject({ state: "queued", dueAt: new Date("2026-10-30T18:00:00Z") });
    expect(provider.sent.filter((s) => s.to === c?.e164)).toHaveLength(2);
  });

  it("an operator reply goes out ahead of the queue, and after hours only to someone who just wrote", async () => {
    await enrollAt(OPEN);
    await tickAt(OPEN);
    const c = await contact("+12125550187");
    await queueManual(db(), {
      policy: POLICY,
      contactId: c?.id as number,
      body: "following up by hand",
      now: SHUT,
    });
    expect((await tickAt(SHUT)).sent).toBe(0); // quiet hours, they never wrote
    await event({
      kind: "inbound",
      eventId: "m1",
      type: "message.received",
      messageId: "in-m",
      from: c?.e164 as string,
      to: provider.sent[0]?.from as string,
      text: "hey who is this",
      at: SHUT,
    });
    expect((await tickAt(SHUT)).sent).toBe(1);
    expect(provider.sent.at(-1)?.text).toBe("following up by hand");
  });
});

describe("failure paths", () => {
  beforeEach(async () => {
    await numbers(db(), provider, ["+13125550100"]);
    await company(db(), "Acme", { html: '<a href="tel:+12125550187">x</a>' });
    await lift(db(), { heldNiches: [] });
    await enrollAt(OPEN);
  });

  it("a crash mid-send leaves unknown, never a resend", async () => {
    provider.explode.add("+12125550187");
    expect(await tickAt(OPEN)).toMatchObject({ unknown: 1, sent: 0 });
    provider.explode.clear();
    expect((await tickAt(OPEN)).sent).toBe(0);
    expect((await messages())[0]?.state).toBe("unknown");
    // A row left `sending` by a dead process turns unknown after the stale mark.
    await db()
      .update(smsMessages)
      .set({ state: "sending", attemptedAt: new Date(OPEN.getTime() - 20 * 60_000) });
    expect(await reconcile(db(), OPEN)).toBe(1);
  });

  it("try-later requeues; a carrier STOP block suppresses; a refusal ends the thread", async () => {
    provider.retry.add("+12125550187");
    expect(await tickAt(OPEN)).toMatchObject({ retried: 1 });
    expect((await messages())[0]).toMatchObject({ state: "queued" });
    provider.retry.clear();
    provider.reject.set("+12125550187", {
      code: "40300",
      detail: "Blocked due to STOP message",
      optedOut: true,
    });
    expect(await tickAt(new Date(OPEN.getTime() + 6 * 60_000))).toMatchObject({ failed: 1 });
    expect(await activeSuppressionOf(db(), "phone", "+12125550187")).not.toBeNull();
    expect((await contact("+12125550187"))?.state).toBe("opted_out");
  });

  it("the live gate holds a real provider back", async () => {
    const real = Object.assign(Object.create(FakeProvider.prototype), new FakeProvider(), {
      name: "telnyx",
    }) as FakeProvider;
    expect(await tickAt(OPEN, { provider: real })).toMatchObject({ gated: 1, sent: 0 });
    expect(real.sent).toHaveLength(0);
    expect(await tickAt(OPEN, { provider: real, live: true })).toMatchObject({ sent: 1 });
  });

  it("with no provider nothing is sent, looked up, synced or pinned", async () => {
    const none = new NoProvider();
    const due = (await messages()).filter((m) => m.state === "queued").length;
    expect(due).toBeGreaterThan(0);
    expect(await tickAt(OPEN, { provider: none, live: true })).toMatchObject({
      sent: 0,
      gated: due,
    });
    expect((await messages()).filter((m) => m.state === "queued")).toHaveLength(due);
    await addContact(db(), { phone: "+12125550199", basis: "opt_in", why: "test" });
    await expect(
      enroll(db(), {
        sequence: SEQ,
        policy: POLICY,
        provider: none,
        senderName: "William",
        heldNiches: [],
        limit: 5,
        now: OPEN,
      }),
    ).rejects.toThrow(/no SMS provider/);
    expect(await contact("+12125550199")).toMatchObject({
      state: "new",
      lookedUpAt: null,
      numberId: null,
    });
    await expect(syncNumbers(db(), none, POLICY, OPEN)).rejects.toThrow(/no SMS provider/);
  });

  it("a suppression made on another channel stops the text", async () => {
    await addSuppression(db(), { kind: "phone", value: "+12125550187", reason: "manual" });
    expect(await tickAt(OPEN)).toMatchObject({ skipped: 1, sent: 0 });
    expect((await contact("+12125550187"))?.state).toBe("opted_out");
  });
});

describe("pool, caps, health, stats", () => {
  it("never passes a number's ramped cap or the campaign cap", async () => {
    await numbers(db(), provider, ["+13125550100"], "2026-09-29"); // ramp day one
    for (let i = 0; i < 25; i += 1) {
      await company(db(), `Co${i}`, { html: `<a href="tel:+1212555${String(1000 + i)}">x</a>` });
    }
    await lift(db(), { heldNiches: [] });
    await enrollAt(OPEN, 25, { ...POLICY, rampStart: 3 });
    const policy = { ...POLICY, rampStart: 3 };
    let sent = 0;
    for (let i = 0; i < 6; i += 1)
      sent += (await tickAt(new Date(OPEN.getTime() + i * 1000), { policy })).sent;
    expect(sent).toBe(3);
    const pool = await poolToday(db(), policy, OPEN);
    expect(pool).toMatchObject({ sentToday: 3, remaining: 0 });
    const capped = { ...POLICY, rampStart: 50, dailyCap: 2 };
    expect((await tickAt(new Date(OPEN.getTime() + 86_400_000), { policy: capped })).sent).toBe(1);
  });

  it("syncs the pool without growing past its size", async () => {
    provider.numbers = ["+13125550100", "+13125550101", "+13125550102"].map((e164, i) => ({
      e164,
      providerId: `p${i}`,
    }));
    const s = await syncNumbers(db(), provider, { ...POLICY, maxNumbers: 2 }, OPEN);
    expect(s).toMatchObject({ added: ["+13125550100", "+13125550101"], overCap: ["+13125550102"] });
    provider.numbers = provider.numbers.slice(1);
    expect((await syncNumbers(db(), provider, { ...POLICY, maxNumbers: 2 }, OPEN)).retired).toEqual(
      ["+13125550100"],
    );
  });

  it("pauses a failing number and warns on a low balance", async () => {
    await numbers(db(), provider, ["+13125550100"]);
    for (let i = 0; i < 40; i += 1) {
      await company(db(), `Co${i}`, { html: `<a href="tel:+1212555${String(2000 + i)}">x</a>` });
    }
    await lift(db(), { heldNiches: [] });
    await enrollAt(OPEN, 40);
    for (let i = 0; i < 40; i += 1) await tickAt(new Date(OPEN.getTime() + i * 1000));
    const sent = (await messages()).filter((m) => m.state === "sent");
    for (const [i, m] of sent.entries()) {
      const failed = i < 10;
      await event({
        kind: "status",
        eventId: `h${i}`,
        type: "message.finalized",
        messageId: m.providerId as string,
        status: failed ? "failed" : "delivered",
        at: OPEN,
        code: failed ? "40002" : null,
        detail: failed ? "blocked as spam" : null,
        parts: 1,
        costUsd: 0.004,
      });
    }
    provider.usd = 2;
    const n = notes();
    const report = await checkHealth(db(), {
      now: OPEN,
      policy: DEFAULT_HEALTH,
      provider,
      notifier: n.notifier,
    });
    expect(report.paused.map((p) => p.e164)).toEqual(["+13125550100"]);
    expect(report.warnings[0]).toMatch(/balance \$2\.00/);
    expect(n.seen.map((s) => s.title)).toEqual(["SMS number (312) 555-0100 paused", "SMS"]);
    expect((await tickAt(new Date(OPEN.getTime() + 3600_000))).sent).toBe(0); // paused: nothing goes
    const stats = await smsStats(db(), { since: new Date(OPEN.getTime() - 86_400_000) });
    expect(stats.delivery.k).toBe(30);
    expect(stats.delivery.n).toBe(40);
    expect(stats.costUsd).toBeCloseTo(0.16);
  });

  it("labels replies with a grounded LLM call, and a grounded opt-out suppresses", async () => {
    await numbers(db(), provider, ["+13125550100"]);
    await company(db(), "Acme", { html: '<a href="tel:+12125550187">x</a>' });
    await company(db(), "Beta", { html: '<a href="tel:+12125550142">x</a>' });
    await lift(db(), { heldNiches: [] });
    await enrollAt(OPEN);
    await tickAt(OPEN);
    await tickAt(new Date(OPEN.getTime() + 1000));
    await event({
      kind: "inbound",
      eventId: "c1",
      type: "message.received",
      messageId: "i1",
      from: "+12125550187",
      to: "+13125550100",
      text: "Yes, send me pricing",
      at: OPEN,
    });
    await event({
      kind: "inbound",
      eventId: "c2",
      type: "message.received",
      messageId: "i2",
      from: "+12125550142",
      to: "+13125550100",
      text: "please never contact us again",
      at: OPEN,
    });
    const llm = new FakeLlm({
      respond: (p) =>
        p.includes("send me pricing")
          ? '{"disposition":"interested","evidence":"send me pricing","confidence":0.9}'
          : '{"disposition":"opt_out","evidence":"never contact us again","confidence":0.95}',
    });
    const s = await classifyReplies(db(), llm, { now: OPEN });
    expect(s).toMatchObject({ selected: 2, labelled: 2, optOuts: 1 });
    expect(await activeSuppressionOf(db(), "phone", "+12125550142")).not.toBeNull();
    expect((await classifyReplies(db(), llm, { now: OPEN })).selected).toBe(0);
  });
});
