/**
 * Missed-call text back and review requests on a real Postgres: call events into `sms_calls`,
 * the text back and its rules, a reply handed to speed to lead, the review ask, its reminder and
 * the counted click. Synthetic numbers and a fake carrier; nothing leaves.
 */
import { addSuppression } from "@wren/core";
import { clients } from "@wren/core/clients";
import { serveRecords } from "@wren/core/records/serve";
import { workflowInstalls } from "@wren/core/schema";
import { accountFacts, clientAccounts } from "@wren/core/setup-schema";
import { liveFor } from "@wren/core/spine";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tick } from "../../src/deliver.js";
import { applyEvent } from "../../src/events.js";
import { bookedRun } from "../../src/follow.js";
import { callReplied, runOfCall, type TextBackOptions, textBack } from "../../src/missed.js";
import { FakeProvider, type SmsEvent } from "../../src/provider.js";
import { SMS_RECORDS } from "../../src/records.js";
import {
  type AskOptions,
  askReview,
  clickReview,
  placeIdOf,
  remindReview,
  saveFeedback,
} from "../../src/reviews.js";
import { reviewAsks, smsCalls, smsContacts, smsMessages, speedRuns } from "../../src/schema.js";
import { numbers, POLICY, TABLES } from "./fixtures.js";

let pg: TestPostgres;
const provider = new FakeProvider();
const OURS = "+13125550100";
const CALLER = "+12125550187";
// Tue 2026-09-29 18:00Z: 14:00 ET, open everywhere.
const OPEN = new Date("2026-09-29T18:00:00Z");

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [
    ...TABLES,
    "sms_calls",
    "review_asks",
    "speed_runs",
    "workflow_installs",
    "account_facts",
    "client_accounts",
    "clients",
  ]);
  await pg.db.insert(clients).values({ id: "acme", name: "Acme", database: "wren_client_acme" });
  await numbers(pg.db, provider, [OURS]);
  provider.sent.length = 0;
});

let n = 0;
const ev = (
  stage: "ringing" | "answered" | "bridged" | "ended",
  callId: string,
  o: { from?: string; cause?: string; at?: Date } = {},
): SmsEvent => ({
  kind: "call",
  eventId: `e${++n}`,
  type: `call.${stage}`,
  callId,
  stage,
  from: o.from ?? CALLER,
  to: OURS,
  at: o.at ?? OPEN,
  cause: stage === "ended" ? (o.cause ?? "normal_clearing") : null,
});
const apply = (e: SmsEvent) => applyEvent(pg.db, {}, e, { provider: "fake", now: OPEN });

/** A call rung and hung up: its row id, and the apply's missed id. */
async function call(id: string, stages: Array<"answered" | "bridged">, o = {}) {
  await apply(ev("ringing", id, o));
  for (const s of stages) await apply(ev(s, id, o));
  return apply(ev("ended", id, o));
}

const opts = (o: Partial<TextBackOptions> = {}): TextBackOptions => ({
  live: true,
  why: null,
  senderName: "Test Co",
  bookingLink: null,
  onceEvery: 24,
  zone: null,
  now: OPEN,
  ...o,
});

describe("call events", () => {
  it("say how each call went; only unanswered ones come back as missed", async () => {
    const answered = await call("c1", ["answered", "bridged"]);
    const busy = await call("c2", [], { cause: "user_busy" });
    const voicemail = await call("c3", ["answered"]);
    const missed = await call("c4", []);
    expect(answered.missed).toBeUndefined();
    expect([busy.missed, voicemail.missed, missed.missed].every(Number.isInteger)).toBe(true);
    const rows = await pg.db.select().from(smsCalls).orderBy(smsCalls.callId);
    expect(rows.map((r) => r.result)).toEqual(["answered", "busy", "voicemail", "missed"]);
    expect(rows[0]?.numberId).not.toBeNull();
    // The same hangup again is a duplicate event; a new event on an ended call changes nothing.
    expect((await apply(ev("ended", "c4"))).missed).toBeUndefined();
  });
});

describe("text back", () => {
  it("texts a new caller once, from the number they called, and the sender sends it", async () => {
    const { missed } = await call("c1", []);
    const got = await textBack(pg.db, missed as number, opts());
    expect(got.call).toMatchObject({ textBack: "queued", known: false });
    const [msg] = await pg.db.select().from(smsMessages);
    expect(msg).toMatchObject({ kind: "text_back", template: "missed-call.new", toE164: CALLER });
    expect(msg?.body).toContain("Test Co");
    expect(msg?.body).toContain("STOP");
    const [c] = await pg.db.select().from(smsContacts);
    expect(c).toMatchObject({ sourceKind: "call", basis: "opt_in", state: "new" });
    // A retry changes nothing.
    await textBack(pg.db, missed as number, opts());
    expect(await pg.db.select().from(smsMessages)).toHaveLength(1);
    const stats = await tick(pg.db, {
      provider,
      policy: POLICY,
      live: true,
      sequences: new Map(),
      senderName: "Test Co",
      now: OPEN,
    });
    expect(stats.sent).toBe(1);
  });

  it("holds the text until 8:00 on the caller's clock", async () => {
    const { missed } = await call("c1", []);
    await textBack(pg.db, missed as number, opts());
    // 21:30 ET: past the 20:00 cutoff.
    const late = new Date("2026-09-30T01:30:00Z");
    const stats = await tick(pg.db, {
      provider,
      policy: POLICY,
      live: true,
      sequences: new Map(),
      senderName: "Test Co",
      now: late,
    });
    expect(stats.sent).toBe(0);
    expect(stats.outOfWindow).toBe(1);
  });

  it("one text per caller per window; a second call is skipped", async () => {
    const a = await call("c1", []);
    const b = await call("c2", []);
    await textBack(pg.db, a.missed as number, opts());
    const second = await textBack(pg.db, b.missed as number, opts());
    expect(second.call).toMatchObject({ textBack: "skipped" });
    expect(second.call.textBackDetail).toMatch(/texted back/);
    expect(await pg.db.select().from(smsMessages)).toHaveLength(1);
  });

  it("a known caller gets the known words", async () => {
    await pg.db.insert(smsContacts).values({
      e164: CALLER,
      name: "Ada Test",
      sourceKind: "form",
      basis: "opt_in",
      state: "finished",
    });
    const { missed } = await call("c1", []);
    const got = await textBack(pg.db, missed as number, opts());
    expect(got.call).toMatchObject({ textBack: "queued", known: true });
    const [msg] = await pg.db.select().from(smsMessages);
    expect(msg).toMatchObject({ template: "missed-call.known" });
    expect(msg?.body).toContain("Hi Ada");
  });

  it("refuses an opted-out phone, and says would send with texts off", async () => {
    await addSuppression(pg.db, {
      kind: "phone",
      value: CALLER,
      reason: "opt_out",
      evidence: { source: "test" },
    });
    const a = await call("c1", []);
    expect((await textBack(pg.db, a.missed as number, opts())).call).toMatchObject({
      textBack: "refused",
      textBackDetail: "the phone opted out",
    });
    const b = await call("c2", [], { from: "+12125550199" });
    const off = await textBack(
      pg.db,
      b.missed as number,
      opts({ live: false, why: "WREN_SMS_LIVE is off" }),
    );
    expect(off.call).toMatchObject({
      textBack: "would_send",
      textBackDetail: "WREN_SMS_LIVE is off",
    });
    expect(await pg.db.select().from(smsMessages)).toEqual([]);
  });

  it("a reply marks the call, and becomes a speed run for Call now", async () => {
    const { missed } = await call("c1", []);
    const got = await textBack(pg.db, missed as number, opts());
    const contactId = got.contactId as number;
    const replied = await callReplied(pg.db, contactId, OPEN);
    if (!replied) throw new Error("no call replied");
    expect(replied?.repliedAt).toEqual(OPEN);
    const [c] = await pg.db.select().from(smsContacts).where(eq(smsContacts.id, contactId));
    expect(c?.state).toBe("replied");
    expect(await callReplied(pg.db, contactId, OPEN)).toBeNull();
    const run = await runOfCall(pg.db, "speed_to_lead.steps", replied, OPEN);
    expect(run).toMatchObject({
      source: "missed call",
      firstTouch: "sent",
      smsContactId: contactId,
    });
    expect((await runOfCall(pg.db, "speed_to_lead.steps", replied, OPEN))?.id).toBe(run?.id);
    await bookedRun(pg.db, contactId, OPEN);
    const [after] = await pg.db.select().from(smsCalls);
    expect(after?.bookedAt).toEqual(OPEN);
    expect((await pg.db.select().from(speedRuns))[0]?.bookedAt).toEqual(OPEN);
    const serve = serveRecords(SMS_RECORDS, pg.db);
    const page = await serve.list({ record: "sms.call", view: "booked" });
    expect(page.rows).toMatchObject([
      { result: "missed", textBack: "queued", caller: "new", tel: `tel:${CALLER}` },
    ]);
    const detail = await serve.get({ record: "sms.call", id: String(missed) });
    expect(detail.detail).toMatchObject({
      steps: [
        { step: "Called", said: "new caller" },
        { step: "Call", said: "missed" },
        { step: "Text back", said: "queued" },
        { step: "Replied", said: "replied" },
        { step: "Booked", said: "booked" },
      ],
    });
  });
});

describe("only live", () => {
  it("a template's workflow is live for a client only once its install is", async () => {
    expect(await liveFor(pg.db, "acme", "missed_call.steps")).toBe(false);
    await pg.db.insert(workflowInstalls).values({
      client: "acme",
      template: "missed_call.steps",
      workflow: "missed_call.steps",
      version: "v1",
      state: "draft",
      applied: { added: [], blocks: {}, copy: [] },
      by: "test",
    });
    expect(await liveFor(pg.db, "acme", "missed_call.steps")).toBe(false);
    await pg.db.update(workflowInstalls).set({ state: "live" });
    expect(await liveFor(pg.db, "acme", "missed_call.steps")).toBe(true);
    expect(await liveFor(pg.db, "other", "missed_call.steps")).toBe(false);
  });
});

const PLACE = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const ask = (o: Partial<AskOptions> = {}): AskOptions => ({
  live: true,
  why: null,
  senderName: "Test Co",
  placeId: PLACE,
  via: "text",
  feedback: false,
  onceEvery: 90,
  client: "acme",
  origin: "https://phone.example.test",
  now: OPEN,
  ...o,
});
const customer = (subject: string, phone: string | null = "(212) 555-0187") => ({
  subject,
  source: "hand" as const,
  name: "Ada Test",
  phone,
  email: null,
  zone: null,
});

describe("review requests", () => {
  it("asks with a counted link; the click counts and opens Google's form", async () => {
    const a = await askReview(pg.db, customer("hand:1"), ask());
    expect(a).toMatchObject({ ask: "queued", e164: CALLER, placeId: PLACE });
    const [msg] = await pg.db.select().from(smsMessages);
    expect(msg).toMatchObject({ kind: "review", template: "review.ask" });
    expect(msg?.body).toContain(`https://phone.example.test/r/acme/${a.token}`);
    expect(msg?.body).toContain("STOP");
    expect(msg?.body).not.toContain("feedback");
    const to = await clickReview(pg.db, a.token, OPEN);
    expect(to).toBe(`https://search.google.com/local/writereview?placeid=${PLACE}`);
    await clickReview(pg.db, a.token, OPEN);
    const [row] = await pg.db.select().from(reviewAsks);
    expect(row).toMatchObject({ clicks: 2, clickedAt: OPEN });
    expect(await clickReview(pg.db, "nope-not-a-token", OPEN)).toBeNull();
    const serve = serveRecords(SMS_RECORDS, pg.db);
    const opened = await serve.list({ record: "sms.review", view: "clicked" });
    expect(opened.rows).toMatchObject([{ ask: "queued", clicks: 2, source: "hand" }]);
    // Opened: no reminder.
    expect(await remindReview(pg.db, a.id, ask())).toMatchObject({
      reminder: "skipped",
      reminderDetail: "they opened the link",
    });
  });

  it("reminds once when the link wasn't opened, feedback line on both", async () => {
    const a = await askReview(pg.db, customer("hand:1"), ask({ feedback: true }));
    const r = await remindReview(pg.db, a.id, ask({ feedback: true }));
    expect(r.reminder).toBe("queued");
    await remindReview(pg.db, a.id, ask({ feedback: true }));
    const msgs = await pg.db.select().from(smsMessages).orderBy(smsMessages.id);
    expect(msgs.map((m) => m.template)).toEqual(["review.ask", "review.reminder"]);
    for (const m of msgs) expect(m.body).toContain(`/r/acme/${a.token}/feedback`);
    expect(await saveFeedback(pg.db, a.token, "  Great work  ", OPEN)).toBe(true);
    expect((await pg.db.select().from(reviewAsks))[0]?.feedback).toBe("Great work");
  });

  it("one ask per subject and per person in the window; no Place ID or phone says why", async () => {
    await askReview(pg.db, customer("hand:1"), ask());
    expect((await askReview(pg.db, customer("hand:1"), ask())).ask).toBe("queued");
    expect(await askReview(pg.db, customer("hand:2"), ask())).toMatchObject({ ask: "skipped" });
    expect(
      await askReview(pg.db, customer("hand:3", "(212) 555-0111"), ask({ placeId: null })),
    ).toMatchObject({ ask: "refused", askDetail: "no Google review link yet" });
    expect(await askReview(pg.db, customer("hand:4", null), ask())).toMatchObject({
      ask: "skipped",
      askDetail: "no phone number",
    });
    expect(
      await askReview(
        pg.db,
        customer("hand:5", "(212) 555-0122"),
        ask({ live: false, why: "off" }),
      ),
    ).toMatchObject({ ask: "would_send", askDetail: "off" });
    expect(await pg.db.select().from(smsMessages)).toHaveLength(1);
  });

  it("finds the Place ID the setup confirmed", async () => {
    expect(await placeIdOf(pg.db, "acme")).toBeNull();
    const [acct] = await pg.db
      .insert(clientAccounts)
      .values({ client: "acme", site: "google_business", ref: PLACE, createdBy: "test" })
      .returning();
    await pg.db.insert(accountFacts).values({
      accountId: acct?.id as number,
      fact: "google_business.place_id",
      state: "ok",
      by: "test",
    });
    expect(await placeIdOf(pg.db, "acme")).toBe(PLACE);
  });
});
