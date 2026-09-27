/**
 * The channel's Restate surface against a Restate test environment (always
 * replaying): the webhook ingest applies once however often it is called, the
 * desk's reply nudges the sender and the text leaves, the loops report.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import type { PassOutcome } from "@wren/core/restate";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TickStats } from "../../src/deliver.js";
import { DEFAULT_HEALTH } from "../../src/health.js";
import { liftPhones } from "../../src/lift.js";
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
import { company, notes, numbers, POLICY, SEQUENCES, TABLES } from "./fixtures.js";

let pg: TestPostgres;
let env: RestateTestEnvironment;
const provider = new FakeProvider();
const n = notes();
// Tue 14:00 ET: inside every window, pinned so quiet hours never fail the suite at night.
const OPEN = new Date("2026-09-29T18:00:00Z");
const policy = POLICY;
const ingress = () => clients.connect({ url: env.baseUrl() });

beforeAll(async () => {
  pg = await startTestPostgres();
  const deps = {
    db: pg.db,
    provider,
    policy,
    health: DEFAULT_HEALTH,
    live: false,
    sequences: SEQUENCES,
    senderName: "William",
    heldNiches: ["sec_ria"],
    notifier: n.notifier,
    llm: null,
    clock: () => OPEN,
  };
  env = await RestateTestEnvironment.start({
    services: [makeSmsSender(deps), makeSmsEvents(deps), makeSmsDesk(deps), makeSmsWatch(deps)],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
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
    await liftPhones(pg.db, { heldNiches: [] });
    const desk = ingress().serviceClient<SmsDeskService>({ name: "SmsDesk" });
    expect(await desk.enroll({ sequence: "agencies-sms", limit: 5 })).toMatchObject({
      enrolled: 1,
    });
    await expect(desk.enroll({ sequence: "nope", limit: 1 })).rejects.toThrow(/no sms sequence/);
    const sender = ingress().objectClient<SmsSender>({ name: "SmsSender" }, SENDER_KEY);
    const pass = (await sender.sync()) as PassOutcome<TickStats>;
    expect(pass.stats).toMatchObject({ sent: 1 });
    const [thread] = await desk.threads({});
    expect(thread).toMatchObject({ e164: "+12125550187", lastDirection: "out" });
    const { messageId } = await desk.reply({
      contactId: thread?.contactId as number,
      body: "one more thing",
    });
    // The reply nudges the sender; wait for the text to leave.
    for (let i = 0; i < 50 && provider.sent.length < 2; i += 1)
      await new Promise((r) => setTimeout(r, 100));
    expect(provider.sent.at(-1)?.text).toBe("one more thing");
    const [row] = await pg.db.select().from(smsMessages).where(eq(smsMessages.id, messageId));
    expect(row?.state).toBe("sent");
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

  it("the watch pass reports health", async () => {
    const watch = ingress().objectClient<SmsWatchObject>({ name: "SmsWatch" }, WATCH_KEY);
    const out = (await watch.sync()) as PassOutcome<WatchStats>;
    expect(out.error).toBeNull();
    expect(out.stats?.health).toMatchObject({ paused: [], balanceUsd: 25 });
  });
});
