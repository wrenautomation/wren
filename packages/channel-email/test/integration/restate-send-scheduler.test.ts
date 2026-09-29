/** The SendScheduler virtual object: one tick per key, durable loop, status. */
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { loadSettings } from "@wren/config";
import { runs } from "@wren/core";
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
const OPEN = SendPolicy.fromSettings(
  loadSettings({
    WREN_DATABASE_URL: "postgresql://x",
    WREN_SEND_TIMEZONE: "UTC",
    WREN_SEND_DAYS: "mon,tue,wed,thu,fri,sat,sun",
    WREN_SEND_WINDOW_START: "00:00",
    WREN_SEND_WINDOW_END: "23:59",
    WREN_COLD_SENDS_PER_INBOX_PER_DAY: "1000",
    WREN_SEND_GAP_MIN_MINUTES: "8",
    WREN_SEND_GAP_MAX_MINUTES: "20",
  }),
);
const FLEET: Fleet = {
  senders: [SENDER_A, SENDER_B],
  domainFleet: [SENDER_A, SENDER_B],
  fromNames: { [SENDER_A]: "Ada", [SENDER_B]: null },
  signatureHtml: {},
  pages: {},
};

let pg: TestPostgres;
let env: RestateTestEnvironment;
const transport = new ConsoleTransport({ write: () => {} });
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await RestateTestEnvironment.start({
    services: [
      makeSendScheduler({
        transport,
        scopeOf: oneScope({ db: pg.db, policy: OPEN, fleet: FLEET }),
        tickMs: 5_000,
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
  await truncate(pg.db, TABLES);
  transport.mailbox.clear();
});
const db = () => pg.db;
const client = (sender: string) =>
  clients
    .connect({ url: env.baseUrl() })
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

    const outcome = await client(SENDER_A).tick();
    if (!outcome) throw new Error("the one scope is always there");

    expect(outcome.stats.sent).toBe(1);
    expect(outcome.stats.sender_not_on_roster).toBe(1);
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
    expect(status.onRoster).toBe(true);
    expect(status.last?.stats.sent).toBe(1);
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
    expect(status.last?.stats.sent).toBe(0);
    expect(status.last?.delayMs).toBe(5_000); // nothing sent: the tick interval
    const stopped = await client(SENDER_B).stop();
    expect(stopped.running).toBe(false);
  });

  it("nextDelay: gap after a send, next open when closed or capped, tick interval otherwise", () => {
    const now = new Date(Date.UTC(2026, 11, 2, 12));
    const idle = emptySendStats();
    expect(nextDelay(OPEN, idle, now, 1, 60_000)).toBe(60_000);
    const sent = { ...idle, sent: 1 };
    const gap = nextDelay(OPEN, sent, now, 1, 60_000);
    expect(gap).toBeGreaterThanOrEqual(8 * 60_000);
    expect(gap).toBeLessThanOrEqual(20 * 60_000);
    const closed = { ...idle, window_closed: 1 };
    const office = SendPolicy.fromSettings(loadSettings({ WREN_DATABASE_URL: "postgresql://x" }));
    const saturday = new Date(Date.UTC(2026, 8, 12, 15)); // 10:00 Chicago, Saturday
    expect(nextDelay(office, closed, saturday, 1, 60_000)).toBe(
      office.nextWindowOpen(saturday).getTime() - saturday.getTime(),
    );
    // At today's cap: nothing goes out before tomorrow's window, so sleep until then.
    const capped = { ...idle, senders_capped: 1 };
    const [, tomorrow] = office.localDayBounds(saturday);
    expect(nextDelay(office, capped, saturday, 1, 60_000)).toBe(
      office.nextWindowOpen(tomorrow).getTime() - saturday.getTime(),
    );
    // A send still awaiting reconcile keeps the tick going.
    expect(nextDelay(office, { ...capped, reconcile_pending: 1 }, saturday, 1, 60_000)).toBe(
      60_000,
    );
  });
});
