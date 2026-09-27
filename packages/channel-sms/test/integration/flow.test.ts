/**
 * The SMS channel end to end on Postgres, with the fake provider and fixed
 * clocks: lift → enroll → send → receipts → reply / STOP → health → stats,
 * plus the failure paths (crash mid-send, try-later, carrier opt-out, the live
 * gate, quiet hours, caps).
 */
import { activeSuppressionOf, addSuppression } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { classifyReplies } from "../../src/classify.js";
import { addContact } from "../../src/contacts.js";
import { queueManual, reconcile, tick } from "../../src/deliver.js";
import { enroll } from "../../src/enroll.js";
import { applyEvent } from "../../src/events.js";
import { checkHealth, DEFAULT_HEALTH } from "../../src/health.js";
import { liftPhones } from "../../src/lift.js";
import { poolToday, syncNumbers } from "../../src/pool.js";
import { FakeProvider, NoProvider, type SmsEvent } from "../../src/provider.js";
import { smsContacts, smsMessages, smsNumbers } from "../../src/schema.js";
import { smsStats } from "../../src/stats.js";
import { getThread, listThreads } from "../../src/threads.js";
import { company, notes, numbers, OPEN, POLICY, SEQ, SEQUENCES, SHUT, TABLES } from "./fixtures.js";

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
    const stats = await liftPhones(db(), { heldNiches: ["sec_ria"] });
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
    expect((await liftPhones(db(), { heldNiches: ["sec_ria"] })).added).toBe(0); // re-run is a no-op
  });
});

describe("manual contacts", () => {
  it("need a reason, dedupe by number, and enroll only when the campaign covers their basis", async () => {
    await expect(
      addContact(db(), { phone: "212 555 0101", basis: "opt_in", why: " " }),
    ).rejects.toThrow(/consent record/);
    await expect(addContact(db(), { phone: "12", basis: "opt_in", why: "x" })).rejects.toThrow(
      /not a US number/,
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
    await liftPhones(db(), { heldNiches: [] });
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
    const thread = await getThread(db(), threads[0]?.contactId as number);
    expect(thread?.messages.map((m) => m.direction)).toEqual(["out", "in"]);
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
      queueManual(db(), { contactId: first?.contactId as number, body: "sorry!", now: OPEN }),
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

  it("an operator reply goes out ahead of the queue, and after hours only to someone who just wrote", async () => {
    await enrollAt(OPEN);
    await tickAt(OPEN);
    const c = await contact("+12125550187");
    await queueManual(db(), {
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
    await liftPhones(db(), { heldNiches: [] });
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
    await liftPhones(db(), { heldNiches: [] });
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
    await liftPhones(db(), { heldNiches: [] });
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
    await liftPhones(db(), { heldNiches: [] });
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
