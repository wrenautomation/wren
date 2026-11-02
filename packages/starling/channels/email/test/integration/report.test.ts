/**
 * The weekly report (E8) against real rows: sends and events land in the
 * right window, arms fold up into niches and the campaign, the stored row
 * feeds next week's deltas, and the mail goes out through the transport.
 */
import { randomUUID } from "node:crypto";
import { companies, people } from "@wren/core";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { previousWeekly, runWeeklyReport } from "../../src/report/send.js";
import { collectWeekly } from "../../src/report/weekly.js";
import {
  type Enrollment,
  enrollments,
  messages,
  postmasterDays,
  reports,
  senderPauses,
  threadEvents,
} from "../../src/schema.js";
import { ConsoleTransport } from "../../src/send/transport.js";
import { TABLES } from "./compose-fixtures.js";

const DAY = 86_400_000;
const NOW = new Date(Date.UTC(2026, 8, 18, 0, 0));
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const SENDER = "will@wren-a.test";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() =>
  truncate(pg.db, [...TABLES, "sender_pauses", "postmaster_days", "reports", "thread_events"]),
);
const db = (): Db => pg.db;

async function enroll(niche: string, opener: string, company = "Acme"): Promise<Enrollment> {
  const tag = randomUUID().replaceAll("-", "").slice(0, 10);
  const [co] = await db()
    .insert(companies)
    .values({ domain: `co-${tag}.example`, name: company, niche, raw: {} })
    .returning();
  if (!co) throw new Error("no company");
  const [person] = await db()
    .insert(people)
    .values({
      companyId: co.id,
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
  const [e] = await db()
    .insert(enrollments)
    .values({
      personId: person.id,
      companyId: co.id,
      kind: "person",
      toEmail: `jane-${tag}@${co.domain}`,
      sender: SENDER,
      niche,
      sequenceName: "seq",
      sequenceSnapshot: { name: "seq", steps: [{ template: opener, day: 0 }] },
      offer: "test-offer",
      state: "active",
    })
    .returning();
  if (!e) throw new Error("no enrollment");
  return e;
}

async function send(e: Enrollment, step: number, template: string, sentAt: Date, state = "sent") {
  await db()
    .insert(messages)
    .values({
      enrollmentId: e.id,
      step,
      template,
      templateVersion: "v1",
      toEmail: e.toEmail,
      subject: "hi",
      body: "hi",
      provenance: {},
      state: state as "sent",
      messageId: `<${randomUUID()}@wren-a.test>`,
      sentAt: state === "sent" ? sentAt : null,
    });
}

async function event(
  e: Enrollment,
  kind: "reply" | "bounce",
  receivedAt: Date,
  extra: { disposition?: "interested" | "not_interested"; snippet?: string; hard?: boolean } = {},
) {
  await db()
    .insert(threadEvents)
    .values({
      enrollmentId: e.id,
      kind,
      bounceClass: extra.hard ? "hard" : null,
      disposition: extra.disposition ?? null,
      dispositionSource: extra.disposition ? "operator" : null,
      snippet: extra.snippet ?? null,
      fromAddress: e.toEmail,
      receivedAt,
      gmailId: randomUUID().replaceAll("-", ""),
    });
}

describe("collectWeekly", () => {
  it("counts this week and to date by arm, niche and campaign", async () => {
    const a = await enroll("agencies", "founder/v2");
    const b = await enroll("agencies", "role/v1", "Beta");
    const c = await enroll("shopify", "founder/v2", "Gamma");
    await send(a, 0, "founder/v2", ago(3));
    await send(a, 1, "followup", ago(1));
    await send(b, 0, "role/v1", ago(10)); // last week
    await send(c, 0, "founder/v2", ago(2));
    await send(c, 1, "followup", ago(0.5), "approved"); // unsent
    await event(a, "reply", ago(1), { disposition: "interested", snippet: "yes please" });
    await event(b, "reply", ago(9), { disposition: "not_interested" });
    await event(c, "bounce", ago(2), { hard: true });
    await db()
      .insert(postmasterDays)
      .values([
        {
          domain: "wren-a.test",
          day: "2026-09-16",
          spamRate: 0.002,
          domainReputation: "HIGH",
          raw: {},
        },
        {
          domain: "wren-a.test",
          day: "2026-09-10",
          spamRate: 0.05,
          domainReputation: "LOW",
          raw: {},
        },
      ]);
    await db()
      .insert(senderPauses)
      .values({
        sender: SENDER,
        domain: "wren-a.test",
        reason: "bounce rate",
        source: "operator",
        pausedAt: ago(1),
      });

    const s = await collectWeekly(db(), { now: NOW });
    expect(s.headline.week).toMatchObject({
      sent: 3,
      openers: 2,
      replies: 1,
      interested: 1,
      hardBounces: 1,
    });
    expect(s.headline.toDate).toMatchObject({ sent: 4, openers: 3, replies: 2, interested: 1 });
    expect(s.byNiche.map((x) => [x.key.niche, x.week.sent, x.toDate.sent])).toEqual([
      ["agencies", 2, 3],
      ["shopify", 1, 1],
    ]);
    expect(s.byArm.map((x) => [x.key.niche, x.key.arm, x.toDate.sent, x.toDate.replies])).toEqual([
      ["agencies", "founder", 2, 1],
      ["agencies", "role", 1, 1],
      ["shopify", "founder", 1, 0],
    ]);
    expect(s.domains).toEqual([
      {
        domain: "wren-a.test",
        sent: 3,
        hardBounces: 1,
        spamRate: 0.002,
        reputation: "HIGH",
        postmasterDay: "2026-09-16",
      },
    ]);
    expect(s.pauses.map((p) => p.sender)).toEqual([SENDER]);
    expect(s.replies.map((r) => [r.company, r.disposition, r.snippet])).toEqual([
      ["Acme", "interested", "yes please"],
    ]);
    expect(s.pool).toMatchObject({ approved: 1, drafts: 0, activeEnrollments: 3 });
    expect(s.pool.openersPerSendDay).toBeCloseTo(2 / 3); // 2 openers over 3 send days
    expect(s.pool.sendDaysLeft).toBe(2);
  });
});

describe("runWeeklyReport", () => {
  it("stores the row, mails it, and feeds the next week's deltas", async () => {
    const a = await enroll("agencies", "founder/v2");
    await send(a, 0, "founder/v2", ago(2));
    const transport = new ConsoleTransport({ write: () => undefined });
    const sent = () => [...transport.mailbox.values()].flat().map((m) => m.email);
    const first = await runWeeklyReport({
      db: db(),
      transport,
      mail: { to: "ops@wren-a.test", from: SENDER },
      now: NOW,
    });
    expect(first.sent).toBe(1);
    expect(first.mailedTo).toBe("ops@wren-a.test");
    expect(sent()).toHaveLength(1);
    expect(sent()[0]?.subject).toBe("wren weekly: 1 sent, 0 replies");
    expect(sent()[0]?.body).toContain("no earlier report to compare with");
    const rows = await db().select().from(reports);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sentTo).toBe("ops@wren-a.test");
    expect(rows[0]?.periodEnd.toISOString()).toBe(NOW.toISOString());

    // A week later: the stored row is "previous"; the CLI path stores without mail.
    const later = new Date(NOW.getTime() + 7 * DAY);
    expect((await previousWeekly(db(), NOW))?.periodEnd).toBe(NOW.toISOString());
    const second = await runWeeklyReport({ db: db(), transport, mail: null, now: later });
    expect(second.mailedTo).toBeNull();
    expect(second.body).toContain("sends 0 (-1)");
    expect(second.body).toContain("- last week: sends 1");
    expect(sent()).toHaveLength(1);
  });
});
