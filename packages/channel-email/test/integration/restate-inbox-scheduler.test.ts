/** The E7 virtual objects: inbox sync per sender, disposition on demand, the daily Postmaster pull, the opens pull, the placement checks. */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf, loadSettings } from "@wren/config";
import { runs } from "@wren/core";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PostmasterClient } from "../../src/inbox/postmaster.js";
import {
  DISPOSITION_COMMAND,
  DISPOSITION_KEY,
  type Disposition,
  makeDisposition,
} from "../../src/restate/disposition.js";
import {
  INBOX_SYNC_COMMAND,
  type InboxPush,
  type InboxScheduler,
  inboxPush,
  makeInboxScheduler,
} from "../../src/restate/inbox-scheduler.js";
import {
  makeOpensScheduler,
  OPENS_KEY,
  type OpensScheduler,
} from "../../src/restate/opens-scheduler.js";
import {
  CHECK_AFTER_MS,
  makePlacementScheduler,
  PLACEMENT_KEY,
  type PlacementScheduler,
} from "../../src/restate/placement-scheduler.js";
import {
  makePostmasterScheduler,
  POSTMASTER_KEY,
  type PostmasterScheduler,
  untilNextLocalDay,
} from "../../src/restate/postmaster-scheduler.js";
import {
  type Enrollment,
  enrollments,
  messages,
  placementChecks,
  postmasterDays,
  threadEvents,
} from "../../src/schema.js";
import { SendPolicy } from "../../src/send/policy.js";
import { ConsoleTransport } from "../../src/send/transport.js";
import { transitionMessage } from "../../src/state.js";
import {
  makeCompany,
  makePerson,
  messagesOf,
  runCompose,
  SENDER,
  TABLES,
} from "./compose-fixtures.js";
import { DAY, FakeReader, load, OUR_ID, THREAD } from "./inbox-fixtures.js";

/** The scheduler reads back from the wall clock, so mail here is dated from it, not the fixtures' fixed NOW. */
const agoMs = (ms: number) => new Date(Date.now() - ms);

const POLICY = SendPolicy.fromSettings(
  loadSettings({ WREN_DATABASE_URL: "postgresql://x", WREN_SEND_TIMEZONE: "UTC" }),
);
const SYNC_MS = 7_000;
const TICK_MS = 3_000;
const NET_MS = 60_000;
/** Gmail push: `WATCHED` takes a 7-day watch, `REFUSED` is refused, the rest have none (IMAP). */
const WATCHED = "watched@example.com";
const REFUSED = "refused@example.com";
const watchCalls: string[] = [];
const watch = async (sender: string) => {
  watchCalls.push(sender);
  if (sender === REFUSED) throw new Error("topic not found");
  return sender === WATCHED ? Date.now() + 7 * 86_400_000 : null;
};

/** Another loop on a mailbox's push (the Monitor): joins `InboxPush`, counts its wakes. */
const LISTENED = "listened@example.com";
const listener = restate.object({
  name: "Listener",
  handlers: {
    // Awaited, so a push right after join finds the listener (a send raced the first notify).
    join: async (ctx: restate.ObjectContext, until: number) => {
      await ctx
        .objectClient<InboxPush>({ name: "InboxPush" }, LISTENED)
        .listen({ service: "Listener", key: ctx.key, until });
    },
    wake: async (ctx: restate.ObjectContext) => {
      ctx.set("woken", ((await ctx.get<number>("woken")) ?? 0) + 1);
    },
    woken: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext) => (await ctx.get<number>("woken")) ?? 0,
    ),
  },
});

const reader = new FakeReader();
const llm = new FakeLlm({
  respond: () =>
    JSON.stringify({ disposition: "interested", evidence: "overflow work", confidence: 0.9 }),
});
/** Every Postmaster call answers one flat day for whatever domain was asked. */
const postmaster: PostmasterClient = {
  fetch: async () =>
    Response.json({
      domainStats: [
        {
          metric: "spam_rate",
          date: { year: 2026, month: 9, day: 7 },
          value: { doubleValue: 0.001 },
        },
      ],
    }),
  token: async () => "t",
  sleep: async () => {},
};
/** A pixel host that refuses every credential: the pass that throws. */
const refusingHost = async () => new Response("no", { status: 401 });
/** Seed Gmails: one finds the copy in Promotions, one refuses (no consent), one is down. */
const seedGmail: SiteClient = {
  async call(site, method, path, _input, account) {
    if (account === "refuses@example.com")
      throw new SiteCallError(site, method, path, 403, "no consent");
    if (account === "down@example.com") throw new SiteCallError(site, method, path, 502, "down");
    return (
      path.endsWith("/messages")
        ? { messages: [{ id: "m1" }] }
        : {
            labelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
            payload: {
              headers: [
                {
                  name: "Authentication-Results",
                  value: "mx.google.com; dkim=pass header.i=@x.test; spf=softfail; dmarc=pass",
                },
              ],
            },
          }
    ) as never;
  },
  via: async () => "api",
};

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [
      makeInboxScheduler({
        reader,
        scopeOf: () => ({ db: pg.db, disposition: DISPOSITION_KEY }),
        syncMs: SYNC_MS,
        tickMs: TICK_MS,
        classify: true,
        watch,
        netMs: NET_MS,
      }),
      inboxPush,
      listener,
      makeDisposition({ dbOf: () => pg.db, llm }),
      makePostmasterScheduler({
        db: pg.db,
        client: postmaster,
        domains: ["wren-automation.test"],
        policy: POLICY,
      }),
      makeOpensScheduler({
        db: pg.db,
        baseUrl: "https://t.example",
        exportToken: "wrong",
        fetch: refusingHost,
        syncMs: SYNC_MS,
        tickMs: TICK_MS,
      }),
      // No ramps: a pass only reads back copies already sent.
      makePlacementScheduler({
        db: pg.db,
        policy: POLICY,
        transport: new ConsoleTransport({ write: () => {} }),
        fleet: { ramps: {}, fromNames: {} },
        niches: {},
        seeds: ["seed@example.com"],
        sitesFor: () => seedGmail,
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
  await truncate(pg.db, [
    ...TABLES,
    "inbox_syncs",
    "postmaster_days",
    "open_syncs",
    "placement_checks",
  ]);
  reader.mail.clear();
});
const db = () => pg.db;
const ingress = () => clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
const inbox = (sender: string) =>
  ingress().objectClient<InboxScheduler>({ name: "InboxScheduler" }, sender);
const disposition = () =>
  ingress().objectClient<Disposition>({ name: "Disposition" }, DISPOSITION_KEY);
const postmasterClient = () =>
  ingress().objectClient<PostmasterScheduler>({ name: "PostmasterScheduler" }, POSTMASTER_KEY);
const opens = () => ingress().objectClient<OpensScheduler>({ name: "OpensScheduler" }, OPENS_KEY);
const placement = () =>
  ingress().objectClient<PlacementScheduler>({ name: "PlacementScheduler" }, PLACEMENT_KEY);

async function enrollSent(domain: string, email: string): Promise<Enrollment> {
  const company = await makeCompany(db(), { domain });
  await makePerson(db(), company, { email });
  await runCompose(db(), { autoApprove: true });
  const [enrollment] = await db()
    .select()
    .from(enrollments)
    .where(eq(enrollments.companyId, company.id));
  if (!enrollment) throw new Error("compose enrolled nobody");
  const [opener] = await messagesOf(db(), enrollment);
  if (!opener) throw new Error("no opener");
  await db()
    .update(messages)
    .set({
      messageId: OUR_ID,
      state: transitionMessage(transitionMessage(opener.state, "sending"), "sent"),
      attemptedAt: agoMs(DAY),
      transport: "gmail",
      sentAt: agoMs(DAY),
      threadId: THREAD,
      gmailId: "g-sent",
    })
    .where(eq(messages.id, opener.id));
  return enrollment;
}

async function waitFor<T>(read: () => PromiseLike<T>, ok: (value: T) => boolean): Promise<T> {
  let value = await read();
  for (let i = 0; i < 100 && !ok(value); i++) {
    await new Promise((r) => setTimeout(r, 200));
    value = await read();
  }
  return value;
}

const runsFor = (command: string) => db().select().from(runs).where(eq(runs.command, command));

describe("InboxScheduler", () => {
  it("a sync reads its own inbox, records a run, and hands replies to Disposition", async () => {
    const enrollment = await enrollSent("reply.example", "jordan@example.com");
    reader.add(SENDER, "g-reply", load("human_reply"), {
      threadId: THREAD,
      when: agoMs(8 * 3_600_000),
    });

    const outcome = await inbox(SENDER).sync();

    expect(outcome.error).toBeNull();
    expect(outcome.stats?.replies).toBe(1);
    expect(outcome.stats?.stopped_reply).toBe(1);
    expect(outcome.delayMs).toBe(SYNC_MS);
    const [row] = await db().select().from(enrollments).where(eq(enrollments.id, enrollment.id));
    expect(row?.state).toBe("stopped");
    const [run] = await runsFor(INBOX_SYNC_COMMAND);
    expect(run?.argv).toEqual({ daemon: true, senders: [SENDER], lookback_days: 30 });
    expect(run?.finishedAt).not.toBeNull();

    // The reply was handed on: the Disposition object labels it with the fake LLM's verdict.
    const [event] = await waitFor(
      () => db().select().from(threadEvents).where(eq(threadEvents.kind, "reply")),
      (rows) => rows[0]?.disposition !== null,
    );
    expect(event?.disposition).toBe("interested");
    expect(event?.dispositionSource).toBe("llm");
    const [classify] = await runsFor(DISPOSITION_COMMAND);
    expect(classify?.model).toBe("fake");
    // The object's own state lands when its handler completes, a beat after the DB row.
    const labelled = await waitFor(
      () => disposition().status(),
      (st) => st?.stats?.labelled === 1,
    );
    expect(labelled?.stats?.labelled).toBe(1);

    const status = await inbox(SENDER).status();
    expect(status.running).toBe(false);
    expect(status.last?.stats?.replies).toBe(1);
  });

  it("a watched inbox renews its watch once, polls as a net, and a push runs its pass", async () => {
    const key = `acme/${WATCHED}`;
    watchCalls.length = 0;
    expect((await inbox(key).sync()).delayMs).toBe(NET_MS);
    expect((await inbox(key).sync()).delayMs).toBe(NET_MS);
    expect(watchCalls).toEqual([WATCHED]); // 7 days left: no second renewal

    // Gmail names the address only; the claim routes the push to the client's key.
    const before = (await inbox(key).status()).last?.now;
    await waitFor(
      async () => {
        await ingress().objectClient<InboxPush>({ name: "InboxPush" }, WATCHED).notify();
        return (await inbox(key).status()).last?.now;
      },
      (now) => now !== before,
    );
    expect((await inbox(key).status()).last?.now).not.toBe(before);
  });

  it("a push wakes each live listener and no inbox loop; a lapsed one is skipped", async () => {
    const listening = (key: string) =>
      ingress().objectClient<typeof listener>({ name: "Listener" }, key);
    await listening("live").join(Date.now() + 86_400_000);
    await listening("lapsed").join(Date.now() - 1);
    await waitFor(
      async () => {
        await ingress().objectClient<InboxPush>({ name: "InboxPush" }, LISTENED).notify();
        return listening("live").woken();
      },
      (n) => n > 0,
    );
    expect(await listening("lapsed").woken()).toBe(0);
    // Listened to, never claimed: no inbox loop took the address as its key.
    expect((await inbox(LISTENED).status()).last).toBeFalsy();
  });

  it("a refused watch keeps the usual poll and asks again next pass", async () => {
    watchCalls.length = 0;
    const outcome = await inbox(REFUSED).sync();
    expect(outcome.error).toBeNull();
    expect(outcome.delayMs).toBe(SYNC_MS);
    await inbox(REFUSED).sync();
    expect(watchCalls).toEqual([REFUSED, REFUSED]);
  });

  it("start loops until stop", async () => {
    const started = await inbox(SENDER).start();
    expect(started.running).toBe(true);
    expect((await inbox(SENDER).start()).running).toBe(true); // idempotent
    const status = await waitFor(
      () => inbox(SENDER).status(),
      (s) => s.last !== null,
    );
    // A pass ran; what it listed depends on what the earlier tests left in the fake inbox.
    expect(typeof status.last?.stats?.listed).toBe("number");
    expect(status.last?.delayMs).toBe(SYNC_MS);
    expect((await inbox(SENDER).stop()).running).toBe(false);
  });
});

describe("PostmasterScheduler", () => {
  it("a sync stores the day and sleeps until the next local midnight", async () => {
    const outcome = await postmasterClient().sync();

    expect(outcome.error).toBeNull();
    expect(outcome.stats?.stored).toBe(1);
    const rows = await db().select().from(postmasterDays);
    expect(rows.map((r) => [r.domain, r.day])).toEqual([["wren-automation.test", "2026-09-07"]]);
    const at = new Date(outcome.now);
    expect(outcome.delayMs).toBe(untilNextLocalDay(POLICY, at));
    expect(outcome.delayMs).toBeGreaterThan(0);
    expect(outcome.delayMs).toBeLessThanOrEqual(DAY);
  });

  it("untilNextLocalDay is the send timezone's midnight", () => {
    const chicago = SendPolicy.fromSettings(loadSettings({ WREN_DATABASE_URL: "postgresql://x" }));
    const now = new Date(Date.UTC(2026, 8, 8, 12)); // 07:00 Chicago (CDT)
    expect(untilNextLocalDay(chicago, now)).toBe(17 * 3_600_000);
  });
});

describe("OpensScheduler", () => {
  it("a pass that throws records the error, names no secret, and retries after a tick", async () => {
    const outcome = await opens().sync();

    expect(outcome.stats).toBeNull();
    expect(outcome.error).toContain("WREN_PIXEL_EXPORT_TOKEN");
    expect(outcome.error).not.toContain("wrong");
    expect(outcome.delayMs).toBe(TICK_MS);
    const [run] = await runsFor("outreach opens sync");
    expect(run?.argv).toEqual({ daemon: true, base_url: "https://t.example" });
    expect(JSON.stringify(run?.stats)).toContain("OpenSyncError");
    expect(JSON.stringify(run)).not.toContain("wrong");
  });
});

describe("PlacementScheduler", () => {
  it("reads back each due copy: a landing, a refusal recorded once, an outage asked again", async () => {
    const sentAt = new Date(Date.now() - CHECK_AFTER_MS - 3_600_000);
    const row = (seed: string) => ({
      sender: SENDER,
      seed,
      day: "2026-09-21",
      kind: "real" as const,
      messageId: `<${seed.split("@")[0]}@wren-automation.test>`,
      sentAt,
    });
    await db()
      .insert(placementChecks)
      .values([row("lands@example.com"), row("refuses@example.com"), row("down@example.com")]);

    const outcome = await placement().sync();

    expect(outcome.error).toBeNull();
    expect(outcome.stats).toMatchObject({ checked: 1, retrying: 1, sent: 0 });
    expect(outcome.stats?.refused).toHaveLength(1);
    expect(outcome.delayMs).toBeLessThanOrEqual(30 * 60_000);
    const rows = await db().select().from(placementChecks).orderBy(placementChecks.seed);
    expect(rows.map((r) => [r.seed, r.landed, r.detail, r.checkedAt !== null])).toEqual([
      ["down@example.com", null, null, false],
      ["lands@example.com", "promotions", null, true],
      ["refuses@example.com", null, "check refused", true],
    ]);
    expect(rows[1]?.auth).toEqual({ spf: "softfail", dkim: "pass", dmarc: "pass" });
  });
});
