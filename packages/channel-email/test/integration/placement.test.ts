/**
 * Placement seeds: each ramped inbox's newest opener goes once a send day to each
 * seed, through `ConsoleTransport`'s in-memory mailbox, never touching `messages`.
 */
import { loadSettings } from "@wren/config";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NO_DRAFT, placementLines, sendPlacements } from "../../src/restate/placement-scheduler.js";
import { enrollments, messages, placementChecks } from "../../src/schema.js";
import { PlainDate } from "../../src/send/dates.js";
import { SendPolicy } from "../../src/send/policy.js";
import { ConsoleTransport } from "../../src/send/transport.js";
import { makeCompany, makePerson, runCompose, SENDER, TABLES } from "./compose-fixtures.js";

const SEEDS = ["seed-1@example.com", "seed-2@example.com"];
const NOW = new Date("2026-12-02T12:00:00Z");
// Starts after NOW: placement runs through warmup, before the ramp does.
const RAMPS = { [SENDER]: { start: new PlainDate(2027, 1, 4), from: 5, step: 5, ceiling: 30 } };
const POLICY = SendPolicy.fromSettings(
  loadSettings({
    WREN_DATABASE_URL: "postgresql://x",
    WREN_SEND_TIMEZONE: "UTC",
    WREN_SEND_DAYS: "mon,tue,wed,thu,fri,sat,sun",
    WREN_SEND_HOLIDAYS: "none",
  }),
);

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, [...TABLES, "placement_checks"]));
const db = (): Db => pg.db;

function deps(transport: ConsoleTransport, niches: readonly string[] | null = null) {
  return {
    db: db(),
    policy: POLICY,
    transport,
    fleet: { ramps: RAMPS, fromNames: { [SENDER]: "Will" } },
    niches: { [SENDER]: niches },
    seeds: SEEDS,
  };
}

/** One firm composed and pinned to `sender`. */
async function enrollOne(domain: string, first: string, sender = SENDER): Promise<void> {
  const company = await makeCompany(db(), { domain });
  await makePerson(db(), company, { first, email: `${first.toLowerCase()}@${domain}` });
  await runCompose(db());
  await db().update(enrollments).set({ sender }).where(eq(enrollments.companyId, company.id));
}

describe("sendPlacements", () => {
  it("skips an inbox with no opener yet and says why", async () => {
    const transport = new ConsoleTransport({ write: () => {} });
    const stats = await sendPlacements(deps(transport), NOW);
    expect(stats).toEqual({ sent: 0, noDraft: [SENDER], failed: 0 });
    expect(transport.mailbox.size).toBe(0);
    const rows = await db().select().from(placementChecks);
    expect(rows.map((r) => [r.seed, r.messageId, r.detail])).toEqual([
      [SEEDS[0], null, NO_DRAFT],
      [SEEDS[1], null, NO_DRAFT],
    ]);
  });

  it("an inbox in warmup borrows the newest opener in its niches", async () => {
    await enrollOne("first.example", "Ana", "live@example.com");
    const [niche] = await db().selectDistinct({ n: enrollments.niche }).from(enrollments);
    const none = new ConsoleTransport({ write: () => {} });
    expect((await sendPlacements(deps(none, ["no-such-niche"]), NOW)).noDraft).toEqual([SENDER]);
    await truncate(db(), ["placement_checks"]);
    const transport = new ConsoleTransport({ write: () => {} });
    expect((await sendPlacements(deps(transport, [niche?.n as string]), NOW)).sent).toBe(2);
  });

  it("mails the newest opener once per seed a day; a retry sends nothing; messages untouched", async () => {
    await enrollOne("first.example", "Ana");
    await enrollOne("second.example", "Bea");
    const before = await db().select().from(messages).orderBy(messages.id);
    const newest = before.filter((m) => m.step === 0).at(-1);
    const transport = new ConsoleTransport({ write: () => {} });

    expect((await sendPlacements(deps(transport), NOW)).sent).toBe(2);
    expect((await sendPlacements(deps(transport), NOW)).sent).toBe(0);

    const sent = transport.mailbox.get(SENDER) ?? [];
    expect(sent.map((s) => s.email.to)).toEqual(SEEDS);
    for (const { email } of sent) {
      expect(email.subject).toBe(newest?.subject);
      expect(email.body).toBe(newest?.body);
      expect(email.fromName).toBe("Will");
    }
    const rows = await db().select().from(placementChecks);
    expect(rows.map((r) => r.messageId).sort()).toEqual(sent.map((s) => s.email.messageId).sort());
    expect(rows.every((r) => r.sentAt?.getTime() === NOW.getTime() && r.landed === null)).toBe(
      true,
    );
    expect(await db().select().from(messages).orderBy(messages.id)).toEqual(before);
  });

  it("the digest reads each inbox's latest day and flags spam", async () => {
    await enrollOne("first.example", "Ana");
    await sendPlacements(deps(new ConsoleTransport({ write: () => {} })), NOW);
    const other = "other@example.com";
    expect((await placementLines(db(), [SENDER, other])).lines).toEqual([
      `${SENDER}: not checked yet`,
      `${other}: not checked yet`,
    ]);
    await db()
      .update(placementChecks)
      .set({ landed: "inbox" })
      .where(eq(placementChecks.seed, SEEDS[0] as string));
    await db()
      .update(placementChecks)
      .set({ landed: "spam" })
      .where(eq(placementChecks.seed, SEEDS[1] as string));
    expect(await placementLines(db(), [SENDER])).toEqual({
      lines: [`${SENDER}: inbox 1/2, spam 1`],
      trouble: [`${SENDER}: inbox 1/2, spam 1`],
    });
  });
});
