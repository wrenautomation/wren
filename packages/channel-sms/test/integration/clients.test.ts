/**
 * O4, texts and reminders per client (designs/2026-10-04-outbound-per-client.md): a client's
 * loops run on its database and stop without `sms.texts`; its templates are its own; its
 * webhooks land in its database; the watch's reminder pass reads its cal.com.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { runs } from "@wren/core";
import { addClient } from "@wren/core/clients";
import type { PassOutcome } from "@wren/core/restate";
import { startTestRestate } from "@wren/core/testing";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeBookings } from "../../src/bookings.js";
import { clientSms } from "../../src/clients.js";
import { DEFAULT_HEALTH } from "../../src/health.js";
import { FakeProvider } from "../../src/provider.js";
import {
  makeSmsDesk,
  makeSmsEvents,
  makeSmsWatch,
  type SmsDeps,
  type SmsDeskService,
  type SmsEventsService,
  type SmsWatchObject,
  type WatchStats,
} from "../../src/restate/index.js";
import { smsContacts, smsEvents, smsMessages, smsTemplates } from "../../src/schema.js";
import { DAY_BEFORE } from "../../src/templates.js";
import { numbers, OPEN, POLICY, SEQUENCES } from "./fixtures.js";

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
    services: [makeSmsEvents(deps), makeSmsDesk(deps), makeSmsWatch(deps)],
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
    expect(await pg.db.select().from(smsTemplates)).toEqual([]);
    expect((await acme.select().from(smsTemplates)).map((t) => t.key)).toEqual([DAY_BEFORE]);

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
