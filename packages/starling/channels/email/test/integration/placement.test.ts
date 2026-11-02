/**
 * Placement seeds: each ramped inbox sends a plain note and its newest opener once a
 * send day to each seed, through `ConsoleTransport`'s in-memory mailbox, never
 * touching `messages`; the landings judge each domain and pause or lift it.
 */
import { loadSettings } from "@wren/config";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { domainHealth } from "../../src/inbox/health.js";
import { evaluatePlacement, MIN_PAUSE_DAYS } from "../../src/inbox/placement.js";
import {
  NO_DRAFT,
  placementLines,
  plainNote,
  sendPlacements,
} from "../../src/restate/placement-scheduler.js";
import {
  enrollments,
  messages,
  type Placement,
  placementChecks,
  senderPauses,
} from "../../src/schema.js";
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
beforeEach(() => truncate(pg.db, [...TABLES, "placement_checks", "sender_pauses"]));
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
  it("an inbox with no opener yet sends its plain note and says why the real copy is missing", async () => {
    const transport = new ConsoleTransport({ write: () => {} });
    const stats = await sendPlacements(deps(transport), NOW);
    expect(stats).toEqual({ sent: 2, noDraft: [SENDER], failed: 0 });
    const sent = transport.mailbox.get(SENDER) ?? [];
    const note = plainNote("2026-12-02");
    expect(sent.map((s) => [s.email.to, s.email.subject, s.email.body])).toEqual(
      SEEDS.map((seed) => [seed, note.subject, `${note.body}\n\nWill`]),
    );
    const rows = await db()
      .select()
      .from(placementChecks)
      .orderBy(placementChecks.seed, placementChecks.kind);
    expect(rows.map((r) => [r.seed, r.kind, r.messageId !== null, r.detail])).toEqual([
      [SEEDS[0], "plain", true, null],
      [SEEDS[0], "real", false, NO_DRAFT],
      [SEEDS[1], "plain", true, null],
      [SEEDS[1], "real", false, NO_DRAFT],
    ]);
  });

  it("an inbox in warmup borrows the newest opener in its niches", async () => {
    await enrollOne("first.example", "Ana", "live@example.com");
    const [niche] = await db().selectDistinct({ n: enrollments.niche }).from(enrollments);
    const none = new ConsoleTransport({ write: () => {} });
    expect((await sendPlacements(deps(none, ["no-such-niche"]), NOW)).noDraft).toEqual([SENDER]);
    await truncate(db(), ["placement_checks"]);
    const transport = new ConsoleTransport({ write: () => {} });
    expect((await sendPlacements(deps(transport, [niche?.n as string]), NOW)).sent).toBe(4);
  });

  it("mails a note and the newest opener once per seed a day; a retry sends nothing; messages untouched", async () => {
    await enrollOne("first.example", "Ana");
    await enrollOne("second.example", "Bea");
    const before = await db().select().from(messages).orderBy(messages.id);
    const newest = before.filter((m) => m.step === 0).at(-1);
    const transport = new ConsoleTransport({ write: () => {} });

    expect((await sendPlacements(deps(transport), NOW)).sent).toBe(4);
    expect((await sendPlacements(deps(transport), NOW)).sent).toBe(0);

    const sent = transport.mailbox.get(SENDER) ?? [];
    expect(sent.map((s) => s.email.to)).toEqual([SEEDS[0], SEEDS[0], SEEDS[1], SEEDS[1]]);
    const real = sent.filter((s) => s.email.subject !== plainNote("2026-12-02").subject);
    expect(real).toHaveLength(2);
    for (const { email } of real) {
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

  it("the digest says one line per domain", async () => {
    await sendPlacements(deps(new ConsoleTransport({ write: () => {} })), NOW);
    expect(await placementLines(db(), [SENDER, "other@else.test"], NOW)).toEqual({
      lines: [
        "else.test: setup ok · plain none yet · real none yet · not enough",
        "wren-automation.test: setup ok · plain none yet · real none yet · not enough",
      ],
      trouble: [],
    });
  });
});

const DOMAIN = "wren-automation.test";
const SECOND = "ana@wren-automation.test";
const THREE = ["s1@example.com", "s2@example.com", "s3@example.com"];

/** Landed copies for `day` from both inboxes: `plain` and `real` lists per seed. */
async function landings(
  day: string,
  plain: Placement[],
  real: Placement[] = ["inbox", "inbox", "inbox"],
  auth = { spf: "pass", dkim: "pass", dmarc: "pass" },
) {
  const sentAt = new Date(`${day}T15:00:00Z`);
  await db()
    .insert(placementChecks)
    .values(
      [SENDER, SECOND].flatMap((sender) =>
        THREE.flatMap((seed, i) =>
          (["plain", "real"] as const).map((kind) => ({
            sender,
            seed,
            day,
            kind,
            messageId: `<${kind}.${i}.${day}@${sender}>`,
            sentAt,
            landed: (kind === "plain" ? plain : real)[i] as Placement,
            auth,
            checkedAt: sentAt,
          })),
        ),
      ),
    );
}
const at = (day: string) => new Date(`${day}T18:00:00Z`);
const active = () =>
  db()
    .select()
    .from(senderPauses)
    .where(and(eq(senderPauses.domain, DOMAIN)));

describe("evaluatePlacement", () => {
  it("a failing plain test pauses the whole domain once, with the numbers", async () => {
    await landings("2026-12-01", ["inbox", "spam", "spam"]);
    await landings("2026-12-02", ["inbox", "inbox", "missing"]);
    const changes = await evaluatePlacement(db(), {
      now: at("2026-12-02"),
      senders: [SENDER, SECOND],
    });
    expect(changes.paused.map((p) => p.sender).sort()).toEqual([SECOND, SENDER]);
    expect(changes.paused[0]?.source).toBe("placement");
    expect(changes.paused[0]?.reason).toBe("plain test inbox 6/12 = 50% < 80% over 2 d");
    const again = await evaluatePlacement(db(), {
      now: at("2026-12-02"),
      senders: [SENDER, SECOND],
    });
    expect(again.paused).toEqual([]);
    expect(await active()).toHaveLength(2);
  });

  it("a real copy in spam while plain lands warns, never pauses", async () => {
    await landings("2026-12-02", ["inbox", "inbox", "inbox"], ["spam", "spam", "inbox"]);
    const changes = await evaluatePlacement(db(), {
      now: at("2026-12-02"),
      senders: [SENDER, SECOND],
    });
    expect(changes.paused).toEqual([]);
    expect(changes.verdicts[0]?.verdict).toBe("copy problem");
  });

  it("the latest day's auth failures are named per inbox", async () => {
    await landings("2026-12-02", ["inbox", "inbox", "inbox"], undefined, {
      spf: "pass",
      dkim: "fail",
      dmarc: "pass",
    });
    const [d] = (await evaluatePlacement(db(), { now: at("2026-12-02"), senders: [SENDER] }))
      .verdicts;
    expect(d?.auth).toEqual([`${SENDER} (plain): dkim=fail`, `${SENDER} (real): dkim=fail`]);
  });

  it("lifts itself after a week once plain notes sent after the pause land; bounces keep their window", async () => {
    await landings("2026-12-01", ["spam", "spam", "spam"]);
    await evaluatePlacement(db(), { now: at("2026-12-01"), senders: [SENDER, SECOND] });
    // Healthy, but too soon: the pause stands its week.
    await landings("2026-12-03", ["inbox", "inbox", "inbox"]);
    const soon = await evaluatePlacement(db(), {
      now: at("2026-12-03"),
      senders: [SENDER, SECOND],
    });
    expect(soon.lifted).toEqual([]);
    expect(soon.verdicts[0]?.plain).toEqual({ inbox: 6, landed: 6 });
    const day = new Date(at("2026-12-01").getTime() + MIN_PAUSE_DAYS * 86_400_000);
    const lifted = await evaluatePlacement(db(), { now: day, senders: [SENDER, SECOND] });
    expect(lifted.lifted.map((p) => [p.sender, p.liftedBy]).sort()).toEqual([
      [SECOND, "placement"],
      [SENDER, "placement"],
    ]);
    const [health] = await domainHealth(db(), { policy: POLICY, now: day, senders: [SENDER] });
    expect(health?.lastLift).toBeNull();
  });

  it("an operator pause on the domain is left alone", async () => {
    await db().insert(senderPauses).values({
      sender: SENDER,
      domain: DOMAIN,
      reason: "by hand",
      source: "operator",
    });
    await landings("2026-12-02", ["spam", "spam", "spam"]);
    const changes = await evaluatePlacement(db(), {
      now: at("2026-12-02"),
      senders: [SENDER, SECOND],
    });
    expect(changes.paused.map((p) => p.sender)).toEqual([SECOND]);
  });
});
