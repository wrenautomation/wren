/**
 * The channel's Restate surface against a Restate test environment (always
 * replaying): the webhook ingest applies once however often it is called, the
 * desk's reply nudges the sender and the text leaves, the loops report.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import type { PassOutcome } from "@wren/core/restate";
import { events } from "@wren/core/schema";
import { makeSpine } from "@wren/core/spine";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SMS_COMPONENTS, TOUCH } from "../../src/components.js";
import type { TickStats } from "../../src/deliver.js";
import { textCadence, touchStep } from "../../src/follow.js";
import { DEFAULT_HEALTH } from "../../src/health.js";
import { FakeProvider, type SmsEvent } from "../../src/provider.js";
import {
  makeSmsDesk,
  makeSmsEvents,
  makeSmsSender,
  makeSmsWatch,
  SENDER_KEY,
  type SmsDeskService,
  type SmsEventsService,
  type SmsSender,
  type SmsWatchObject,
  WATCH_KEY,
  type WatchStats,
} from "../../src/restate/index.js";
import { smsContacts, smsEvents, smsMessages } from "../../src/schema.js";
import {
  company,
  emptyTemplates,
  fillTemplates,
  lift,
  liveKeys,
  notes,
  numbers,
  POLICY,
  SEQ,
  SEQUENCES,
  TABLES,
} from "./fixtures.js";

let pg: TestPostgres;
let env: RestateTestEnvironment;
const provider = new FakeProvider();
const n = notes();
// Tue 14:00 ET: inside every window, pinned so quiet hours never fail the suite at night.
const OPEN = new Date("2026-09-29T18:00:00Z");
const policy = POLICY;
const ingress = () => clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));

beforeAll(async () => {
  pg = await startTestPostgres();
  const deps = {
    db: pg.db,
    provider,
    policy,
    health: DEFAULT_HEALTH,
    live: false,
    campaignId: "camp-1",
    sequences: SEQUENCES,
    senderName: "William",
    heldNiches: ["sec_ria"],
    notifier: n.notifier,
    llm: null,
    clock: () => OPEN,
  };
  env = await startTestRestate({
    services: [
      makeSmsSender(deps),
      makeSmsEvents(deps),
      makeSmsDesk(deps),
      makeSmsWatch(deps),
      makeSpine({
        main: pg.db,
        clientDb: () => pg.db,
        workflows: [textCadence(SEQ)],
        components: SMS_COMPONENTS,
        steps: { [TOUCH]: touchStep(() => ({ ...deps, db: pg.db })) },
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
  await truncate(pg.db, [...TABLES, "events"]);
  await fillTemplates(pg.db);
  provider.sent.length = 0;
  n.seen.length = 0;
});

describe("sms on restate", () => {
  it("ingest applies a webhook once, however often it arrives", async () => {
    const ev: SmsEvent & { at: string } = {
      kind: "inbound",
      eventId: "ev-1",
      type: "message.received",
      messageId: "in-1",
      from: "+12125550187",
      to: "+13125550100",
      text: "hi, who is this?",
      at: OPEN.toISOString(),
    } as never;
    const svc = ingress().serviceClient<SmsEventsService>({ name: "SmsEvents" });
    const first = await svc.ingest(ev);
    const again = await svc.ingest(ev);
    expect(first).toMatchObject({ duplicate: false });
    expect(again).toMatchObject({ duplicate: true });
    expect(await pg.db.select().from(smsEvents)).toHaveLength(1);
    const [c] = await pg.db.select().from(smsContacts).where(eq(smsContacts.e164, "+12125550187"));
    expect(c).toMatchObject({ basis: "opt_in", sourceKind: "inbound", state: "replied" });
    expect(n.seen.map((s) => s.title)).toEqual(["SMS reply from (212) 555-0187"]);
  });

  it("junk webhooks are terminal, not retried forever", async () => {
    const svc = ingress().serviceClient<SmsEventsService>({ name: "SmsEvents" });
    await expect(svc.ingest(null)).rejects.toThrow();
  });

  it("enroll, sender pass, reply from the desk, threads", async () => {
    await numbers(pg.db, provider, ["+13125550100"]);
    await company(pg.db, "Acme", { html: '<a href="tel:+12125550187">x</a>' });
    await lift(pg.db, { heldNiches: [] });
    const desk = ingress().serviceClient<SmsDeskService>({ name: "SmsDesk" });
    expect(await desk.enroll({ sequence: "recruiting-sms", limit: 5 })).toMatchObject({
      enrolled: 1,
    });
    await expect(desk.enroll({ sequence: "nope", limit: 1 })).rejects.toThrow(/no sms sequence/);
    const sender = ingress().objectClient<SmsSender>({ name: "SmsSender" }, SENDER_KEY);
    const pass = (await sender.sync()) as PassOutcome<TickStats>;
    expect(pass.stats).toMatchObject({ sent: 1 });
    // The sent opener leaves s1 on the spine and waits 3 days at step 2.
    let waiting: Array<typeof events.$inferSelect> = [];
    for (let i = 0; i < 50 && waiting.length === 0; i += 1) {
      waiting = await pg.db.select().from(events).where(eq(events.node, "s2"));
      if (waiting.length === 0) await new Promise((r) => setTimeout(r, 100));
    }
    expect(waiting).toMatchObject([{ workflow: "follow_up.recruiting-sms", port: "lead" }]);
    expect(waiting[0]?.due?.getTime()).toBeGreaterThan(Date.now() + 2.9 * 86_400_000);
    const [thread] = await desk.threads({});
    expect(thread).toMatchObject({ e164: "+12125550187", lastDirection: "out" });
    const { messageId } = await desk.reply({
      contactId: thread?.contactId as number,
      body: "one more thing",
    });
    // The reply nudges the sender; wait for the text to leave and its row to say so.
    const state = async () =>
      (await pg.db.select().from(smsMessages).where(eq(smsMessages.id, messageId)))[0]?.state;
    for (let i = 0; i < 50 && (await state()) !== "sent"; i += 1)
      await new Promise((r) => setTimeout(r, 100));
    expect(provider.sent.at(-1)?.text).toBe("one more thing");
    expect(await state()).toBe("sent");
    await expect(desk.reply({ contactId: 999, body: "x" })).rejects.toThrow(/no sms contact/);
    const view = await desk.numbers();
    expect(view).toMatchObject({ provider: "fake", live: false, sentToday: 2 });
    expect(await desk.pause({ e164: "+13125550100", reason: "test" })).toBe(true);
    expect((await desk.numbers()).numbers[0]).toMatchObject({
      state: "paused",
      pausedReason: "test",
      cap: 0,
    });
    expect(await desk.resume({ e164: "+13125550100" })).toBe(true);
    const stats = await desk.stats({ days: 1 });
    expect(stats.texted).toBe(1);
  });

  it("the desk lists every template, saves, clears, and refuses bad words", async () => {
    const desk = ingress().serviceClient<SmsDeskService>({ name: "SmsDesk" });
    await emptyTemplates(pg.db);
    const empty = await desk.templates();
    expect(empty.map((t) => t.key)).toEqual([
      "recruiting-sms#1",
      "recruiting-sms#2",
      "reminder.day-before",
      "reminder.hour-before",
      "missed-call-new",
      "missed-call-known",
      "review-ask",
      "review-reminder",
      "review-feedback",
      "keyword.help",
      "keyword.start",
      "keyword.stop",
    ]);
    expect(empty.every((t) => t.body === "" && t.segments === null)).toBe(true);
    const saved = await desk.setTemplate({
      key: "recruiting-sms#1",
      body: "  hi {first_name|there}, {sender} at {company}. STOP to opt out ",
      by: "w@x.test",
    });
    expect(saved).toMatchObject({
      body: "hi {first_name|there}, {sender} at {company}. STOP to opt out",
      preview: "hi Dana, William at Northwind. STOP to opt out",
      updatedBy: "w@x.test",
      segments: { encoding: "GSM-7", parts: 1 },
    });
    await expect(
      desk.setTemplate({ key: "recruiting-sms#1", body: "hi {name}. STOP", by: "w" }),
    ).rejects.toThrow(/unknown field \{name\}/);
    await expect(
      desk.setTemplate({ key: "recruiting-sms#1", body: "hi there", by: "w" }),
    ).rejects.toThrow(/must say how to stop/);
    await expect(desk.setTemplate({ key: "nope", body: "x", by: "w" })).rejects.toThrow(
      /no SMS template nope/,
    );
    expect((await desk.templates())[0]?.body).toContain("STOP to opt out"); // refusals kept the old words
    expect((await desk.setTemplate({ key: "recruiting-sms#1", body: " ", by: "w" })).body).toBe("");
    expect(await liveKeys(pg.db)).toEqual([]);
  });

  it("a keyword reply goes to the provider first; if it refuses, nothing saves", async () => {
    const desk = ingress().serviceClient<SmsDeskService>({ name: "SmsDesk" });
    const replies = provider.keywordReplies;
    await expect(
      desk.setTemplate({ key: "keyword.help", body: "too short", by: "w" }),
    ).rejects.toThrow(/at least 20 characters/);
    await expect(
      desk.setTemplate({ key: "keyword.help", body: "{sender} here, reply anytime", by: "w" }),
    ).rejects.toThrow(/takes no fields/);
    const body = "Wren Automation. Reply here and a person answers.";
    await desk.setTemplate({ key: "keyword.help", body, by: "w" });
    expect(replies.replies.get("help")).toEqual({ words: ["HELP", "INFO"], text: body });
    replies.fail = "boom";
    await expect(
      desk.setTemplate({ key: "keyword.help", body: `${body} Thanks.`, by: "w" }),
    ).rejects.toThrow(/fake did not take the help reply: boom/);
    replies.fail = null;
    expect((await desk.templates()).find((t) => t.key === "keyword.help")?.body).toBe(body);
    await desk.setTemplate({ key: "keyword.help", body: "", by: "w" });
    expect(replies.replies.has("help")).toBe(false);
  });

  it("the watch pass reports health", async () => {
    const watch = ingress().objectClient<SmsWatchObject>({ name: "SmsWatch" }, WATCH_KEY);
    const out = (await watch.sync()) as PassOutcome<WatchStats>;
    expect(out.error).toBeNull();
    expect(out.stats?.health).toMatchObject({ paused: [], balanceUsd: 25 });
  });

  it("the watch attaches a US number once carriers approve, and says each step once", async () => {
    await numbers(pg.db, provider, ["+13125550100"], "2026-09-01", { registered: false });
    const watch = ingress().objectClient<SmsWatchObject>({ name: "SmsWatch" }, WATCH_KEY);
    const said = () => n.seen.map((s) => s.title).filter((t) => t.startsWith("SMS"));
    await watch.sync();
    await watch.sync();
    expect(said()).toEqual(["SMS campaign: MNO_PENDING"]);
    provider.registration.campaignState = { status: "approved", raw: "MNO_ACCEPTED", detail: null };
    await watch.sync(); // asks the carriers
    provider.registration.settle();
    const out = (await watch.sync()) as PassOutcome<WatchStats>;
    expect(out.stats?.registration.registered).toEqual(["+13125550100"]);
    expect(said()).toEqual([
      "SMS campaign: MNO_PENDING",
      "SMS campaign: MNO_ACCEPTED",
      "SMS: US numbers registered",
    ]);
    const desk = ingress().serviceClient<SmsDeskService>({ name: "SmsDesk" });
    expect((await desk.numbers()).numbers[0]).toMatchObject({
      country: "US",
      registeredAt: OPEN.toISOString(),
    });
    expect(await desk.register()).toMatchObject({ skipped: "no US number waits" });
  });

  it("a 10DLC webhook attaches a US number at once, without waiting for the watch", async () => {
    await numbers(pg.db, provider, ["+13125550111"], "2026-09-01", { registered: false });
    const svc = ingress().serviceClient<SmsEventsService>({ name: "SmsEvents" });
    const update = (id: string, type: string) =>
      svc.ingest({ kind: "ignored", eventId: id, type } as never);
    provider.registration.campaignState = { status: "pending", raw: "MNO_PENDING", detail: null };
    await update("c-1", "10dlc.campaign.update");
    expect(provider.registration.assignments.has("+13125550111")).toBe(false);
    provider.registration.campaignState = {
      status: "approved",
      raw: "MNO_PROVISIONED",
      detail: null,
    };
    await update("c-2", "10dlc.campaign.update"); // asks the carriers
    expect(provider.registration.assignments.get("+13125550111")?.status).toBe("pending");
    provider.registration.settle();
    await update("c-3", "10dlc.phone_number.update"); // the attachment landed
    const desk = ingress().serviceClient<SmsDeskService>({ name: "SmsDesk" });
    const row = (await desk.numbers()).numbers.find((x) => x.e164 === "+13125550111");
    expect(row?.registeredAt).toBe(OPEN.toISOString());
    expect(n.seen.map((s) => s.title)).toContain("SMS: US numbers registered");
  });
});
