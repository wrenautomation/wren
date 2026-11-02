/**
 * Sender health and the kill switches (C-D7, I11.10).
 *
 * Rows are built straight against the tables rather than through
 * compose/deliver: everything here needs is the smallest shape the health
 * queries read — an enrollment with a `sender`, SENT messages under it, and
 * `thread_events` hanging off it.
 */
import { randomUUID } from "node:crypto";
import { loadSettings } from "@wren/config";
import { companies, people } from "@wren/core";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  domainHealth,
  domainOf,
  evaluateKillSwitches,
  pause,
  resume,
  senderDays,
} from "../../src/inbox/health.js";
import {
  type BounceClass,
  type Enrollment,
  enrollments,
  messages,
  type SenderPause,
  senderPauses,
  type ThreadEventKind,
  threadEvents,
} from "../../src/schema.js";
import { SendPolicy } from "../../src/send/policy.js";
import { sendTick } from "../../src/send/tick.js";
import { ConsoleTransport } from "../../src/send/transport.js";
import { TABLES } from "./compose-fixtures.js";

const DOMAIN_A = "wren-automation.test";
const DOMAIN_B = "stillwater-automation.test";
const WILL = `will@${DOMAIN_A}`;
const HELLO = `hello@${DOMAIN_A}`;
const SAM = `sam@${DOMAIN_B}`;
const FLEET = [WILL, HELLO, SAM] as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date(Date.UTC(2026, 8, 8, 15, 0));
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const SEQUENCE = { name: "health-seq", steps: [{ template: "opener", day: 0 }] };

function makePolicy(overrides: Record<string, string> = {}): SendPolicy {
  return SendPolicy.fromSettings(
    loadSettings({
      WREN_DATABASE_URL: "postgresql://x",
      WREN_BOUNCE_PAUSE_RATE: "0.02",
      WREN_BOUNCE_PAUSE_MIN_BOUNCES: "2",
      WREN_HEALTH_WINDOW_DAYS: "7",
      ...overrides,
    }),
  );
}
const POLICY = makePolicy();

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, [...TABLES, "sender_pauses", "suppression_events"]));
const db = (): Db => pg.db;

// --- builders -------------------------------------------------------------

/** One company + person + active enrollment pinned to `sender`. Fresh every time: the partial unique indexes allow one active enrollment per company/address/person. */
async function makeEnrollment(sender: string, niche = "agencies"): Promise<Enrollment> {
  const tag = randomUUID().replaceAll("-", "").slice(0, 10);
  const [company] = await db()
    .insert(companies)
    .values({ domain: `co-${tag}.example`, name: "Health Test Co", niche, raw: {} })
    .returning();
  if (!company) throw new Error("no company");
  const [person] = await db()
    .insert(people)
    .values({
      companyId: company.id,
      fullName: "Jane Doe",
      firstName: "Jane",
      lastName: "Doe",
      title: "Owner",
      isCompliance: false,
      origin: "website",
      originRef: "test",
      raw: {},
    })
    .returning();
  if (!person) throw new Error("no person");
  const [enrollment] = await db()
    .insert(enrollments)
    .values({
      personId: person.id,
      companyId: company.id,
      kind: "person",
      toEmail: `jane-${tag}@${company.domain}`,
      sender,
      niche,
      sequenceName: "health-seq",
      sequenceSnapshot: SEQUENCE,
      offer: "test-offer",
      state: "active",
    })
    .returning();
  if (!enrollment) throw new Error("no enrollment");
  return enrollment;
}

/** `count` SENT messages from `sender`. One enrollment carries them all (distinct steps): the health queries count messages, not threads. */
async function seedSends(opts: {
  sender: string;
  count: number;
  sentAt: Date;
  enrollment?: Enrollment;
  firstStep?: number;
}): Promise<Enrollment> {
  const enrollment = opts.enrollment ?? (await makeEnrollment(opts.sender));
  const firstStep = opts.firstStep ?? 0;
  await db()
    .insert(messages)
    .values(
      Array.from({ length: opts.count }, (_, i) => ({
        enrollmentId: enrollment.id,
        step: firstStep + i,
        template: "opener",
        templateVersion: "v1",
        toEmail: enrollment.toEmail,
        subject: "hi",
        body: "hi",
        provenance: {},
        state: "sent" as const,
        messageId: `<${randomUUID()}@${domainOf(opts.sender)}>`,
        sentAt: opts.sentAt,
      })),
    );
  return enrollment;
}

async function seedEvents(
  enrollment: Enrollment,
  opts: { kind: ThreadEventKind; receivedAt: Date; count?: number; bounceClass?: BounceClass },
): Promise<void> {
  await db()
    .insert(threadEvents)
    .values(
      Array.from({ length: opts.count ?? 1 }, () => ({
        enrollmentId: enrollment.id,
        kind: opts.kind,
        bounceClass: opts.bounceClass ?? null,
        receivedAt: opts.receivedAt,
        gmailId: randomUUID().replaceAll("-", ""),
      })),
    );
}

const hardBounces = (enrollment: Enrollment, count: number, receivedAt: Date) =>
  seedEvents(enrollment, { kind: "bounce", bounceClass: "hard", count, receivedAt });

async function active(domain?: string): Promise<SenderPause[]> {
  const rows = await db().select().from(senderPauses).where(isNull(senderPauses.liftedAt));
  return rows.filter((r) => domain === undefined || r.domain === domain);
}

const evaluate = () => evaluateKillSwitches(db(), { policy: POLICY, now: NOW, senders: FLEET });
const sendersOf = (rows: SenderPause[]) => new Set(rows.map((r) => r.sender));

// --- the bounce switch ----------------------------------------------------

describe("the bounce switch", () => {
  it("two hard bounces in forty sends pauses the whole domain", async () => {
    const a1 = await seedSends({ sender: WILL, count: 20, sentAt: ago(DAY) });
    await seedSends({ sender: HELLO, count: 20, sentAt: ago(DAY) });
    await seedSends({ sender: SAM, count: 20, sentAt: ago(DAY) });
    await hardBounces(a1, 2, ago(6 * HOUR));

    const written = await evaluate();

    expect(sendersOf(written)).toEqual(new Set([WILL, HELLO]));
    expect(new Set(written.map((r) => r.source))).toEqual(new Set(["kill_switch"]));
    // The bounce lands on one inbox; reputation is the domain's, so its neighbour goes down with it.
    expect(written.every((r) => r.domain === DOMAIN_A)).toBe(true);
    const reason = written[0]?.reason ?? "";
    expect(reason).toContain("2/40");
    expect(reason).toContain("5.0%");
    expect(reason).toContain("2.0%");
    expect(reason).toContain("7 d");
    expect(written[0]?.detail).toEqual({
      sent: 40,
      hard_bounces: 2,
      complaints: 0,
      bounce_rate: 0.05,
      window_start: ago(7 * DAY).toISOString(),
      run_id: null,
    });
    expect(await active(DOMAIN_B)).toEqual([]);
  });

  it("one hard bounce in ten sends does not pause", async () => {
    const enrollment = await seedSends({ sender: WILL, count: 10, sentAt: ago(DAY) });
    await hardBounces(enrollment, 1, ago(HOUR));

    // 10% is far over the rate; the floor of two bounces keeps one dead
    // address from pausing a domain that sends ten a day.
    expect(await evaluate()).toEqual([]);
    expect(await active()).toEqual([]);
  });

  it("two bounces in two hundred sends is under the rate", async () => {
    const enrollment = await seedSends({ sender: WILL, count: 200, sentAt: ago(2 * DAY) });
    await hardBounces(enrollment, 2, ago(DAY));

    expect(await evaluate()).toEqual([]);
  });

  it("one complaint pauses the domain at any volume", async () => {
    const enrollment = await seedSends({ sender: WILL, count: 5, sentAt: ago(DAY) });
    await seedEvents(enrollment, { kind: "complaint", receivedAt: ago(2 * HOUR) });

    const written = await evaluate();

    expect(sendersOf(written)).toEqual(new Set([WILL, HELLO]));
    expect(written[0]?.reason).toBe("1 complaint in 7 d");
  });

  it("evaluation is idempotent on an already paused domain", async () => {
    const enrollment = await seedSends({ sender: WILL, count: 40, sentAt: ago(DAY) });
    await hardBounces(enrollment, 2, ago(6 * HOUR));
    const first = await evaluate();

    const second = await evaluate();

    // A second row per sender would violate uq_sender_pauses_active.
    expect(first.length).toBe(2);
    expect(second).toEqual([]);
    expect((await active(DOMAIN_A)).length).toBe(2);
  });

  it("the window floors at the last lift", async () => {
    // A resumed domain is not re-paused by the evidence a human already
    // weighed (C-D7: Instantly's 7-day immunity, without a timer).
    const old = await seedSends({ sender: WILL, count: 20, sentAt: ago(3 * DAY) });
    await hardBounces(old, 2, ago(3 * DAY));
    expect((await evaluate()).length).toBe(2);
    const lifted = await resume(db(), {
      target: DOMAIN_A,
      by: "operator",
      now: ago(2 * DAY),
      senders: FLEET,
    });
    expect(lifted.length).toBe(2);

    const fresh = await seedSends({ sender: WILL, count: 40, sentAt: ago(DAY) });
    expect(await evaluate()).toEqual([]);

    await hardBounces(fresh, 2, ago(3 * HOUR));
    const again = await evaluate();
    // Evidence that arrives AFTER the lift counts immediately — the floor is not a blackout.
    expect(sendersOf(again)).toEqual(new Set([WILL, HELLO]));
    expect(again[0]?.reason).toContain("2/40");
  });
});

// --- a niche the switch is off for ------------------------------------------

describe("kill switch off for a niche", () => {
  const offForAgencies = makePolicy({ WREN_KILL_SWITCH_OFF_FOR: "agencies" });
  const evaluateWith = (policy: SendPolicy) =>
    evaluateKillSwitches(db(), { policy, now: NOW, senders: FLEET });

  it("ignores that niche's bounces", async () => {
    const agency = await seedSends({ sender: WILL, count: 40, sentAt: ago(DAY) });
    await hardBounces(agency, 5, ago(3 * HOUR));
    expect(await evaluateWith(offForAgencies)).toEqual([]);
    const [health] =
      (await domainHealth(db(), { policy: offForAgencies, now: NOW, senders: [WILL] })) ?? [];
    expect(health?.sent).toBe(0);
    expect(health?.hardBounces).toBe(0);
  });

  it("still pauses the domain on another niche's bounces, counted over that niche alone", async () => {
    const agency = await seedSends({ sender: WILL, count: 400, sentAt: ago(DAY) });
    await hardBounces(agency, 1, ago(3 * HOUR));
    const recruit = await makeEnrollment(HELLO, "recruiting");
    await seedSends({ sender: HELLO, count: 50, sentAt: ago(DAY), enrollment: recruit });
    await hardBounces(recruit, 2, ago(2 * HOUR));
    const paused = await evaluateWith(offForAgencies);
    expect(sendersOf(paused)).toEqual(new Set([WILL, HELLO]));
    expect(paused[0]?.reason).toContain("2/50");
  });
});

// --- the tick ---------------------------------------------------------------

describe("the send tick", () => {
  it("evaluates the kill switches over the whole domain fleet before walking", async () => {
    const enrollment = await seedSends({ sender: WILL, count: 40, sentAt: ago(DAY) });
    await hardBounces(enrollment, 2, ago(6 * HOUR));
    const wideOpen = makePolicy({
      WREN_SEND_TIMEZONE: "UTC",
      WREN_SEND_DAYS: "mon,tue,wed,thu,fri,sat,sun",
      WREN_SEND_HOLIDAYS: "none",
      WREN_SEND_WINDOW_START: "00:00",
      WREN_SEND_WINDOW_END: "23:59",
    });

    const { newPauses, stats } = await sendTick(db(), {
      policy: wideOpen,
      transport: new ConsoleTransport({ write: () => {} }),
      now: NOW,
      runId: null,
      fleet: {
        senders: [WILL],
        // HELLO is suspended on the roster: not sending, still measured and still paused.
        domainFleet: [WILL, HELLO, SAM],
        fromNames: {},
        signatureHtml: {},
        pages: {},
      },
      reconcileFirst: false,
    });

    expect(sendersOf(newPauses)).toEqual(new Set([WILL, HELLO]));
    expect(newPauses.every((r) => r.source === "kill_switch")).toBe(true);
    expect(stats.sent).toBe(0);
    expect((await active(DOMAIN_A)).length).toBe(2);
  });
});

// --- the operator's half --------------------------------------------------

describe("the operator's half", () => {
  it("pause by domain covers every inbox and resume lifts them", async () => {
    const paused = await pause(db(), {
      target: DOMAIN_A,
      reason: "postmaster spam rate moved",
      by: "operator",
      now: NOW,
      senders: FLEET,
    });
    expect(sendersOf(paused)).toEqual(new Set([WILL, HELLO]));
    expect(new Set(paused.map((r) => r.source))).toEqual(new Set(["operator"]));
    expect(paused[0]?.detail).toEqual({ by: "operator" });

    const later = new Date(NOW.getTime() + DAY);
    const lifted = await resume(db(), {
      target: DOMAIN_A,
      by: "operator",
      now: later,
      senders: FLEET,
    });
    expect(sendersOf(lifted)).toEqual(new Set([WILL, HELLO]));
    expect(lifted.every((r) => r.liftedBy === "operator")).toBe(true);
    expect(lifted.every((r) => r.liftedAt?.getTime() === later.getTime())).toBe(true);
    expect(await active()).toEqual([]);
  });

  it("pause by address touches one inbox and is idempotent", async () => {
    const opts = {
      target: WILL,
      reason: "token refused",
      by: "operator",
      now: NOW,
      senders: FLEET,
    };
    const first = await pause(db(), opts);
    const second = await pause(db(), opts);

    expect(first.map((r) => r.sender)).toEqual([WILL]);
    expect(second).toEqual([]);
    expect((await active()).length).toBe(1);
  });

  it("pause of an unknown target is a loud error", async () => {
    await expect(
      pause(db(), {
        target: "nobody@example.test",
        reason: "x",
        by: "operator",
        now: NOW,
        senders: FLEET,
      }),
    ).rejects.toThrow(/no roster sender matches/);
  });

  it("resume with nothing paused returns empty", async () => {
    expect(
      await resume(db(), { target: DOMAIN_A, by: "operator", now: NOW, senders: FLEET }),
    ).toEqual([]);
    expect(
      await resume(db(), { target: "unknown.test", by: "operator", now: NOW, senders: FLEET }),
    ).toEqual([]);
  });
});

// --- the numbers ----------------------------------------------------------

describe("the numbers", () => {
  it("domain health counts a seeded week", async () => {
    const enrollment = await seedSends({ sender: WILL, count: 30, sentAt: ago(2 * DAY) });
    // Outside the window.
    await seedSends({ sender: WILL, count: 10, sentAt: ago(9 * DAY), enrollment, firstStep: 30 });
    const other = await seedSends({ sender: HELLO, count: 10, sentAt: ago(DAY) });
    await hardBounces(enrollment, 3, ago(DAY));
    await seedEvents(enrollment, {
      kind: "bounce",
      bounceClass: "soft",
      count: 2,
      receivedAt: ago(DAY),
    });
    await seedEvents(other, { kind: "reply", count: 4, receivedAt: NOW });
    await seedEvents(other, { kind: "auto_reply", count: 2, receivedAt: NOW });
    await seedEvents(other, { kind: "unsubscribe", receivedAt: NOW });
    await seedSends({ sender: SAM, count: 7, sentAt: ago(DAY) });
    await pause(db(), { target: SAM, reason: "by hand", by: "operator", now: NOW, senders: FLEET });

    const rows = new Map(
      (await domainHealth(db(), { policy: POLICY, now: NOW, senders: FLEET })).map((h) => [
        h.domain,
        h,
      ]),
    );

    const a = rows.get(DOMAIN_A);
    if (!a) throw new Error("no row for domain A");
    expect([a.sent, a.hardBounces, a.softBounces]).toEqual([40, 3, 2]);
    expect([a.replies, a.autoReplies, a.unsubscribes, a.complaints]).toEqual([4, 2, 1, 0]);
    expect(a.bounceRate).toBeCloseTo(3 / 40, 10);
    expect(new Set(a.senders)).toEqual(new Set([WILL, HELLO]));
    expect(a.windowStart).toEqual(ago(7 * DAY));
    expect(a.lastLift).toBeNull();
    expect(a.paused).toBe(false);
    const b = rows.get(DOMAIN_B);
    if (!b) throw new Error("no row for domain B");
    expect([b.sent, b.hardBounces, b.bounceRate, b.paused]).toEqual([7, 0, 0, true]);
  });

  it("domain health reports no rate without sends", async () => {
    const [row] = await domainHealth(db(), { policy: POLICY, now: NOW, senders: [SAM] });
    // null, not 0: a domain with no evidence is not a clean domain.
    expect(row?.sent).toBe(0);
    expect(row?.bounceRate).toBeNull();
  });

  it("senderDays reads the view", async () => {
    const enrollment = await seedSends({ sender: WILL, count: 4, sentAt: ago(DAY) });
    await seedSends({ sender: WILL, count: 2, sentAt: NOW, enrollment, firstStep: 4 });
    await hardBounces(enrollment, 1, NOW);

    const rows = await senderDays(db(), {
      since: ago(7 * DAY)
        .toISOString()
        .slice(0, 10),
    });

    const byDay = new Map(rows.filter((r) => r.sender === WILL).map((r) => [r.day, r]));
    const yesterday = ago(DAY).toISOString().slice(0, 10);
    const today = NOW.toISOString().slice(0, 10);
    expect(byDay.get(yesterday)?.sent).toBe(4);
    expect(byDay.get(today)?.sent).toBe(2);
    // The bounce is attributed to the day of the send it answers when one is
    // named; nothing named one here, so it lands on its own arrival day.
    expect(byDay.get(today)?.hardBounces).toBe(1);
    expect(Number(byDay.get(today)?.bounceRate)).toBeCloseTo(0.5, 10);
  });
});
