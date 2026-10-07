/**
 * O4, texts and reminders per client (designs/2026-10-04-outbound-per-client.md): a client's
 * loops run on its database and stop without `sms.texts`; its templates are its own; its
 * webhooks land in its database; the watch's reminder pass reads its cal.com.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { runs } from "@wren/core";
import { addClient, addOperator } from "@wren/core/clients";
import type { PassOutcome } from "@wren/core/restate";
import { startTestRestate } from "@wren/core/testing";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeBookings } from "../../src/bookings.js";
import { clientSms } from "../../src/clients.js";
import { DEFAULT_HEALTH } from "../../src/health.js";
import { FakeProvider } from "../../src/provider.js";
import {
  makeSmsConsole,
  makeSmsDesk,
  makeSmsEvents,
  makeSmsSender,
  makeSmsWatch,
  type SmsConsoleService,
  type SmsDeps,
  type SmsDeskService,
  type SmsEventsService,
  type SmsWatchObject,
  smsConsoleApi,
  type WatchStats,
} from "../../src/restate/index.js";
import { smsContacts, smsEvents, smsMessages, speedRuns } from "../../src/schema.js";
import { DAY_BEFORE } from "../../src/templates.js";
import { fillTemplates, liveKeys, numbers, OPEN, POLICY, SEQUENCES } from "./fixtures.js";

let pg: TestPostgres;
let env: RestateTestEnvironment;
let acme: Db;
const wren = new FakeProvider();
const theirs = new FakeProvider();
const open = (id: string) => cachedDb(clientDatabaseUrl(pg.url, `wren_client_${id}`));
const ingress = () => clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
// OPEN is Tue 14:00 ET; the call is Wed 14:30 ET, booked Sunday.
const CALL = {
  uid: "c1",
  start: new Date("2026-09-30T18:30:00Z"),
  createdAt: new Date("2026-09-27T15:00:00Z"),
  name: "Dana Smith",
  email: "dana@x.test",
  timeZone: "America/New_York",
  application: null,
};

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, {
    id: "acme",
    name: "Acme",
    accounts: { telnyx: "profile-acme", calcom: "acme-cal" },
    products: { "sms.texts": { senderName: "Ann" }, "sms.reminders": {} },
  });
  await addClient(pg.db, pg.url, { id: "beta", name: "Beta", products: {} });
  acme = open("acme");
  const deps: SmsDeps = {
    db: pg.db,
    heldNiches: [],
    provider: wren,
    policy: POLICY,
    health: DEFAULT_HEALTH,
    live: true,
    campaignId: null,
    sequences: SEQUENCES,
    senderName: "William",
    llm: null,
    clock: () => OPEN,
    clientDb: open,
    forClient: (plan) => ({
      ...deps,
      db: open(plan.client.id),
      provider: theirs,
      senderName: plan.senderName ?? "William",
      bookings: plan.calcom ? new FakeBookings([], [CALL]) : null,
      forClient: null,
    }),
  };
  env = await startTestRestate({
    services: [
      makeSmsEvents(deps),
      makeSmsDesk(deps),
      makeSmsSender(deps),
      makeSmsWatch(deps),
      makeSmsConsole({ db: pg.db, open: (c) => open(c.id) }),
    ],
    alwaysReplay: true,
  });
}, 180_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

const watch = (key: string) =>
  ingress().objectClient<SmsWatchObject>({ name: "SmsWatch" }, key).sync() as Promise<
    PassOutcome<WatchStats>
  >;

describe("texts per client", () => {
  it("reads the client's profile, name and cal.com; gone without texts", async () => {
    expect(await clientSms(pg.db, "acme")).toMatchObject({
      kind: "work",
      profile: "profile-acme",
      senderName: "Ann",
      calcom: "acme-cal",
    });
    expect(await clientSms(pg.db, "beta")).toEqual({
      kind: "gone",
      why: "texts are not installed",
    });
    const out = await watch("beta/daily");
    expect(out.stopped).toBe("texts are not installed");
  });

  it("its templates are its own, and the watch reminds its booked calls from its database", async () => {
    const desk = ingress().serviceClient<SmsDeskService>({ name: "SmsDesk" });
    await desk.setTemplate({
      client: "acme",
      key: DAY_BEFORE,
      body: "hi {first_name|there}, see you tomorrow at {time}. {sender}",
      by: "w",
    });
    expect(await liveKeys(pg.db)).toEqual([]);
    expect(await liveKeys(acme)).toEqual([DAY_BEFORE]);

    await numbers(acme, theirs, ["+13125550001"]);
    await acme.insert(smsContacts).values({
      e164: "+12125550101",
      sourceKind: "form",
      sourceRef: "7",
      basis: "opt_in",
      basisDetail: "ticked the texts box",
      name: "dana smith",
      email: "dana@x.test",
      state: "finished",
    });
    const out = await watch("acme/daily");
    expect(out.error).toBeNull();
    expect(out.stats?.reminders).toMatchObject({ queued: 1 });
    expect((await acme.select().from(smsMessages)).map((m) => m.body)).toEqual([
      "hi Dana, see you tomorrow at 2:30 PM. Ann",
    ]);
    expect((await acme.select().from(runs)).map((r) => r.command)).toContain("sms watch");
    expect(await pg.db.select().from(smsMessages)).toEqual([]);
  });

  it("a client's webhook lands in its database; an unknown client is refused", async () => {
    const ev = {
      kind: "inbound",
      eventId: "ev-acme",
      type: "message.received",
      messageId: "in-acme",
      from: "+12125550187",
      to: "+13125550001",
      text: "STOP",
      at: OPEN.toISOString(),
    };
    const svc = ingress().serviceClient<SmsEventsService>({ name: "SmsEvents" });
    expect(await svc.ingestFor({ client: "acme", body: ev })).toMatchObject({ duplicate: false });
    expect(await acme.select().from(smsEvents)).toHaveLength(1);
    expect(await pg.db.select().from(smsEvents)).toEqual([]);
    await expect(svc.ingestFor({ client: "ghost", body: ev })).rejects.toThrow("no such client");
  });
});

describe("the desk on a client's texts", () => {
  const desk = () => ingress().serviceClient<SmsDeskService>({ name: "SmsDesk" });

  it("adds, enrolls and replies in the client's database; refused without texts", async () => {
    await fillTemplates(acme);
    const added = await desk().addContact({
      client: "acme",
      phone: "+12125550142",
      basis: "opt_in",
      why: "ticked the texts box",
    });
    expect(added.created).toBe(true);
    const stats = await desk().enroll({ client: "acme", sequence: "recruiting-sms", limit: 5 });
    expect(stats.enrolled).toBe(1);
    const mine = await acme.select().from(smsContacts);
    expect(mine.find((c) => c.e164 === "+12125550142")?.state).toBe("enrolled");
    expect(await pg.db.select().from(smsContacts)).toEqual([]);

    await desk().reply({ client: "acme", contactId: added.contactId, body: "synthetic hello" });
    const sent = await acme.select().from(smsMessages);
    expect(sent.map((m) => m.body)).toContain("synthetic hello");
    // A thread shows once a text is past the queue, or a hand-typed one is in it.
    const threads = await desk().threads({ client: "acme" });
    expect(threads.map((t) => t.e164)).toContain("+12125550142");

    await expect(
      desk().enroll({ client: "beta", sequence: "recruiting-sms", limit: 5 }),
    ).rejects.toThrow("texts are not installed");
    await expect(
      desk().addContact({ client: "beta", phone: "+12125550143", basis: "opt_in", why: "x" }),
    ).rejects.toThrow("texts are not installed");
  });

  it("the portal reads the client's threads; replies are the team's", async () => {
    const operator = { viewer: { email: "op@example.test", operator: true } };
    const api = smsConsoleApi({ db: pg.db, open: (c) => open(c.id) });
    const page = await api.recordsList({ ...operator, client: "acme", record: "sms.thread" });
    expect(page.rows.length).toBeGreaterThan(0);
    await expect(api.recordsTypes({ ...operator, client: "beta" })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      api.recordsList({ viewer: { email: "amy@beta.test" }, client: "acme", record: "sms.thread" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      api.replying({ viewer: { email: "amy@acme.test" }, client: "acme", id: 1, body: "hi" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      api.replying({ ...operator, client: "acme", id: 1, body: "  " }),
    ).rejects.toMatchObject({ status: 400 });
    // Through Restate the guard reads the team fresh: an operators row.
    await addOperator(pg.db, "op@example.test");
    const id = Number(page.rows.find((r) => r.state === "enrolled")?.id);
    const stopped = Number(page.rows.find((r) => r.state === "opted_out")?.id);
    const svc = ingress().serviceClient<SmsConsoleService>({ name: "SmsConsole" });
    // The desk's refusal is the viewer's answer: a STOP is never texted.
    await expect(
      svc.reply({ ...operator, client: "acme", id: stopped, body: "synthetic" }),
    ).rejects.toThrow("opted out");
    await svc.reply({ ...operator, client: "acme", id, body: "synthetic from the portal" });
    const sent = await acme.select().from(smsMessages);
    expect(sent.map((m) => m.body)).toContain("synthetic from the portal");
  });

  it("Call now closes on Done, with how it went, or on a booking", async () => {
    const operator = { viewer: { email: "op@example.test", operator: true } };
    const api = smsConsoleApi({ db: pg.db, open: (c) => open(c.id) });
    const at = new Date("2026-03-10T15:00:00Z");
    const run = (subject: string, more: Partial<typeof speedRuns.$inferInsert> = {}) => ({
      workflow: "w",
      subject,
      leadAt: at,
      name: subject,
      consent: true,
      firstTouch: "would_send" as const,
      call: "alerted" as const,
      callAt: at,
      ...more,
    });
    const [a, b, c, d] = await acme
      .insert(speedRuns)
      .values([
        run("Ann Test"),
        run("Bo Test"),
        run("Cy Test", { bookedAt: at }),
        run("Di Test", { call: "skipped" }),
      ])
      .returning({ id: speedRuns.id });
    const ids = [a, b, c, d].map((r) => String(r?.id));
    const list = async (view: string) =>
      (await api.recordsList({ ...operator, client: "acme", record: "sms.speed", view })).rows
        .map((r) => [r.who, r.call, r.outcome])
        .sort();
    // A booking closes it: shown as Booked, not open.
    expect(await list("call")).toEqual([
      ["Ann Test", "alerted", null],
      ["Bo Test", "alerted", null],
    ]);
    await expect(
      api.callDone({ ...operator, client: "acme", ids: [ids[0] as string], outcome: "Maybe" }, at),
    ).rejects.toMatchObject({ status: 400 });
    const now = new Date("2026-03-10T15:05:00Z");
    expect(
      await api.callDone({ ...operator, client: "acme", ids, outcome: "No answer" }, now),
    ).toEqual({ done: [ids[0], ids[1]], skipped: [ids[2], ids[3]] });
    // Done once: a second press changes nothing.
    expect(
      await api.callDone({ ...operator, client: "acme", ids: [ids[0] as string] }, now),
    ).toEqual({ done: [], skipped: [ids[0]] });
    expect(await list("call")).toEqual([]);
    expect(await list("done")).toEqual([
      ["Ann Test", "done", "no_answer"],
      ["Bo Test", "done", "no_answer"],
    ]);
    expect((await list("booked"))[0]).toEqual(["Cy Test", "booked", null]);
    const [got] = await acme
      .select()
      .from(speedRuns)
      .where(eq(speedRuns.id, Number(ids[0])));
    expect(got).toMatchObject({ callDoneAt: now, callDoneBy: "op@example.test" });
    const detail = await api.recordsGet({
      ...operator,
      client: "acme",
      record: "sms.speed",
      id: ids[0] as string,
    });
    expect((detail.detail as { steps: { step: string; said: string }[] }).steps).toContainEqual(
      expect.objectContaining({ step: "Called", said: "no_answer", why: "op@example.test" }),
    );
    // Someone of another client may not close this one's.
    await expect(
      api.callDone({ viewer: { email: "amy@beta.test" }, client: "acme", ids }, now),
    ).rejects.toMatchObject({ status: 403 });
  });
});
