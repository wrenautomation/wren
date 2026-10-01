/**
 * The outbox: one send tick, end to end, with a fixed clock and a seeded RNG.
 *
 * Everything runs against `ConsoleTransport`'s in-memory mailbox, which
 * implements the same contract Gmail does — send, refuse, lose the answer, and
 * be searched afterwards by our own Message-ID — so every path the outbox has
 * (intent before act, ambiguity, reconcile, cooldown, the pacing brakes) is
 * exercised without a network and without a real send.
 *
 * `NOW` is deliberately in the future; every enrollment's `sender` is set
 * explicitly after compose, because here the inbox is a variable of the
 * pacing rule under test.
 */
import { randomUUID } from "node:crypto";
import { loadSettings } from "@wren/config";
import { type Company, companies, type Suppression, suppressions } from "@wren/core";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activeSuppression } from "../../src/guards.js";
import {
  type Enrollment,
  enrollments,
  type Message,
  messages,
  senderPauses,
} from "../../src/schema.js";
import { addBusinessDays, PlainDate } from "../../src/send/dates.js";
import { recordStop, type SendDueOptions, sendDue, stopCompany } from "../../src/send/deliver.js";
import { SendPolicy } from "../../src/send/policy.js";
import { reconcile } from "../../src/send/reconcile.js";
import { seededRng } from "../../src/send/rng.js";
import {
  ConsoleTransport,
  type ConsoleTransportOptions,
  type OutgoingEmail,
  type Transport,
  TransportRefused,
} from "../../src/send/transport.js";
import { transitionMessage } from "../../src/state.js";
import {
  makeCompany,
  makeEnrollment,
  makePerson,
  messagesOf,
  runCompose,
  TABLES,
} from "./compose-fixtures.js";

const SENDER_A = "ada@wren-automation.test";
const SENDER_B = "bo@wren-automation.test";
const SENDER_C = "cy@wren-automation.test";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const plus = (at: Date, ms: number) => new Date(at.getTime() + ms);
/** A send tick's instant, from a cadence date: noon keeps every tick inside a local day. */
const atNoon = (day: PlainDate) => new Date(Date.UTC(day.year, day.month - 1, day.day, 12));
// A Wednesday, noon UTC, in the future.
const NOW = atNoon(new PlainDate(2026, 12, 2));

/** A wide-open send policy: every day, all day, no cap, no gap. Hermetic. */
function policyFrom(overrides: Record<string, string> = {}): SendPolicy {
  const settings = loadSettings({
    WREN_DATABASE_URL: "postgresql://x",
    WREN_SEND_TIMEZONE: "UTC",
    WREN_SEND_DAYS: "mon,tue,wed,thu,fri,sat,sun",
    WREN_SEND_HOLIDAYS: "none",
    WREN_SEND_WINDOW_START: "00:00",
    WREN_SEND_WINDOW_END: "23:59",
    WREN_COLD_SENDS_PER_INBOX_PER_DAY: "1000",
    WREN_SEND_GAP_MIN_MINUTES: "0",
    WREN_SEND_GAP_MAX_MINUTES: "0",
    WREN_RESEND_COOLDOWN_DAYS: "30",
    WREN_RECONCILE_GRACE_MINUTES: "10",
    ...overrides,
  });
  return SendPolicy.fromSettings(settings);
}
const OPEN = policyFrom();

const quiet = () => {};
const console_ = (opts: ConsoleTransportOptions = {}) =>
  new ConsoleTransport({ write: quiet, ...opts });

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, [...TABLES, "sender_pauses", "suppression_events"]));
const db = (): Db => pg.db;

/** One send tick with this file's defaults: fixed clock, seeded RNG, reconcile off. */
function tick(
  transport: Transport,
  opts: Partial<SendDueOptions> = {},
): ReturnType<typeof sendDue> {
  return sendDue(db(), {
    transport,
    policy: OPEN,
    now: NOW,
    rng: seededRng(1),
    reconcileFirst: false,
    ...opts,
  });
}

/** One firm, one verified owner, composed and approved, pinned to `sender`. */
async function enrollOne(
  domain: string,
  email: string,
  opts: { sender?: string; autoApprove?: boolean } = {},
): Promise<Enrollment> {
  const company = await makeCompany(db(), { domain });
  await makePerson(db(), company, { email });
  await runCompose(db(), { autoApprove: opts.autoApprove ?? true });
  const [row] = await db()
    .update(enrollments)
    .set({ sender: opts.sender ?? SENDER_A })
    .where(eq(enrollments.companyId, company.id))
    .returning();
  if (!row) throw new Error("compose enrolled nobody");
  return row;
}

async function step(enrollment: Enrollment, index: number): Promise<Message> {
  const rows = await messagesOf(db(), enrollment);
  const found = rows.find((m) => m.step === index);
  if (!found) throw new Error(`no step ${index} on enrollment ${enrollment.id}`);
  return found;
}

async function reload(enrollment: Enrollment): Promise<Enrollment> {
  const [row] = await db().select().from(enrollments).where(eq(enrollments.id, enrollment.id));
  if (!row) throw new Error(`enrollment ${enrollment.id} vanished`);
  return row;
}

async function patchMessage(id: number, patch: Partial<Message>): Promise<void> {
  await db().update(messages).set(patch).where(eq(messages.id, id));
}

/** A SENT row written straight into the database: the history a tick reads. */
async function addSentMessage(
  enrollment: Enrollment,
  sentAt: Date,
  opts: { subject?: string; stepIndex?: number } = {},
): Promise<Message> {
  const [row] = await db()
    .insert(messages)
    .values({
      enrollmentId: enrollment.id,
      step: opts.stepIndex ?? 0,
      template: "opener",
      templateVersion: "0000000000",
      toEmail: enrollment.toEmail,
      subject: opts.subject ?? "Quick question",
      body: "hello",
      provenance: {},
      state: "sent",
      messageId: `<${randomUUID().replaceAll("-", "")}@wren-automation.test>`,
      gmailId: "seeded",
      threadId: "seeded-thread",
      sentAt,
    })
    .returning();
  return row as Message;
}

/** The row a crash (or a lost response) leaves behind, naming the transport handed the bytes. */
async function putInFlight(
  message: Message,
  attemptedAt: Date,
  opts: { state?: "sending" | "unknown"; transport?: string } = {},
): Promise<void> {
  let state = transitionMessage(message.state, "sending");
  if (opts.state === "unknown") state = transitionMessage(state, "unknown");
  await patchMessage(message.id, {
    messageId: `<${randomUUID().replaceAll("-", "")}@wren-automation.test>`,
    state,
    attemptedAt,
    transport: opts.transport ?? "console",
  });
}

const delivered = (t: ConsoleTransport): OutgoingEmail[] =>
  [...t.mailbox.values()].flatMap((box) => box.map((entry) => entry.email));

/** A finished conversation on the record: one stopped enrollment with one SENT message. */
async function stoppedEnrollmentThatAlreadySent(domain: string, email: string, sentAt: Date) {
  const company = await makeCompany(db(), { domain });
  const enrollment = await makeEnrollment(db(), company, {
    toEmail: email,
    kind: "role_inbox",
    state: "active",
    sender: SENDER_A,
  });
  await db()
    .update(enrollments)
    .set({ state: "stopped", stopReason: "reply", stoppedAt: sentAt })
    .where(eq(enrollments.id, enrollment.id));
  await addSentMessage(enrollment, sentAt);
  return { company, enrollment };
}

async function freshEnrollmentAwaitingItsOpener(company: Company, email: string) {
  const enrollment = await makeEnrollment(db(), company, {
    toEmail: email,
    kind: "role_inbox",
    sender: SENDER_A,
  });
  await db()
    .update(enrollments)
    .set({ sequenceSnapshot: { name: "test-seq", steps: [{ template: "opener", day: 0 }] } })
    .where(eq(enrollments.id, enrollment.id));
  await db().insert(messages).values({
    enrollmentId: enrollment.id,
    step: 0,
    template: "opener",
    templateVersion: "0000000000",
    toEmail: email,
    subject: "Quick question",
    body: "hello",
    provenance: {},
    state: "approved",
    approvedAt: NOW,
    approvedBy: "auto",
  });
  return reload(enrollment);
}

// --- 1. ambiguity is a state, and only reconcile moves it ----------------

describe("ambiguity and reconcile", () => {
  it("an ambiguous send lands unknown and only reconcile moves it", async () => {
    const enrollment = await enrollOne("ambig.example", "jane@ambig.example");
    const transport = console_({ ambiguousAfter: (e) => e.subject !== null });

    const stats = await tick(transport);
    expect(stats.ambiguous).toBe(1);
    expect(stats.sent).toBe(0);
    let opener = await step(enrollment, 0);
    expect(opener.state).toBe("unknown");
    expect(opener.messageId).not.toBeNull(); // minted before the send
    expect(opener.attemptedAt).not.toBeNull();
    expect(opener.sentAt).toBeNull();

    const blocked = await tick(transport, { now: plus(NOW, 30 * MIN) });
    expect(blocked.sent).toBe(0);
    expect(blocked.awaiting_reconcile).toBe(1);

    const counts = await reconcile(db(), { transport, policy: OPEN, now: plus(NOW, 30 * MIN) });
    expect(counts).toEqual({
      reconciled_sent: 1,
      reconciled_failed: 0,
      pending: 0,
      errors: 0,
      transport_mismatch: 0,
    });
    opener = await step(enrollment, 0);
    expect(opener.state).toBe("sent");
    expect(opener.gmailId).toBe("console-1");
    expect(opener.threadId).not.toBeNull();
    expect(opener.detail).toContain("reconciled: found in mailbox");

    const third = await tick(transport, { now: plus(NOW, 30 * DAY) });
    expect(third.sent).toBe(1);
    expect((await step(enrollment, 1)).state).toBe("sent");
  });

  it("a refusal fails the message and approve re-arms it", async () => {
    const enrollment = await enrollOne("refuse.example", "jane@refuse.example");
    const refusing = console_({ refuse: () => new TransportRefused("mailbox full") });

    const stats = await tick(refusing);
    expect(stats.failed).toBe(1);
    let opener = await step(enrollment, 0);
    expect(opener.state).toBe("failed");
    expect(opener.detail).toBe("mailbox full");
    expect(opener.sentAt).toBeNull();
    expect(opener.messageId).not.toBeNull(); // the intent row was committed anyway
    expect(refusing.mailbox.size).toBe(0);

    await patchMessage(opener.id, { state: transitionMessage(opener.state, "approved") });
    const good = console_();
    const retry = await tick(good);
    expect(retry.sent).toBe(1);
    opener = await step(enrollment, 0);
    expect(opener.state).toBe("sent");
    expect(good.mailbox.get(SENDER_A)).toHaveLength(1);
  });

  it("a sender-level refusal sidelines that inbox for the rest of the tick", async () => {
    const first = await enrollOne("sl-one.example", "one@sl-one.example");
    const second = await enrollOne("sl-two.example", "two@sl-two.example");
    const other = await enrollOne("sl-three.example", "three@sl-three.example", {
      sender: SENDER_B,
    });
    const transport = console_({
      refuse: (e) =>
        e.fromAddress === SENDER_A
          ? new TransportRefused("gmail HTTP 403: delegation denied", { senderLevel: true })
          : null,
    });

    const stats = await tick(transport);
    expect(stats.failed).toBe(1);
    expect(stats.sender_errors).toBe(1);
    expect(stats.sent).toBe(1);
    expect((await step(first, 0)).state).toBe("failed");
    expect((await step(second, 0)).state).toBe("approved");
    expect((await step(second, 0)).messageId).toBeNull();
    expect((await step(other, 0)).state).toBe("sent");
  });

  it("an unexpected transport exception is treated as ambiguous", async () => {
    const enrollment = await enrollOne("buggy.example", "jane@buggy.example");
    const transport = console_({ refuse: () => new RangeError("transport bug") });

    const stats = await tick(transport);
    expect(stats.ambiguous).toBe(1);
    expect(stats.failed).toBe(0);
    const opener = await step(enrollment, 0);
    expect(opener.state).toBe("unknown");
    expect(opener.detail).toBe("unexpected RangeError: transport bug");
  });

  it("reconcile fails a stale attempt and leaves a fresh one alone", async () => {
    const stale = await enrollOne("stale.example", "jane@stale.example");
    const fresh = await enrollOne("fresh.example", "jane@fresh.example");
    await putInFlight(await step(stale, 0), plus(NOW, -20 * MIN));
    await putInFlight(await step(fresh, 0), plus(NOW, -2 * MIN));

    const counts = await reconcile(db(), { transport: console_(), policy: OPEN, now: NOW });
    expect(counts.reconciled_failed).toBe(1);
    expect(counts.pending).toBe(1);
    expect((await step(stale, 0)).state).toBe("failed");
    expect((await step(stale, 0)).detail).toBe(
      "not found in mailbox 20 min after the attempt (reconcile)",
    );
    expect((await step(fresh, 0)).state).toBe("sending");
    expect((await step(fresh, 0)).detail).toBeNull();
  });

  it("a mailbox that does not answer is never a verdict", async () => {
    const enrollment = await enrollOne("down.example", "jane@down.example");
    await putInFlight(await step(enrollment, 0), plus(NOW, -2 * HOUR));
    const unreachable = console_({ findFails: new Error("gmail HTTP 503") });

    const counts = await reconcile(db(), { transport: unreachable, policy: OPEN, now: NOW });
    expect(counts.errors).toBe(1);
    expect(counts.reconciled_failed).toBe(0);
    expect((await step(enrollment, 0)).state).toBe("sending");
    expect((await step(enrollment, 0)).detail).toBeNull();
  });

  it("reconcile never answers for an attempt another transport made", async () => {
    const enrollment = await enrollOne("wrongwire.example", "jane@wrongwire.example");
    await putInFlight(await step(enrollment, 0), plus(NOW, -2 * HOUR), { transport: "gmail" });

    const counts = await reconcile(db(), { transport: console_(), policy: OPEN, now: NOW });
    expect(counts.transport_mismatch).toBe(1);
    expect(counts.reconciled_failed).toBe(0);
    expect(counts.pending).toBe(0);
    expect((await step(enrollment, 0)).state).toBe("sending");
    expect((await step(enrollment, 0)).detail).toBeNull();
  });
});

// --- cadence, approval, stops (from test_outreach.py) ---------------------

describe("cadence and stops", () => {
  it("send walks the cadence and threads follow-ups", async () => {
    const enrollment = await enrollOne("oakbridge.example", "jane@oakbridge.example");
    const transport = console_();

    const stats = await tick(transport);
    expect(stats.sent).toBe(1);
    expect(stats.waiting).toBe(0);
    const opener = await step(enrollment, 0);
    expect(opener.state).toBe("sent");
    expect(opener.messageId).not.toBeNull();
    expect(delivered(transport)[0]?.subject).toBe("Quick question, Jane");

    const anchor = PlainDate.utcDayOf(opener.sentAt as Date);
    const early = await tick(transport, { now: atNoon(addBusinessDays(anchor, 2)) });
    expect(early.sent).toBe(0);
    expect(early.waiting).toBe(1);

    const later = await tick(transport, { now: atNoon(addBusinessDays(anchor, 3)) });
    expect(later.sent).toBe(1);
    expect(later.finished).toBe(1);
    const followupMail = delivered(transport).at(-1);
    expect(followupMail?.subject).toBeNull();
    expect(followupMail?.inReplyTo).toBe(opener.messageId);
    expect((await reload(enrollment)).state).toBe("finished");
  });

  it("send blocks on unapproved drafts", async () => {
    await enrollOne("oakbridge.example", "jane@oakbridge.example", { autoApprove: false });
    const transport = console_();
    const stats = await tick(transport);
    expect(stats.sent).toBe(0);
    expect(stats.awaiting_approval).toBe(1);
    expect(delivered(transport)).toEqual([]);
  });

  it("a wedged step needs re-approval, not a retry loop", async () => {
    const enrollment = await enrollOne("oakbridge.example", "jane@oakbridge.example");
    const stats = await tick(console_({ refuse: () => new TransportRefused("smtp exploded") }));
    expect(stats.failed).toBe(1);
    const opener = await step(enrollment, 0);
    expect(opener.state).toBe("failed");
    expect(opener.detail).toContain("smtp exploded");
    expect(opener.sentAt).toBeNull();

    const retry = await tick(console_());
    expect(retry.sent).toBe(0);
    expect(retry.awaiting_retry).toBe(1);
  });

  it("a send-time suppression stops the enrollment", async () => {
    const enrollment = await enrollOne("oakbridge.example", "jane@oakbridge.example");
    await db()
      .insert(suppressions)
      .values({ kind: "email", value: "jane@oakbridge.example", reason: "opt_out" });
    const transport = console_();

    const stats = await tick(transport);
    expect(stats.stopped_suppressed).toBe(1);
    expect(delivered(transport)).toEqual([]);
    const stopped = await reload(enrollment);
    expect(stopped.state).toBe("stopped");
    expect(stopped.stopReason).toBe("opt_out");
    const states = new Set((await messagesOf(db(), enrollment)).map((m) => m.state));
    expect(states).toEqual(new Set(["skipped"]));
  });

  it("a thread rider without an anchor is skipped, not sent", async () => {
    const enrollment = await enrollOne("oakbridge.example", "jane@oakbridge.example", {
      autoApprove: false,
    });
    const opener = await step(enrollment, 0);
    const followup = await step(enrollment, 1);
    await patchMessage(opener.id, { state: transitionMessage(opener.state, "rejected") });
    await patchMessage(followup.id, { state: transitionMessage(followup.state, "approved") });
    const transport = console_();

    const stats = await tick(transport);
    expect(stats.skipped_no_thread).toBe(1);
    expect(stats.finished).toBe(1);
    expect(delivered(transport)).toEqual([]);
    const after = await step(enrollment, 1);
    expect(after.state).toBe("skipped");
    expect(after.detail).toContain("no thread to ride");
  });

  it("recordStop skips everything unsent", async () => {
    const enrollment = await enrollOne("oakbridge.example", "jane@oakbridge.example", {
      autoApprove: false,
    });
    const skipped = await recordStop(db(), enrollment, "manual", { detail: "operator note" });
    expect(skipped).toBe(2);
    const stopped = await reload(enrollment);
    expect(stopped.state).toBe("stopped");
    expect(stopped.stoppedAt).not.toBeNull();
    const details = new Set((await messagesOf(db(), enrollment)).map((m) => m.detail));
    expect(details).toEqual(new Set(["operator note"]));
  });

  it("stopCompany stops every active enrollment at the firm", async () => {
    const enrollment = await enrollOne("oakbridge.example", "jane@oakbridge.example", {
      autoApprove: false,
    });
    const stopped = await stopCompany(db(), { companyId: enrollment.companyId, reason: "reply" });
    expect(stopped).toBe(1);
    const after = await reload(enrollment);
    expect(after.state).toBe("stopped");
    expect(after.stopReason).toBe("reply");
  });

  it("stopCompany stops an enrollment that has no person", async () => {
    const company = await makeCompany(db(), { domain: "roleinbox.example" });
    const enrollment = await makeEnrollment(db(), company, {
      toEmail: "info@roleinbox.example",
      kind: "role_inbox",
      sender: SENDER_A,
    });
    const stopped = await stopCompany(db(), { companyId: company.id, reason: "reply" });
    expect(stopped).toBe(1);
    const after = await reload(enrollment);
    expect(after.state).toBe("stopped");
    expect(after.stopReason).toBe("reply");
  });

  it("an out-of-office holds the follow-up until the sending day after they're back", async () => {
    const enrollment = await enrollOne("oakbridge.example", "jane@oakbridge.example");
    const transport = console_();
    await tick(transport);
    const anchor = PlainDate.utcDayOf((await step(enrollment, 0)).sentAt as Date);
    const away = addBusinessDays(anchor, 5);
    await db()
      .update(enrollments)
      .set({ awayUntil: away.toString() })
      .where(eq(enrollments.id, enrollment.id));

    const held = await tick(transport, { now: atNoon(addBusinessDays(anchor, 3)) });
    expect([held.sent, held.waiting_away]).toEqual([0, 1]);
    const lastDay = await tick(transport, { now: atNoon(away) });
    expect(lastDay.sent).toBe(0);

    const back = await tick(transport, { now: atNoon(addBusinessDays(away, 1)) });
    expect([back.sent, back.finished]).toEqual([1, 1]);
  });

  it("cadence anchors on the sent_at UTC date", async () => {
    const enrollment = await enrollOne("oakbridge.example", "jane@oakbridge.example");
    const opener = await step(enrollment, 0);
    // 02:00 UTC on the 11th is the 10th in UTC-4: the two clocks disagree.
    const utcInstant = new Date(Date.UTC(2027, 2, 11, 2, 0));
    await patchMessage(opener.id, {
      messageId: "<opener@test.local>",
      state: "sent",
      sentAt: utcInstant,
    });
    const wrongDue = addBusinessDays(new PlainDate(2027, 3, 10), 3);
    const correctDue = addBusinessDays(new PlainDate(2027, 3, 11), 3);
    expect(wrongDue.compare(correctDue)).toBeLessThan(0);

    const early = await tick(console_(), { now: atNoon(wrongDue) });
    expect(early.sent).toBe(0);
    expect(early.waiting).toBe(1);
    const due = await tick(console_(), { now: atNoon(correctDue) });
    expect(due.sent).toBe(1);
    expect(due.finished).toBe(1);
  });

  it("an opt_out stop creates a suppression that blocks a later compose", async () => {
    const enrollment = await enrollOne("oakbridge.example", "jane@oakbridge.example", {
      autoApprove: false,
    });
    await recordStop(db(), enrollment, "opt_out");
    const rows: Suppression[] = await db().select().from(suppressions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("email");
    expect(rows[0]?.value).toBe("jane@oakbridge.example");
    expect(rows[0]?.reason).toBe("opt_out");
    expect(await activeSuppression(db(), "jane@oakbridge.example")).not.toBeNull();

    await db().delete(messages).where(eq(messages.enrollmentId, enrollment.id));
    await db().delete(enrollments).where(eq(enrollments.id, enrollment.id));
    const stats = await runCompose(db());
    expect(stats.enrolled).toBe(0);
    expect(stats.skipped_suppressed).toBe(1);
  });

  it("manual and reply stops create no suppression", async () => {
    const enrollment = await enrollOne("oakbridge.example", "jane@oakbridge.example", {
      autoApprove: false,
    });
    await recordStop(db(), enrollment, "manual");
    expect(await db().select().from(suppressions)).toEqual([]);
  });
});

// --- 6. cooldown at the last gate ------------------------------------------

describe("cooldown", () => {
  it("an address mailed inside the cooldown stops the new enrollment", async () => {
    const { enrollment: old } = await stoppedEnrollmentThatAlreadySent(
      "cool-addr-old.example",
      "info@shared.example",
      plus(NOW, -10 * DAY),
    );
    const newCompany = await makeCompany(db(), { domain: "cool-addr-new.example" });
    const fresh = await freshEnrollmentAwaitingItsOpener(newCompany, "info@shared.example");

    const stats = await tick(console_());
    expect(stats.sent).toBe(0);
    expect(stats.stopped_cooldown).toBe(1);
    const stopped = await reload(fresh);
    expect(stopped.state).toBe("stopped");
    expect(stopped.stopReason).toBe("manual");
    const opener = await step(fresh, 0);
    expect(opener.state).toBe("skipped");
    expect(opener.detail).toBe(
      `cooldown: address/company was mailed 10 days ago by enrollment ${old.id}`,
    );
  });

  it("a company mailed inside the cooldown stops the new enrollment", async () => {
    const { company, enrollment: old } = await stoppedEnrollmentThatAlreadySent(
      "cool-firm.example",
      "founder@cool-firm.example",
      plus(NOW, -10 * DAY),
    );
    const fresh = await freshEnrollmentAwaitingItsOpener(company, "info@cool-firm.example");

    const stats = await tick(console_());
    expect(stats.stopped_cooldown).toBe(1);
    expect((await reload(fresh)).state).toBe("stopped");
    expect((await step(fresh, 0)).detail).toContain(`enrollment ${old.id}`);
  });

  it("a send older than the cooldown does not block a new enrollment", async () => {
    await stoppedEnrollmentThatAlreadySent(
      "cold-addr-old.example",
      "info@cold.example",
      plus(NOW, -40 * DAY),
    );
    const newCompany = await makeCompany(db(), { domain: "cold-addr-new.example" });
    const fresh = await freshEnrollmentAwaitingItsOpener(newCompany, "info@cold.example");

    const stats = await tick(console_());
    expect(stats.stopped_cooldown).toBe(0);
    expect(stats.sent).toBe(1);
    expect((await step(fresh, 0)).state).toBe("sent");
    const after = await reload(fresh);
    expect(after.state).toBe("finished");
    expect(after.stopReason).toBeNull();
  });
});

// --- 7-12. the pacing brakes ---------------------------------------------

describe("pacing", () => {
  it("a closed window sends nothing and touches nothing", async () => {
    const enrollment = await enrollOne("closed.example", "jane@closed.example");
    const shut = policyFrom({ WREN_SEND_WINDOW_START: "08:00", WREN_SEND_WINDOW_END: "09:00" });

    const stats = await tick(console_(), { policy: shut });
    expect(stats.window_closed).toBe(1);
    expect(stats.sent).toBe(0);
    for (const [key, value] of Object.entries(stats)) {
      if (key !== "window_closed") expect(value, key).toBe(0);
    }
    expect((await step(enrollment, 0)).state).toBe("approved");
  });

  it("the per-inbox daily cap holds the second message on one inbox", async () => {
    const first = await enrollOne("cap-one.example", "one@cap-one.example");
    const second = await enrollOne("cap-two.example", "two@cap-two.example");
    const stats = await tick(console_(), {
      policy: policyFrom({ WREN_COLD_SENDS_PER_INBOX_PER_DAY: "1" }),
    });
    expect(stats.sent).toBe(1);
    expect(stats.senders_capped).toBe(1);
    expect((await step(first, 0)).state).toBe("sent");
    expect((await step(second, 0)).state).toBe("approved");
  });

  it("the daily cap is per inbox, not per fleet", async () => {
    const first = await enrollOne("cap-a.example", "one@cap-a.example");
    const second = await enrollOne("cap-b.example", "two@cap-b.example", { sender: SENDER_B });
    const stats = await tick(console_(), {
      policy: policyFrom({ WREN_COLD_SENDS_PER_INBOX_PER_DAY: "1" }),
    });
    expect(stats.sent).toBe(2);
    expect(stats.senders_capped).toBe(0);
    expect((await step(first, 0)).state).toBe("sent");
    expect((await step(second, 0)).state).toBe("sent");
  });

  it("an inbox waits out its gap before sending again", async () => {
    const enrollment = await enrollOne("gap.example", "jane@gap.example");
    await stoppedEnrollmentThatAlreadySent(
      "gap-history.example",
      "past@gap-history.example",
      plus(NOW, -3 * MIN),
    );
    const paced = policyFrom({ WREN_SEND_GAP_MIN_MINUTES: "8", WREN_SEND_GAP_MAX_MINUTES: "20" });
    const stats = await tick(console_(), { policy: paced });
    expect(stats.gap_waiting).toBe(1);
    expect(stats.sent).toBe(0);
    expect((await step(enrollment, 0)).state).toBe("approved");
  });

  it("an inbox sends again once the gap has passed", async () => {
    const enrollment = await enrollOne("gap-ok.example", "jane@gap-ok.example");
    await stoppedEnrollmentThatAlreadySent(
      "gap-ok-history.example",
      "past@gap-ok-history.example",
      plus(NOW, -30 * MIN),
    );
    const paced = policyFrom({ WREN_SEND_GAP_MIN_MINUTES: "8", WREN_SEND_GAP_MAX_MINUTES: "20" });
    const stats = await tick(console_(), { policy: paced });
    expect(stats.gap_waiting).toBe(0);
    expect(stats.sent).toBe(1);
    expect((await step(enrollment, 0)).state).toBe("sent");
  });

  it("a due follow-up goes before a due opener on the same inbox", async () => {
    // The opener-only enrollment is created FIRST, so it has the lower id.
    const openerOnly = await enrollOne("fifo-opener.example", "new@fifo-opener.example");
    const riding = await enrollOne("fifo-thread.example", "live@fifo-thread.example");
    const ridingOpener = await step(riding, 0);
    await patchMessage(ridingOpener.id, {
      messageId: "<opener@wren-automation.test>",
      state: "sent",
      sentAt: plus(NOW, -10 * DAY),
      threadId: "thread-1",
    });

    const stats = await tick(console_(), {
      policy: policyFrom({ WREN_COLD_SENDS_PER_INBOX_PER_DAY: "1" }),
    });
    expect(stats.sent).toBe(1);
    expect(stats.senders_capped).toBe(1);
    expect((await step(riding, 1)).state).toBe("sent");
    expect((await step(openerOnly, 0)).state).toBe("approved");
  });

  it("the fleet-wide openers cap holds new conversations back", async () => {
    const first = await enrollOne("open-a.example", "one@open-a.example");
    const second = await enrollOne("open-b.example", "two@open-b.example", { sender: SENDER_B });
    const stats = await tick(console_(), { policy: policyFrom({ WREN_NEW_OPENERS_PER_DAY: "1" }) });
    expect(stats.sent).toBe(1);
    expect(stats.openers_capped).toBe(1);
    expect((await step(first, 0)).state).toBe("sent");
    expect((await step(second, 0)).state).toBe("approved");
  });

  it("a niche's own openers cap holds that campaign back and no other", async () => {
    const winding = await enrollOne("wind-a.example", "one@wind-a.example");
    const opening = await enrollOne("open-c.example", "two@open-c.example", { sender: SENDER_B });
    await db().update(enrollments).set({ niche: "agencies" }).where(eq(enrollments.id, winding.id));
    await db()
      .update(enrollments)
      .set({ niche: "recruiting" })
      .where(eq(enrollments.id, opening.id));
    const stats = await tick(console_(), {
      policy: policyFrom({ WREN_NICHE_OPENERS_PER_DAY: "agencies=0" }),
    });
    expect(stats.openers_capped).toBe(1);
    expect((await step(winding, 0)).state).toBe("approved");
    expect((await step(opening, 0)).state).toBe("sent");
  });

  it("a kill-switch pause does not stop a niche the switch is off for; an operator pause does", async () => {
    const agency = await enrollOne("ks-a.example", "one@ks-a.example");
    const recruit = await enrollOne("ks-b.example", "two@ks-b.example");
    await db().update(enrollments).set({ niche: "agencies" }).where(eq(enrollments.id, agency.id));
    await db()
      .update(enrollments)
      .set({ niche: "recruiting" })
      .where(eq(enrollments.id, recruit.id));
    const [pause] = await db()
      .insert(senderPauses)
      .values({
        sender: SENDER_A,
        domain: SENDER_A.slice(SENDER_A.lastIndexOf("@") + 1),
        reason: "hard bounces 2/80",
        source: "kill_switch",
      })
      .returning();
    const policy = policyFrom({ WREN_KILL_SWITCH_OFF_FOR: "agencies" });

    const stats = await tick(console_(), { policy });
    expect(stats.senders_paused).toBe(1);
    expect((await step(agency, 0)).state).toBe("sent");
    expect((await step(recruit, 0)).state).toBe("approved");

    await db()
      .update(senderPauses)
      .set({ source: "operator" })
      .where(eq(senderPauses.id, (pause as { id: number }).id));
    const another = await enrollOne("ks-c.example", "three@ks-c.example");
    await db().update(enrollments).set({ niche: "agencies" }).where(eq(enrollments.id, another.id));
    const held = await tick(console_(), { policy });
    expect(held.sent).toBe(0);
    expect((await step(another, 0)).state).toBe("approved");
  });

  it("a paused inbox sends nothing until the pause is lifted", async () => {
    const enrollment = await enrollOne("paused.example", "jane@paused.example");
    const [pause] = await db()
      .insert(senderPauses)
      .values({
        sender: SENDER_A,
        domain: SENDER_A.slice(SENDER_A.lastIndexOf("@") + 1),
        reason: "operator: checking placement",
        source: "operator",
      })
      .returning();

    const held = await tick(console_());
    expect(held.senders_paused).toBe(1);
    expect(held.sent).toBe(0);
    expect((await step(enrollment, 0)).state).toBe("approved");

    await db()
      .update(senderPauses)
      .set({ liftedAt: new Date() })
      .where(eq(senderPauses.id, (pause as { id: number }).id));
    const resumed = await tick(console_());
    expect(resumed.sent).toBe(1);
    expect((await step(enrollment, 0)).state).toBe("sent");
  });

  it("an inbox that left the roster stops sending", async () => {
    const ghost = await enrollOne("ghost.example", "jane@ghost.example", {
      sender: "ghost@wren-automation.test",
    });
    const live = await enrollOne("onroster.example", "jane@onroster.example");
    const transport = console_();

    const stats = await tick(transport, { senders: [SENDER_A] });
    expect(stats.sender_not_on_roster).toBe(1);
    expect(stats.sent).toBe(1);
    expect((await step(ghost, 0)).state).toBe("approved");
    expect((await step(live, 0)).state).toBe("sent");
    expect(transport.mailbox.has("ghost@wren-automation.test")).toBe(false);

    const unscoped = await tick(transport);
    expect(unscoped.sender_not_on_roster).toBe(0);
    expect(unscoped.sent).toBe(1);
    expect((await step(ghost, 0)).state).toBe("sent");
  });
});

// --- 13. what actually goes on the wire -----------------------------------

describe("the wire", () => {
  it("the outgoing email carries the identity and the thread", async () => {
    const enrollment = await enrollOne("wire.example", "jane@wire.example");
    const transport = console_();

    await tick(transport, { fromNames: { [SENDER_A]: "Ada Lovelace" } });
    const opener = await step(enrollment, 0);
    expect(opener.state).toBe("sent");
    const anchorDay = PlainDate.utcDayOf(opener.sentAt as Date);
    await tick(transport, { now: atNoon(addBusinessDays(anchorDay, 3)) });
    const followup = await step(enrollment, 1);
    expect(followup.state).toBe("sent");

    const outgoing = (transport.mailbox.get(SENDER_A) ?? []).map((e) => e.email);
    expect(outgoing).toHaveLength(2);
    const [sentOpener, sentFollowup] = outgoing as [OutgoingEmail, OutgoingEmail];

    expect(sentOpener.fromAddress).toBe(SENDER_A);
    expect(sentOpener.fromName).toBe("Ada Lovelace");
    expect(sentOpener.to).toBe("jane@wire.example");
    expect(sentOpener.subject).toBe("Quick question, Jane");
    expect(sentOpener.messageId).toBe(opener.messageId);
    expect(sentOpener.listUnsubscribe).toBe(`<mailto:${SENDER_A}?subject=unsubscribe>`);
    expect(sentOpener.inReplyTo).toBeNull();
    expect(sentOpener.references).toEqual([]);
    expect(sentOpener.threadId).toBeNull();

    expect(sentFollowup.fromAddress).toBe(SENDER_A);
    expect(sentFollowup.subject).toBeNull();
    expect(sentFollowup.replySubject).toBe("Quick question, Jane");
    expect(sentFollowup.inReplyTo).toBe(opener.messageId);
    expect(sentFollowup.references).toEqual([opener.messageId]);
    expect(sentFollowup.threadId).toBe(opener.threadId);
    expect(sentFollowup.listUnsubscribe).toBe(`<mailto:${SENDER_A}?subject=unsubscribe>`);

    expect(opener.gmailId).toBe("console-1");
    expect(followup.gmailId).toBe("console-2");
    expect(followup.threadId).toBe(opener.threadId);
  });

  it("the sign-off links the niche page of each message", async () => {
    const enrollment = await enrollOne("wire.example", "jane@wire.example");
    const transport = console_();
    const authored = '<a href="https://wrenautomation.com{page}">wrenautomation.com{page}</a>';

    await tick(transport, { signatureHtml: { [SENDER_A]: authored }, pages: { sec_ria: "/ria" } });
    expect((await step(enrollment, 0)).state).toBe("sent");
    expect(delivered(transport)[0]?.signatureHtml).toBe(
      '<a href="https://wrenautomation.com/ria">wrenautomation.com/ria</a>',
    );

    const other = await enrollOne("bare.example", "bo@bare.example");
    await tick(transport, {
      signatureHtml: { [SENDER_A]: authored },
      pages: {},
      now: plus(NOW, HOUR),
    });
    expect((await step(other, 0)).state).toBe("sent");
    expect(delivered(transport).at(-1)?.signatureHtml).toBe(
      '<a href="https://wrenautomation.com">wrenautomation.com</a>',
    );
  });

  it("the Message-ID is committed before the transport is called", async () => {
    const enrollment = await enrollOne("intent.example", "jane@intent.example");
    let observed: { state: string; message_id: string | null } | null = null;
    const transport: Transport = {
      name: "console",
      async send(email) {
        const rows = await db().execute(
          sql`SELECT state, message_id FROM messages WHERE message_id = ${email.messageId}`,
        );
        observed = (rows[0] as { state: string; message_id: string | null } | undefined) ?? null;
        throw new TransportRefused("checked, now refuse");
      },
      async find() {
        return null;
      },
    };

    await tick(transport);
    expect(observed, "the intent row was not in the database yet").not.toBeNull();
    const row = observed as unknown as { state: string; message_id: string | null };
    expect(row.state).toBe("sending");
    expect(row.message_id).not.toBeNull();
    expect((await step(enrollment, 0)).messageId).toBe(row.message_id);
    expect(row.message_id).toMatch(/@wren-automation\.test>$/);
  });
});

// --- 16. two ticks at once -------------------------------------------------

/** A console transport with a hook between the committed intent and the send. */
function hooked(inner: ConsoleTransport, beforeSend: () => Promise<void>): Transport {
  return {
    name: inner.name,
    async send(email) {
      await beforeSend();
      return inner.send(email);
    },
    find: (sender, id) => inner.find(sender, id),
  };
}

describe("overlapping ticks", () => {
  it("a second tick mid-walk never sends the same message twice", async () => {
    const first = await enrollOne("race-a.example", "one@race-a.example");
    const second = await enrollOne("race-b.example", "two@race-b.example", { sender: SENDER_B });
    const third = await enrollOne("race-c.example", "three@race-c.example", { sender: SENDER_C });
    const wireA = console_();
    const wireB = console_();
    let statsB: Awaited<ReturnType<typeof sendDue>> | null = null;

    // Walker A committed its intent for the first message and is inside the
    // send when a whole second tick runs: what a cron overlap looks like.
    const statsA = await tick(
      hooked(wireA, async () => {
        if (statsB !== null) return;
        statsB = await tick(wireB);
      }),
    );
    if (statsB === null) throw new Error("walker B never ran");
    const b = statsB as Awaited<ReturnType<typeof sendDue>>;

    expect(statsA.sent).toBe(1);
    expect(b.sent).toBe(2);
    expect(b.awaiting_reconcile).toBe(1);
    expect(statsA.raced).toBe(b.sent);

    const all = [...delivered(wireA), ...delivered(wireB)];
    expect(all.map((e) => e.to).sort()).toEqual([
      "one@race-a.example",
      "three@race-c.example",
      "two@race-b.example",
    ]);
    const rows = [await step(first, 0), await step(second, 0), await step(third, 0)];
    expect(rows.map((r) => r.state)).toEqual(["sent", "sent", "sent"]);
    expect(new Set(all.map((e) => e.messageId)).size).toBe(3);
    expect(new Set(rows.map((r) => r.messageId))).toEqual(new Set(all.map((e) => e.messageId)));
  });

  it("a stop by another tick holds back the step this walk still thinks is live", async () => {
    const first = await enrollOne("stop-race-a.example", "one@stop-race-a.example");
    const second = await enrollOne("stop-race-b.example", "two@stop-race-b.example", {
      sender: SENDER_B,
    });
    const wire = console_();
    let stopped = false;

    const stats = await tick(
      hooked(wire, async () => {
        if (stopped) return;
        stopped = true;
        await recordStop(db(), await reload(second), "reply", {
          detail: "she replied while the tick was running",
        });
      }),
    );

    expect(stats.sent).toBe(1);
    expect(stats.raced).toBe(1);
    expect(delivered(wire).map((e) => e.to)).toEqual(["one@stop-race-a.example"]);
    expect((await step(first, 0)).state).toBe("sent");
    expect((await reload(second)).state).toBe("stopped");
    expect((await step(second, 0)).state).toBe("skipped");
    expect((await step(second, 0)).messageId).toBeNull();
  });
});

// --- the lead's own window -------------------------------------------------

describe("the lead's window", () => {
  const afterLunch = () =>
    policyFrom({
      WREN_SEND_TIMEZONE: "America/New_York",
      WREN_SEND_WINDOW_START: "13:00",
      WREN_SEND_WINDOW_END: "19:00",
      WREN_SEND_LEAD_WINDOW_START: "13:00",
      WREN_SEND_LEAD_WINDOW_END: "16:00",
    });
  const setZone = (companyId: number, timezone: string) =>
    db().update(companies).set({ timezone }).where(eq(companies.id, companyId));

  it("a message waits for the lead's own afternoon", async () => {
    const eastern = await enrollOne("lead-et.example", "a@lead-et.example");
    const pacific = await enrollOne("lead-pt.example", "b@lead-pt.example", { sender: SENDER_B });
    const zoneless = await enrollOne("lead-xx.example", "c@lead-xx.example", { sender: SENDER_C });
    await setZone(eastern.companyId, "America/New_York");
    await setZone(pacific.companyId, "America/Los_Angeles");
    const et1330 = new Date(Date.UTC(2026, 11, 2, 18, 30)); // EST: 13:30 ET, 10:30 PT

    const stats = await tick(console_(), { policy: afterLunch(), now: et1330 });
    expect(stats.sent).toBe(2);
    expect(stats.lead_window_waiting).toBe(1);
    expect((await step(eastern, 0)).state).toBe("sent");
    expect((await step(zoneless, 0)).state).toBe("sent");
    expect((await step(pacific, 0)).state).toBe("approved");

    const later = await tick(console_(), { policy: afterLunch(), now: plus(et1330, 3 * HOUR) });
    expect(later.sent).toBe(1);
    expect(later.lead_window_waiting).toBe(0);
    expect((await step(pacific, 0)).state).toBe("sent");
  });

  it("a stored zone that is not a zone stops the tick before any send", async () => {
    const enrollment = await enrollOne("lead-bad.example", "a@lead-bad.example");
    await setZone(enrollment.companyId, "Mars/Olympus_Mons");
    const policy = policyFrom({
      WREN_SEND_LEAD_WINDOW_START: "13:00",
      WREN_SEND_LEAD_WINDOW_END: "16:00",
    });
    await expect(tick(console_(), { policy })).rejects.toThrow("Mars/Olympus_Mons");
    expect((await step(enrollment, 0)).state).toBe("approved");
  });
});
