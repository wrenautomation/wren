/**
 * The inbound sync against the migrated schema.
 *
 * Every case drives `syncInbox` through a fake mailbox holding the real `.eml`
 * shapes from `test/fixtures/inbound/` — the classification itself is
 * unit-tested against those bytes; what this file proves is everything around
 * it: which enrollment a message is attached to, that the evidence row is
 * written exactly once, that the stop and the suppression follow C-D5, and
 * that one unreadable message (or one unreachable inbox) never costs the rest
 * of the fleet its sync.
 *
 * The fixtures name our Message-ID as `<abc@wren-automation.com>` in every
 * threading header and in the DSNs' embedded originals, so a single string
 * replace re-points a whole message at the enrollment under test.
 */
import {
  type Suppression,
  type SuppressionEvent,
  suppressionEvents,
  suppressions,
} from "@wren/core";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type InboxReader,
  labelEvent,
  recordOperatorReply,
  syncInbox,
} from "../../src/inbox/sync.js";
import {
  type Enrollment,
  enrollments,
  type InboxSync,
  inboxSyncs,
  messages,
  type ThreadEvent,
  threadEvents,
} from "../../src/schema.js";
import { transitionMessage } from "../../src/state.js";
import {
  makeCompany,
  makePerson,
  messagesOf,
  runCompose,
  SENDER,
  TABLES,
} from "./compose-fixtures.js";
import {
  DAY,
  FakeReader,
  hoursAgo,
  load,
  NOW,
  OTHER_SENDER,
  OUR_ID,
  THREAD,
} from "./inbox-fixtures.js";

// --------------------------------------------------------------------------
// Database

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() =>
  truncate(pg.db, [...TABLES, "sender_pauses", "suppression_events", "inbox_syncs"]),
);
const db = (): Db => pg.db;

/**
 * One company enrolled through the real compose, with its opener marked SENT
 * directly — the outbox walk is another file's subject; this one is about
 * what comes *back*.
 */
async function enroll(opts: {
  domain: string;
  email: string;
  full?: string;
  first?: string;
  sender?: string;
  ourId?: string;
  threadId?: string;
  gmailId?: string;
}): Promise<Enrollment> {
  const company = await makeCompany(db(), { domain: opts.domain });
  await makePerson(db(), company, {
    email: opts.email,
    full: opts.full ?? "Jane Doe",
    first: opts.first ?? "Jane",
  });
  await runCompose(db(), { senders: [opts.sender ?? SENDER], autoApprove: true });
  const [enrollment] = await db()
    .select()
    .from(enrollments)
    .where(eq(enrollments.toEmail, opts.email));
  if (!enrollment) throw new Error(`compose did not enroll ${opts.email}`);
  const [opener] = await messagesOf(db(), enrollment);
  if (!opener) throw new Error("no opener");
  // The outbox walk's own path (APPROVED → SENDING → SENT) without the walk.
  const sending = transitionMessage(opener.state, "sending");
  const sent = transitionMessage(sending, "sent");
  await db()
    .update(messages)
    .set({
      messageId: opts.ourId ?? OUR_ID,
      state: sent,
      attemptedAt: new Date(NOW.getTime() - DAY),
      transport: "gmail",
      sentAt: new Date(NOW.getTime() - DAY),
      threadId: opts.threadId ?? THREAD,
      gmailId: opts.gmailId ?? "g-sent",
    })
    .where(eq(messages.id, opener.id));
  return enrollment;
}

const runSync = (reader: InboxReader, senders: readonly string[] = [SENDER]) =>
  syncInbox(db(), { reader, senders, now: NOW });

const events = (): Promise<ThreadEvent[]> =>
  db().select().from(threadEvents).orderBy(asc(threadEvents.id));
const allSuppressions = (): Promise<Suppression[]> =>
  db().select().from(suppressions).orderBy(asc(suppressions.id));
const allSuppressionEvents = (): Promise<SuppressionEvent[]> =>
  db().select().from(suppressionEvents);

async function reload(enrollment: Enrollment): Promise<Enrollment> {
  const [row] = await db().select().from(enrollments).where(eq(enrollments.id, enrollment.id));
  if (!row) throw new Error(`enrollment ${enrollment.id} vanished`);
  return row;
}

async function cursorOf(sender: string): Promise<InboxSync> {
  const [row] = await db().select().from(inboxSyncs).where(eq(inboxSyncs.sender, sender));
  if (!row) throw new Error(`no inbox_syncs row for ${sender}`);
  return row;
}

const afterOf = (query: string) => Number(/after:(\d+)/.exec(query)?.[1]);
const first = <T>(rows: T[]): T => {
  const row = rows[0];
  if (row === undefined) throw new Error("expected at least one row");
  return row;
};

// --------------------------------------------------------------------------
// Bounces

describe("bounces", () => {
  it("a hard DSN stops the enrollment and suppresses the address", async () => {
    const enrollment = await enroll({ domain: "bounce.example", email: "nobody@example.com" });
    const reader = new FakeReader().add(SENDER, "g-dsn", load("gmail_dsn_hard"), {
      threadId: THREAD,
      when: hoursAgo(2),
    });

    const stats = await runSync(reader);

    expect([stats.matched, stats.bounces_hard, stats.stopped_bounce]).toEqual([1, 1, 1]);
    const event = first(await events());
    const [opener, followup] = await messagesOf(db(), enrollment);
    expect(event.kind).toBe("bounce");
    expect(event.bounceClass).toBe("hard");
    expect(event.enrollmentId).toBe(enrollment.id);
    expect(event.inReplyToMessageId).toBe(opener?.id);
    expect(event.gmailId).toBe("g-dsn");
    expect(event.gmailThreadId).toBe(THREAD);
    expect(event.detail).toContain("5.1.1");
    expect((event.headers as Record<string, string>).From).toMatch(/^Mail Delivery Subsystem/);
    expect(event.receivedAt).toEqual(hoursAgo(2));
    expect(event.disposition).toBeNull();

    const after = await reload(enrollment);
    expect(after.state).toBe("stopped");
    expect(after.stopReason).toBe("bounce");
    expect(followup?.state).toBe("skipped");
    const suppression = first(await allSuppressions());
    expect([suppression.value, suppression.reason]).toEqual(["nobody@example.com", "bounce"]);
    const trail = (await allSuppressionEvents()).filter((e) => e.suppressionId === suppression.id);
    expect(trail.length).toBeGreaterThan(0);
  });

  it("a delayed DSN records evidence and nothing else", async () => {
    const enrollment = await enroll({ domain: "slow.example", email: "slow@example.net" });
    const reader = new FakeReader().add(SENDER, "g-delay", load("gmail_dsn_delayed"), {
      threadId: THREAD,
      when: hoursAgo(3),
    });

    const stats = await runSync(reader);

    expect([stats.bounces_soft, stats.stopped_bounce]).toEqual([1, 0]);
    expect(first(await events()).bounceClass).toBe("soft");
    expect((await reload(enrollment)).state).toBe("active");
    expect(await allSuppressions()).toEqual([]);
  });

  it("a DSN naming another address suppresses and stops nothing (C-D9)", async () => {
    const enrollment = await enroll({
      domain: "mismatch.example",
      email: "dana@mismatch.example",
    });
    const reader = new FakeReader().add(SENDER, "g-dsn", load("gmail_dsn_hard"), {
      threadId: "t-elsewhere", // forces the embedded-original match
      when: hoursAgo(1),
    });

    const stats = await runSync(reader);

    expect(stats.matched_by_embedded_original).toBe(1);
    expect(stats.bounce_address_mismatch).toBe(1);
    // Counted as a hard bounce (the kill switch reads the event), acted on as nothing at all.
    expect([stats.bounces_hard, stats.stopped_bounce, stats.suppressed_post_finish]).toEqual([
      1, 0, 0,
    ]);
    const event = first(await events());
    expect(event.kind).toBe("bounce");
    expect(event.bounceClass).toBe("hard");
    expect(event.detail).toContain(
      "DSN names nobody@example.com, we mailed dana@mismatch.example — not suppressed, thread continues",
    );
    expect((await reload(enrollment)).state).toBe("active");
    const [, followup] = await messagesOf(db(), enrollment);
    expect(followup?.state).toBe("approved");
    expect(await allSuppressions()).toEqual([]);
  });

  it("a DSN naming the mailed address stops and suppresses whatever the case", async () => {
    const enrollment = await enroll({ domain: "cased.example", email: "nobody@example.com" });
    await db()
      .update(enrollments)
      .set({ toEmail: "NoBody@Example.com" })
      .where(eq(enrollments.id, enrollment.id));
    const reader = new FakeReader().add(SENDER, "g-dsn", load("gmail_dsn_hard"), {
      threadId: THREAD,
      when: hoursAgo(1),
    });

    const stats = await runSync(reader);

    expect([stats.bounce_address_mismatch, stats.stopped_bounce]).toEqual([0, 1]);
    const detail = first(await events()).detail ?? "";
    expect(detail).toContain("reported nobody@example.com");
    expect(detail).not.toContain("not suppressed");
    const after = await reload(enrollment);
    expect(after.state).toBe("stopped");
    expect(after.stopReason).toBe("bounce");
    expect((await allSuppressions()).map((s) => s.value)).toEqual(["nobody@example.com"]);
  });

  it("a DSN naming no recipient at all stops and suppresses", async () => {
    const enrollment = await enroll({ domain: "anon.example", email: "gone@anon.example" });
    const anonymous = new TextEncoder().encode(
      [
        "From: Mail Delivery Subsystem <mailer-daemon@example.net>",
        `To: ${SENDER}`,
        "Subject: Delivery Status Notification (Failure)",
        "Date: Mon, 7 Sep 2026 12:00:00 +0000",
        "Message-ID: <daemon-anon@example.net>",
        `References: ${OUR_ID}`,
        'Content-Type: text/plain; charset="utf-8"',
        "",
        "Your message could not be delivered.",
        "",
        "The remote server said: 550 5.1.1 unknown recipient",
        "",
      ].join("\n"),
    );
    const reader = new FakeReader().add(SENDER, "g-anon", anonymous, {
      threadId: THREAD,
      when: hoursAgo(1),
    });

    const stats = await runSync(reader);

    expect([stats.bounces_hard, stats.bounce_address_mismatch, stats.stopped_bounce]).toEqual([
      1, 0, 1,
    ]);
    const detail = first(await events()).detail ?? "";
    expect(detail.startsWith("status 5.1.1")).toBe(true);
    expect(detail).not.toContain("not suppressed");
    expect((await reload(enrollment)).state).toBe("stopped");
    expect((await allSuppressions()).map((s) => s.value)).toEqual(["gone@anon.example"]);
  });
});

// --------------------------------------------------------------------------
// Auto-replies, unsubscribes, receipts

describe("auto-replies, unsubscribes, receipts", () => {
  it.each(["ooo_auto_submitted", "ooo_subject_only", "ooo_x_auto_response_suppress"])(
    "%s is an event and never a stop",
    async (fixture) => {
      const enrollment = await enroll({
        domain: `${fixture.replaceAll("_", "-")}.example`,
        email: `${fixture}@example.com`,
      });
      const reader = new FakeReader().add(SENDER, "g-ooo", load(fixture), {
        threadId: THREAD,
        when: hoursAgo(4),
      });

      const stats = await runSync(reader);

      expect(stats.auto_replies).toBe(1);
      expect(stats.replied).toEqual([]);
      expect(stats.matched_by_in_reply_to).toBe(1);
      expect(first(await events()).kind).toBe("auto_reply");
      expect((await reload(enrollment)).state).toBe("active");
      expect(await allSuppressions()).toEqual([]);
    },
  );

  it("an out-of-office with a return day holds the enrollment until then", async () => {
    const enrollment = await enroll({ domain: "leave.example", email: "dana@example.com" });
    const reader = new FakeReader().add(SENDER, "g-leave", load("ooo_auto_submitted"), {
      threadId: THREAD,
      when: hoursAgo(4),
    });

    const stats = await runSync(reader);

    expect(stats.held_away).toBe(1);
    expect(first(await events()).detail).toBe("away until 2026-09-21");
    const after = await reload(enrollment);
    expect([after.state, after.awayUntil]).toEqual(["active", "2026-09-21"]);
  });

  it("a short unsubscribe in thread stops and suppresses", async () => {
    const enrollment = await enroll({ domain: "unsub.example", email: "pat@example.net" });
    const reader = new FakeReader().add(SENDER, "g-unsub", load("unsubscribe_short"), {
      threadId: THREAD,
      when: hoursAgo(5),
    });

    const stats = await runSync(reader);

    expect([stats.unsubscribes, stats.stopped_opt_out]).toEqual([1, 1]);
    expect(stats.matched_by_in_reply_to).toBe(1);
    expect(first(await events()).kind).toBe("unsubscribe");
    const after = await reload(enrollment);
    expect(after.state).toBe("stopped");
    expect(after.stopReason).toBe("opt_out");
    const suppression = first(await allSuppressions());
    expect([suppression.value, suppression.reason]).toEqual(["pat@example.net", "opt_out"]);
  });

  it("an unsubscribe with no threading headers matches on the From address (C-D4)", async () => {
    const enrollment = await enroll({ domain: "mailto.example", email: "chris@example.com" });
    const reader = new FakeReader().add(SENDER, "g-mailto", load("unsubscribe_mailto"), {
      threadId: "t-fresh",
      when: hoursAgo(6),
    });

    const stats = await runSync(reader);

    expect(stats.matched_by_from).toBe(1);
    expect([stats.unsubscribes, stats.stopped_opt_out]).toEqual([1, 1]);
    const event = first(await events());
    expect(event.kind).toBe("unsubscribe");
    // Nothing named which of our sends it answers; guessing would misattribute step health.
    expect(event.inReplyToMessageId).toBeNull();
    expect((await reload(enrollment)).stopReason).toBe("opt_out");
    expect((await allSuppressions()).map((s) => s.value)).toEqual(["chris@example.com"]);
  });

  it("a read receipt is a note", async () => {
    const enrollment = await enroll({ domain: "receipt.example", email: "lee@example.com" });
    const reader = new FakeReader().add(SENDER, "g-mdn", load("receipt_mdn"), {
      threadId: THREAD,
      when: hoursAgo(7),
    });

    const stats = await runSync(reader);

    expect(stats.receipts).toBe(1);
    const event = first(await events());
    expect(event.kind).toBe("note");
    expect(event.detail).toBe("receipt");
    expect((await reload(enrollment)).state).toBe("active");
  });
});

// --------------------------------------------------------------------------
// Replies

describe("replies", () => {
  it("a human reply stops the company and carries no disposition", async () => {
    const enrollment = await enroll({ domain: "reply.example", email: "jordan@example.com" });
    // A live thread at a DIFFERENT firm proves the stop is company-scoped.
    const elsewhere = await enroll({
      domain: "elsewhere.example",
      email: "sam@elsewhere.example",
      full: "Sam Reed",
      first: "Sam",
      ourId: "<other@wren-automation.test>",
      threadId: "t-other",
      gmailId: "g-other",
    });
    const reader = new FakeReader().add(SENDER, "g-reply", load("human_reply"), {
      threadId: THREAD,
      when: hoursAgo(8),
    });

    const stats = await runSync(reader);

    expect([stats.replies, stats.stopped_reply]).toEqual([1, 1]);
    // The enrollment it replied on, for a Reply trigger.
    expect(stats.replied).toEqual([expect.any(Number)]);
    // Gmail's own reply carries References but no In-Reply-To.
    expect(stats.matched_by_references).toBe(1);
    const event = first(await events());
    expect(event.kind).toBe("reply");
    expect(event.disposition).toBeNull();
    expect(event.dispositionSource).toBeNull();
    expect(event.fromAddress).toBe("jordan.blake@example.com");
    expect(event.snippet).toContain("overflow work");
    const after = await reload(enrollment);
    expect(after.state).toBe("stopped");
    expect(after.stopReason).toBe("reply");
    expect((await reload(elsewhere)).state).toBe("active");
    // A reply is not a do-not-contact promise (C-D5).
    expect(await allSuppressions()).toEqual([]);
  });

  it("a reply with no threading headers matches on the provider thread", async () => {
    const enrollment = await enroll({ domain: "threaded.example", email: "jordan@example.com" });
    const reader = new FakeReader().add(
      SENDER,
      "g-thread",
      load("human_reply", { drop: ["References", "In-Reply-To"] }),
      { threadId: THREAD, when: hoursAgo(9) },
    );

    const stats = await runSync(reader);

    expect(stats.matched_by_thread).toBe(1);
    const event = first(await events());
    expect(event.kind).toBe("reply");
    const [opener] = await messagesOf(db(), enrollment);
    expect(event.inReplyToMessageId).toBe(opener?.id);
  });
});

// --------------------------------------------------------------------------
// What is not ours

describe("unrelated mail", () => {
  it("warmup mail is listed and never stored", async () => {
    await enroll({ domain: "warmup.example", email: "jane@warmup.example" });
    const reader = new FakeReader().add(SENDER, "g-warm", load("warmup_like"), {
      threadId: "t-warm",
      when: hoursAgo(10),
    });

    const stats = await runSync(reader);

    expect([stats.listed, stats.unrelated, stats.matched]).toEqual([1, 1, 0]);
    expect(await events()).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// Idempotence and the cursor

describe("idempotence and the cursor", () => {
  it("a second sync writes nothing and re-applies no stop", async () => {
    const enrollment = await enroll({ domain: "again.example", email: "nobody@example.com" });
    const reader = new FakeReader()
      .add(SENDER, "g-dsn", load("gmail_dsn_hard"), { threadId: THREAD, when: hoursAgo(2) })
      .add(SENDER, "g-warm", load("warmup_like"), { threadId: "t-warm", when: hoursAgo(3) });
    const firstRun = await runSync(reader);
    expect([firstRun.matched, firstRun.already_seen]).toEqual([1, 0]);
    const cursorAfterFirst = (await cursorOf(SENDER)).cursorMs;
    const stoppedAt = (await reload(enrollment)).stoppedAt;
    const trail = (await allSuppressionEvents()).length;

    const second = await runSync(reader);

    expect(second.listed).toBe(2);
    expect(second.already_seen).toBe(1); // the stored one; warmup is re-judged unrelated
    expect(second.unrelated).toBe(1);
    expect(second.matched).toBe(0);
    expect((await events()).length).toBe(1);
    expect((await reload(enrollment)).stoppedAt).toEqual(stoppedAt);
    expect((await allSuppressionEvents()).length).toBe(trail);
    expect((await cursorOf(SENDER)).cursorMs).toBe(cursorAfterFirst);
  });

  it("the cursor advances to the newest message and the next query overlaps", async () => {
    await enroll({ domain: "cursor.example", email: "jane@cursor.example" });
    const newest = hoursAgo(2);
    const reader = new FakeReader()
      .add(SENDER, "g-a", load("warmup_like"), { threadId: "t-a", when: hoursAgo(30) })
      .add(SENDER, "g-b", load("warmup_like"), { threadId: "t-b", when: newest });

    await runSync(reader);
    const cursor = await cursorOf(SENDER);
    expect(cursor.cursorMs).toBe(newest.getTime());
    expect(cursor.syncedAt).toEqual(NOW);
    expect((cursor.stats as { listed: number }).listed).toBe(2);
    expect(afterOf(first(reader.queries)[1])).toBe(Math.floor((NOW.getTime() - 30 * DAY) / 1000));

    await runSync(reader);

    const last = reader.queries.at(-1);
    expect(afterOf(last?.[1] ?? "")).toBe(Math.floor((newest.getTime() - DAY) / 1000));
  });

  it("the sync asks the mailbox for spam and trash too", async () => {
    await enroll({ domain: "spam.example", email: "nobody@example.com" });
    const reader = new FakeReader()
      .add(SENDER, "g-1", load("gmail_dsn_hard"), { threadId: THREAD, when: hoursAgo(1) })
      .add(SENDER, "g-2", load("warmup_like"), { threadId: "t-w", when: hoursAgo(2) })
      .add(SENDER, "g-3", load("warmup_like"), { threadId: "t-x", when: hoursAgo(3) });

    await runSync(reader);

    expect(reader.listOpts.length).toBe(2); // the fake pages two ids at a time
    expect(reader.listOpts.every((call) => call.includeSpamTrash)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// A mailbox that misbehaves

describe("a mailbox that misbehaves", () => {
  it("one unreadable message costs only itself", async () => {
    await enroll({ domain: "reader.example", email: "nobody@example.com" });
    const reader = new FakeReader()
      .add(SENDER, "g-bad", load("warmup_like"), { threadId: "t-bad", when: hoursAgo(1) })
      .add(SENDER, "g-dsn", load("gmail_dsn_hard"), { threadId: THREAD, when: hoursAgo(2) });
    reader.raiseOnId.add("g-bad");

    const stats = await runSync(reader);

    expect([stats.listed, stats.read_errors, stats.bounces_hard]).toEqual([2, 1, 1]);
    expect((await events()).length).toBe(1);
  });

  it("an unreadable inbox does not stop the rest of the fleet", async () => {
    await enroll({ domain: "fleet.example", email: "nobody@example.com" });
    const reader = new FakeReader().add(OTHER_SENDER, "g-dsn", load("gmail_dsn_hard"), {
      threadId: THREAD,
      when: hoursAgo(2),
    });
    reader.raiseOnList.add(SENDER);

    const stats = await runSync(reader, [SENDER, OTHER_SENDER]);

    expect([stats.senders, stats.sender_errors]).toEqual([2, 1]);
    expect(stats.bounces_hard).toBe(1);
    // The failed inbox keeps its cursor: Gmail lists newest first, so
    // advancing past a page we never received would skip it forever.
    const failed = await cursorOf(SENDER);
    expect(failed.cursorMs).toBe(0);
    expect(failed.syncedAt).toBeNull();
    expect((await cursorOf(OTHER_SENDER)).cursorMs).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------
// Labels and the operator's own entries

describe("labels and operator entries", () => {
  it("only a human reply can carry a disposition", async () => {
    await enroll({ domain: "label.example", email: "nobody@example.com" });
    const reader = new FakeReader().add(SENDER, "g-dsn", load("gmail_dsn_hard"), {
      threadId: THREAD,
      when: hoursAgo(2),
    });
    await runSync(reader);
    const bounce = first(await events());

    await expect(
      labelEvent(db(), { event: bounce, disposition: "interested", now: NOW }),
    ).rejects.toThrow(/not a reply/);
  });

  it("labelEvent sets the one mutable label", async () => {
    await enroll({ domain: "labelled.example", email: "jordan@example.com" });
    const reader = new FakeReader().add(SENDER, "g-reply", load("human_reply"), {
      threadId: THREAD,
      when: hoursAgo(2),
    });
    await runSync(reader);
    const reply = first(await events());

    await labelEvent(db(), { event: reply, disposition: "interested", now: NOW });

    const after = first(await events());
    expect(after.disposition).toBe("interested");
    expect(after.dispositionSource).toBe("operator");
    expect(after.classifiedAt).toEqual(NOW);
  });

  it("recordOperatorReply writes the event and stops the company", async () => {
    const enrollment = await enroll({ domain: "phone.example", email: "jane@phone.example" });

    const event = await recordOperatorReply(db(), {
      enrollment,
      disposition: "meeting_booked",
      note: "called back, booked Thursday",
      fromAddress: "jane@phone.example",
      now: NOW,
    });

    expect(event.kind).toBe("reply");
    expect(event.gmailId).toBeNull(); // why the idempotence index is partial
    expect(event.dispositionSource).toBe("operator");
    expect(event.classifiedAt).toEqual(NOW);
    expect(event.detail).toBe("called back, booked Thursday");
    const after = await reload(enrollment);
    expect(after.state).toBe("stopped");
    expect(after.stopReason).toBe("reply");
  });
});
