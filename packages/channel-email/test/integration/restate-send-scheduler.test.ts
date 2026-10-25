/** The SendScheduler virtual object: one tick per key, durable loop, status. */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf, loadSettings } from "@wren/config";
import { runs } from "@wren/core";
import { restateAdmin } from "@wren/core/console";
import { LOOP } from "@wren/core/restate";
import { executorRecorder, startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  makeSendScheduler,
  nextDelay,
  oneScope,
  type SendScheduler,
} from "../../src/restate/send-scheduler.js";
import { enrollments } from "../../src/schema.js";
import { emptySendStats } from "../../src/send/deliver.js";
import { SendPolicy } from "../../src/send/policy.js";
import type { Fleet } from "../../src/send/tick.js";
import { ConsoleTransport } from "../../src/send/transport.js";
import { makeCompany, makePerson, messagesOf, runCompose, TABLES } from "./compose-fixtures.js";

const SENDER_A = "ada@wren-automation.test";
const SENDER_B = "bo@wren-automation.test";
/** Its state was written by the SendScheduler before it moved onto `makeLoopObject`. */
const SENDER_OLD = "di@wren-automation.test";
/** Its scope read always throws: the database is down for it. */
const BROKEN = "cy@wren-automation.test";
const OPEN = SendPolicy.fromSettings(
  loadSettings({
    WREN_DATABASE_URL: "postgresql://x",
    WREN_SEND_TIMEZONE: "UTC",
    WREN_SEND_DAYS: "mon,tue,wed,thu,fri,sat,sun",
    WREN_SEND_HOLIDAYS: "none",
    WREN_SEND_WINDOW_START: "00:00",
    WREN_SEND_WINDOW_END: "23:59",
    WREN_COLD_SENDS_PER_INBOX_PER_DAY: "1000",
    WREN_SEND_GAP_MIN_MINUTES: "8",
    WREN_SEND_GAP_MAX_MINUTES: "20",
  }),
);
const FLEET: Fleet = {
  senders: [SENDER_A, SENDER_B, SENDER_OLD],
  domainFleet: [SENDER_A, SENDER_B, SENDER_OLD],
  fromNames: { [SENDER_A]: "Ada", [SENDER_B]: null },
  signatureHtml: {},
  pages: {},
};

let pg: TestPostgres;
let env: RestateTestEnvironment;
const transport = new ConsoleTransport({ write: () => {} });
const executor = executorRecorder();
let scheduler: SendScheduler;
/** The old code's delayed self-call, as it sits queued on prod: `loop(generation)`. */
const queued = restate.service({
  name: "QueuedLoop",
  handlers: {
    send: async (ctx: restate.Context, req: { key: string; generation: number }) => {
      ctx.objectSendClient<SendScheduler>({ name: "SendScheduler" }, req.key).loop(req.generation);
    },
  },
});
beforeAll(async () => {
  pg = await startTestPostgres();
  scheduler = makeSendScheduler({
    transport,
    scopeOf: (key) =>
      key === BROKEN
        ? Promise.reject(new Error("database is down"))
        : oneScope({ db: pg.db, policy: OPEN, fleet: FLEET })(key),
    tickMs: 5_000,
  });
  env = await startTestRestate({
    services: [executor.service, scheduler, queued],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
  transport.mailbox.clear();
});
const db = () => pg.db;
const client = (sender: string) =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .objectClient<SendScheduler>({ name: "SendScheduler" }, sender);

async function enrollOne(domain: string, email: string, sender: string) {
  const company = await makeCompany(db(), { domain });
  await makePerson(db(), company, { email });
  await runCompose(db(), { autoApprove: true });
  const [row] = await db()
    .update(enrollments)
    .set({ sender })
    .where(eq(enrollments.companyId, company.id))
    .returning();
  if (!row) throw new Error("compose enrolled nobody");
  return row;
}

describe("SendScheduler", () => {
  it("a tick sends only its own inbox and records a run", async () => {
    const mine = await enrollOne("mine.example", "a@mine.example", SENDER_A);
    const theirs = await enrollOne("theirs.example", "b@theirs.example", SENDER_B);

    const outcome = await client(SENDER_A).sync();
    expect(outcome.stopped).toBeUndefined();
    expect(outcome.stats?.sent).toBe(1);
    expect(outcome.stats?.sender_not_on_roster).toBe(1);
    expect(outcome.delayMs).toBeGreaterThanOrEqual(8 * 60_000);
    expect(outcome.delayMs).toBeLessThanOrEqual(20 * 60_000);
    expect((await messagesOf(db(), mine))[0]?.state).toBe("sent");
    expect((await messagesOf(db(), theirs))[0]?.state).toBe("approved");
    const [run] = await db().select().from(runs).where(eq(runs.command, "send tick"));
    expect(run?.argv).toEqual({ sender: SENDER_A });
    expect(run?.finishedAt).not.toBeNull();
    expect((run?.stats as { sent: number } | undefined)?.sent).toBe(1);

    const status = await client(SENDER_A).status();
    expect(status.running).toBe(false);
    expect(status.last?.stats?.sent).toBe(1);

    // The opener left its node on the executor; its cadence's next touch lets the follow-up go.
    for (let i = 0; i < 50 && executor.emitted.length === 0; i++)
      await new Promise((r) => setTimeout(r, 100));
    expect(executor.emitted).toEqual([
      {
        client: null,
        workflow: "follow_up.email_sec_ria_test-seq",
        from: "s1.sent",
        events: [
          {
            subject: `lead:email:${mine.id}`,
            kind: "lead",
            data: { enrollmentId: mine.id, personId: mine.personId, companyId: mine.companyId },
          },
        ],
      },
    ]);
  });

  it("start loops until stop, and the loop keeps ticking", async () => {
    const started = await client(SENDER_B).start();
    expect(started.running).toBe(true);
    const again = await client(SENDER_B).start(); // idempotent
    expect(again.running).toBe(true);
    // The first loop iteration runs promptly; wait for its outcome to land.
    let status = await client(SENDER_B).status();
    for (let i = 0; i < 50 && status.last === null; i++) {
      await new Promise((r) => setTimeout(r, 200));
      status = await client(SENDER_B).status();
    }
    expect(status.last).not.toBeNull();
    expect(status.last?.stats?.sent).toBe(0);
    expect(status.last?.delayMs).toBe(5_000); // nothing sent: the tick interval
    const stopped = await client(SENDER_B).stop();
    expect(stopped.running).toBe(false);
  });

  it("a tick that keeps throwing is a failed pass: the chain goes on, wake still works", async () => {
    await client(BROKEN).start();
    let status = await client(BROKEN).status();
    for (let i = 0; i < 100 && status.last === null; i++) {
      await new Promise((r) => setTimeout(r, 200));
      status = await client(BROKEN).status();
    }
    expect(status.running).toBe(true);
    expect(status.last?.stats).toBeNull();
    expect(status.last?.error).toContain("database is down");
    expect(status.last?.failures).toBe(1);
    expect(status.last?.delayMs).toBe(15_000);
    // LoopWatch restarts a dead chain with `wake`: a send loop has one too.
    expect(await client(BROKEN).wake()).toBe(true);
    await client(BROKEN).stop();
    expect(await client(BROKEN).wake()).toBe(false);
  });

  it("a key the old code left running keeps running: its queued loop and a queued tick each pass", async () => {
    // The old shape: the same `loop` key, its `last` without `error` or `failures`.
    const before = "2026-10-15T12:00:00.000Z";
    await env.stateOf(scheduler, SENDER_OLD).set(LOOP, {
      running: true,
      generation: 3,
      last: { stats: emptySendStats(), newPauses: 0, delayMs: 60_000, now: before },
    });
    const mine = await enrollOne("old.example", "d@old.example", SENDER_OLD);
    const status = await client(SENDER_OLD).status();
    expect(status.running).toBe(true);
    expect(status.last?.now).toBe(before);

    // The queued call lands on the new code: no `start`, and it sends.
    await clients
      .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
      .serviceClient<typeof queued>({ name: "QueuedLoop" })
      .send({ key: SENDER_OLD, generation: 3 });
    let after = await client(SENDER_OLD).status();
    for (let i = 0; i < 100 && after.last?.now === before; i++) {
      await new Promise((r) => setTimeout(r, 200));
      after = await client(SENDER_OLD).status();
    }
    expect(after.running).toBe(true);
    expect(after.last).toMatchObject({ error: null, failures: 0 });
    expect(after.last?.stats?.sent).toBe(1);
    expect((await messagesOf(db(), mine))[0]?.state).toBe("sent");
    // The chain goes on: its next `loop` waits on a timer.
    const next = await restateAdmin(env.adminAPIBaseUrl())(
      `SELECT id FROM sys_invocation WHERE target_service_name = 'SendScheduler' AND target_service_key = '${SENDER_OLD}' AND target_handler_name = 'loop' AND status = 'scheduled'`,
    );
    expect(next).toHaveLength(1);

    // A `tick` queued before the deploy still makes a pass.
    const ticked = await client(SENDER_OLD).tick();
    expect(ticked.error).toBeNull();
    expect(ticked.stats?.sent).toBe(0);
    expect((await client(SENDER_OLD).status()).last?.now).toBe(ticked.now);
    await client(SENDER_OLD).stop();
  });

  it("nextDelay: gap after a send, next open when closed or capped, tick interval otherwise", () => {
    const now = new Date(Date.UTC(2026, 11, 2, 12));
    const idle = emptySendStats();
    expect(nextDelay(OPEN, idle, now, null, 60_000)).toBe(60_000);
    const sent = { ...idle, sent: 1 };
    const later = new Date(now.getTime() + 37 * 60_000);
    expect(nextDelay(OPEN, sent, now, later, 60_000)).toBe(37 * 60_000);
    expect(nextDelay(OPEN, { ...idle, gap_waiting: 1 }, now, later, 60_000)).toBe(37 * 60_000);
    const closed = { ...idle, window_closed: 1 };
    const office = SendPolicy.fromSettings(loadSettings({ WREN_DATABASE_URL: "postgresql://x" }));
    const saturday = new Date(Date.UTC(2026, 8, 12, 15)); // 10:00 Chicago, Saturday
    expect(nextDelay(office, closed, saturday, null, 60_000)).toBe(
      office.nextWindowOpen(saturday).getTime() - saturday.getTime(),
    );
    // At today's cap: nothing goes out before tomorrow's window, so sleep until then.
    const capped = { ...idle, senders_capped: 1 };
    const [, tomorrow] = office.localDayBounds(saturday);
    expect(nextDelay(office, capped, saturday, null, 60_000)).toBe(
      office.nextWindowOpen(tomorrow).getTime() - saturday.getTime(),
    );
    // A send still awaiting reconcile keeps the tick going.
    expect(nextDelay(office, { ...capped, reconcile_pending: 1 }, saturday, null, 60_000)).toBe(
      60_000,
    );
  });
});
