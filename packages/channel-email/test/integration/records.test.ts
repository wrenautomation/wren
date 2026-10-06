/**
 * Wren's email records over the migrated schema and synthetic rows: one firm enrolled, sent,
 * replied to and bounced; one with only a domain; one declined. Each type's saved views count
 * what they say, and the inbox and campaign rows read the roster and policy they were built from.
 */
import { loadSettings } from "@wren/config";
import { serveRecords } from "@wren/core/records/serve";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pause } from "../../src/inbox/health.js";
import { emailRecords } from "../../src/records.js";
import { emailConsoleApi } from "../../src/restate/console.js";
import { callInvites, enrollments, messages, threadEvents } from "../../src/schema.js";
import { campaignPolicy } from "../../src/send/campaign-controls.js";
import { SendPolicy } from "../../src/send/policy.js";
import type { Sender } from "../../src/send/roster.js";
import { transitionMessage } from "../../src/state.js";
import { makeCompany, makePerson, messagesOf, runCompose, SENDER } from "./compose-fixtures.js";

const OTHER = "pat@other-domain.test";
const sender = (address: string): Sender => ({
  address,
  niches: null,
  excludedNiches: [],
  suspended: false,
  displayName: null,
  signature: null,
  transport: "gmail",
  ramp: null,
  dkim: null,
});
const ROSTER = [sender(SENDER), sender(OTHER)];
const policyOf = (env: Record<string, string> = {}) =>
  SendPolicy.fromSettings(loadSettings({ WREN_DATABASE_URL: "postgresql://x", ...env }));

let pg: TestPostgres;
const today = new Date();
const MONTH_AGO = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 15));
const call = (at: Date) => ({
  model: "test-model",
  call: { provider: "test", usage: { input: 10, output: 2 } },
  classified_at: at.toISOString(),
});

beforeAll(async () => {
  pg = await startTestPostgres();
  const db = pg.db;
  const now = new Date();
  const oak = await makeCompany(db, { domain: "oak.example", name: "Oak Advisors" });
  await makePerson(db, oak, { email: "jane@oak.example" });
  await db.execute(sql`update leads set first_name = 'Jane'`);
  await runCompose(db, { autoApprove: true });
  await makeCompany(db, { domain: "elm.example", name: "Elm Advisors" });
  const ash = await makeCompany(db, { domain: "ash.example", name: "Ash Advisors" });
  await db.execute(sql`update companies set decline_reason = 'not a fit' where id = ${ash.id}`);

  const [enrollment] = await db.select().from(enrollments).where(eq(enrollments.companyId, oak.id));
  if (!enrollment) throw new Error("compose enrolled nobody");
  const [opener] = await messagesOf(db, enrollment);
  if (!opener) throw new Error("no opener");
  await db
    .update(messages)
    .set({
      state: transitionMessage(transitionMessage(opener.state, "sending"), "sent"),
      messageId: "<oak@test>",
      threadId: "t-oak",
      sentAt: now,
    })
    .where(eq(messages.id, opener.id));
  const event = (kind: "reply" | "bounce", at: Date) => ({
    enrollmentId: enrollment.id,
    kind,
    gmailId: `g-${kind}`,
    gmailThreadId: "t-oak",
    headers: {},
    fromAddress: "jane@oak.example",
    snippet: `a ${kind}`,
    bodyText: `a ${kind}`,
    receivedAt: at,
    classification: call(at),
    ...(kind === "reply"
      ? { disposition: "interested" as const, dispositionSource: "llm" as const }
      : { bounceClass: "hard" as const }),
  });
  const [reply] = await db.insert(threadEvents).values(event("reply", now)).returning();
  await db.insert(threadEvents).values(event("bounce", MONTH_AGO));
  if (!reply) throw new Error("no reply");
  await db.insert(callInvites).values({
    threadEventId: reply.id,
    enrollmentId: enrollment.id,
    state: "proposed",
    email: "jane@oak.example",
    detail: "asked for Tuesday",
  });
  await pause(db, { target: OTHER, reason: "testing", by: "test", now, senders: [OTHER] });
});
afterAll(() => pg.stop());

const serve = (policy = policyOf()) => serveRecords(emailRecords(ROSTER, policy), pg.db);

describe("email records", () => {
  it("a campaign: what went out and came back, its state and kill switch from the policy", async () => {
    const page = await serve().list({ record: "email.campaign", view: "all" });
    expect(page.rows).toMatchObject([
      {
        id: "sec_ria",
        campaign: "Sec ria",
        sent: 1,
        replies: 1,
        replyRate: { n: 1, of: 1 },
        bounces: { n: 1, of: 1 },
        state: "opening",
        killSwitch: "on",
      },
    ]);
    const held = serve(
      policyOf({ WREN_NICHE_OPENERS_PER_DAY: "sec_ria=0", WREN_KILL_SWITCH_OFF_FOR: "sec_ria" }),
    );
    const one = await held.get({ record: "email.campaign", id: "sec_ria" });
    expect(one.row).toMatchObject({ state: "follow_ups", killSwitch: "off" });
    expect(one.related).toEqual([
      { record: "email.firm", count: 3 },
      { record: "email.reply", count: 1 },
    ]);
  });

  it("console controls: live on the next read, undo restores, null back to env, logged as who", async () => {
    const env = policyOf();
    const api = emailConsoleApi({ db: pg.db, senders: [SENDER], policy: env });
    const op = { viewer: { email: "op@example.test", operator: true } };
    const row = async () => (await serve(env).get({ record: "email.campaign", id: "sec_ria" })).row;
    const ids = ["sec_ria", "nope"];

    expect(await api.campaignAction("killSwitchOff", { ...op, ids })).toEqual({
      done: ["sec_ria"],
      skipped: ["nope"],
    });
    expect(await row()).toMatchObject({ killSwitch: "off", overrides: "kill switch" });
    expect((await campaignPolicy(pg.db, env)).killSwitchOn("sec_ria")).toBe(false);
    expect(await api.campaignAction("killSwitchOff", { ...op, ids })).toEqual({
      done: [],
      skipped: ids,
    });
    // The undo: back to env, so no override left.
    await api.campaignAction("killSwitchOn", { ...op, ids: ["sec_ria"] });
    expect(await row()).toMatchObject({ killSwitch: "on", overrides: null, setBy: null });

    await api.campaignAction("stopOpeners", { ...op, ids: ["sec_ria"] });
    expect(await row()).toMatchObject({
      state: "follow_ups",
      openersPerDay: 0,
      overrides: "openers",
      setBy: "console:op@example.test",
    });
    await api.campaignAction("resumeOpeners", { ...op, ids: ["sec_ria"] });
    expect(await row()).toMatchObject({ state: "opening", openersPerDay: null, overrides: null });

    // Env holds it at 0: Resume can't open it, Stop has nothing to do.
    const held = emailConsoleApi({
      db: pg.db,
      senders: [SENDER],
      policy: policyOf({ WREN_NICHE_OPENERS_PER_DAY: "sec_ria=0" }),
    });
    for (const action of ["resumeOpeners", "stopOpeners"] as const)
      expect(await held.campaignAction(action, { ...op, ids: ["sec_ria"] })).toEqual({
        done: [],
        skipped: ["sec_ria"],
      });

    // setCampaign: a field left out stays, null clears, a value equal to env stores null.
    expect(
      await api.setCampaign({ ...op, campaign: "sec_ria", killSwitch: false, openersPerDay: 7 }),
    ).toMatchObject({ killSwitch: false, openersPerDay: 7, updatedBy: "console:op@example.test" });
    expect(
      await api.setCampaign({ ...op, campaign: "sec_ria", openersPerDay: null }),
    ).toMatchObject({ killSwitch: false, openersPerDay: null });
    expect(await api.setCampaign({ ...op, campaign: "sec_ria", killSwitch: true })).toMatchObject({
      killSwitch: null,
    });
    await expect(api.setCampaign({ ...op, campaign: "nope", killSwitch: false })).rejects.toThrow(
      "no such campaign",
    );
    await expect(
      api.setCampaign({ ...op, campaign: "sec_ria", openersPerDay: -1 }),
    ).rejects.toThrow("whole number");
    await expect(api.setCampaign({ ...op, campaign: "sec_ria" })).rejects.toThrow("say killSwitch");
    await expect(
      api.campaignAction("killSwitchOff", { viewer: { email: "amy@acme.test" }, ids }),
    ).rejects.toThrow("Wren's team");

    const actors = await pg.db.execute(
      sql`select distinct actor from audit_events where table_name = 'campaign_controls'`,
    );
    expect(actors).toEqual([{ actor: "op@example.test" }]);
  });

  it("an inbox: sending or paused, today's sends against the cap", async () => {
    const policy = policyOf();
    const page = await serve(policy).list({ record: "email.inbox", view: "sending" });
    expect(page.counts).toEqual({ sending: 1, paused: 1, all: 2 });
    expect(page.rows).toMatchObject([
      { id: SENDER, sentToday: 1, cap: policy.perInboxCap(new Date()), state: "sending" },
    ]);
    const paused = await serve(policy).list({ record: "email.inbox", view: "paused" });
    expect(paused.rows).toMatchObject([{ id: OTHER, reason: "testing", health: "quiet" }]);
  });

  it("a reply waiting on William, with its thread", async () => {
    const page = await serve().list({ record: "email.reply", view: "waiting" });
    expect(page.counts).toEqual({ waiting: 1, booked: 0, all: 1 });
    expect(page.rows).toMatchObject([
      { who: "Jane Doe", state: "proposed", campaign: "Sec ria", words: "a reply" },
    ]);
    const one = await serve().get({ record: "email.reply", id: String(page.rows[0]?.id) });
    expect(one.activity?.map((a) => a.kind).sort()).toEqual(["bounce", "reply", "sent"]);
  });

  it("firms, one view per pipeline stage", async () => {
    const page = await serve().list({ record: "email.firm", view: "in_play" });
    expect(page.counts).toEqual({
      in_play: 2,
      with_domain: 2,
      crawled: 0,
      named: 1,
      lead: 1,
      declined: 1,
    });
    const lead = await serve().list({ record: "email.firm", view: "lead" });
    expect(lead.rows).toMatchObject([
      { stage: "lead", domain: "oak.example", campaign: "Sec ria" },
    ]);
  });

  it("model usage by month", async () => {
    const page = await serve().list({ record: "email.model", view: "this_month" });
    expect(page.counts).toMatchObject({ this_month: 1, last_month: 1, all: 2 });
    expect(page.rows).toMatchObject([{ model: "test-model", calls: 1, inputTokens: 10 }]);
  });

  it("variants: the opener sent, with its campaign and step", async () => {
    const page = await serve().list({ record: "email.variant", view: "all" });
    expect(page.rows).toMatchObject([{ campaign: "Sec ria", step: "Opener", sent: 1 }]);
  });

  it("stalls: one row per campaign, with threads whose follow-up waits on its touch", async () => {
    const page = await serve().list({ record: "email.stall", view: "all" });
    // The opener went just now: its touch has the hour to land.
    expect(page.rows).toMatchObject([{ campaign: "Sec ria", waitingOnTouch: 0 }]);
    await pg.db.execute(sql`
      update messages set sent_at = sent_at - interval '2 hours' where state = 'sent' and step = 0`);
    const late = await serve().list({ record: "email.stall", view: "all" });
    await pg.db.execute(sql`
      update messages set sent_at = sent_at + interval '2 hours' where state = 'sent' and step = 0`);
    expect(late.rows).toMatchObject([{ campaign: "Sec ria", waitingOnTouch: 1 }]);
  });

  it("stats: replies waiting, this week", async () => {
    const s = await serve().stats({ record: "email.reply", view: "waiting", period: 7 });
    expect([s.value, s.prior]).toEqual([1, 0]);
  });
});
