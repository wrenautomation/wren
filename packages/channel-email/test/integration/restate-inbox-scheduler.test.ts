/** The E7 virtual objects: inbox sync per sender, disposition on demand, the daily Postmaster pull, the opens pull. */
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { loadSettings } from "@wren/config";
import { runs } from "@wren/core";
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
  type InboxScheduler,
  makeInboxScheduler,
} from "../../src/restate/inbox-scheduler.js";
import {
  makeOpensScheduler,
  OPENS_KEY,
  type OpensScheduler,
} from "../../src/restate/opens-scheduler.js";
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
  postmasterDays,
  threadEvents,
} from "../../src/schema.js";
import { SendPolicy } from "../../src/send/policy.js";
import { transitionMessage } from "../../src/state.js";
import {
  makeCompany,
  makePerson,
  messagesOf,
  runCompose,
  SENDER,
  TABLES,
} from "./compose-fixtures.js";
import { DAY, FakeReader, hoursAgo, load, NOW, OUR_ID, THREAD } from "./inbox-fixtures.js";

const POLICY = SendPolicy.fromSettings(
  loadSettings({ WREN_DATABASE_URL: "postgresql://x", WREN_SEND_TIMEZONE: "UTC" }),
);
const SYNC_MS = 7_000;
const TICK_MS = 3_000;

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

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await RestateTestEnvironment.start({
    services: [
      makeInboxScheduler({
        reader,
        scopeOf: () => ({ db: pg.db, disposition: DISPOSITION_KEY }),
        syncMs: SYNC_MS,
        tickMs: TICK_MS,
        classify: true,
      }),
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
    ],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [...TABLES, "inbox_syncs", "postmaster_days", "open_syncs"]);
  reader.mail.clear();
});
const db = () => pg.db;
const ingress = () => clients.connect({ url: env.baseUrl() });
const inbox = (sender: string) =>
  ingress().objectClient<InboxScheduler>({ name: "InboxScheduler" }, sender);
const disposition = () =>
  ingress().objectClient<Disposition>({ name: "Disposition" }, DISPOSITION_KEY);
const postmasterClient = () =>
  ingress().objectClient<PostmasterScheduler>({ name: "PostmasterScheduler" }, POSTMASTER_KEY);
const opens = () => ingress().objectClient<OpensScheduler>({ name: "OpensScheduler" }, OPENS_KEY);

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
      attemptedAt: new Date(NOW.getTime() - DAY),
      transport: "gmail",
      sentAt: new Date(NOW.getTime() - DAY),
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
    reader.add(SENDER, "g-reply", load("human_reply"), { threadId: THREAD, when: hoursAgo(8) });

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
