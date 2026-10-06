/**
 * Speed to lead with William's yes, against the migrated schema: a fresh warm
 * reply that takes a time is proposed with a drafted reply, and only approve
 * books and sends; anything else is one `needs_you` ping; a stale, operator
 * labelled, or cold reply is never touched.
 */
import { FakeCalendar } from "@wren/core/calendar";
import type { Notifier } from "@wren/core/notify";
import { parseTemplate } from "@wren/core/slots";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approveInvite, dropInvite, runInvites } from "../../src/inbox/invite.js";
import type { ReplyCopy } from "../../src/inbox/reply.js";
import { sequence, sequenceStep } from "../../src/outreach/sequences.js";
import {
  callInvites,
  type Enrollment,
  enrollments,
  messages,
  type ThreadEvent,
  threadEvents,
} from "../../src/schema.js";
import { ConsoleTransport } from "../../src/send/transport.js";
import { transitionMessage } from "../../src/state.js";
import {
  makeCompany,
  makePerson,
  messagesOf,
  runCompose,
  SENDER,
  SEQ,
  TABLES,
} from "./compose-fixtures.js";

// Monday 2026-10-05, 9am ET.
const NOW = new Date(Date.UTC(2026, 9, 5, 13));
const HOUR = 3_600_000;
const TUE_10 = new Date(Date.UTC(2026, 9, 6, 14));
const WED_2 = new Date(Date.UTC(2026, 9, 7, 18));

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, [...TABLES, "call_invites"]));
const db = (): Db => pg.db;

/** One firm whose opener went out offering Tuesday 10am and Wednesday 2pm. */
async function offered(domain = "oak.example"): Promise<Enrollment> {
  const company = await makeCompany(db(), { domain });
  await makePerson(db(), company, { email: `jane@${domain}` });
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
      state: transitionMessage(transitionMessage(opener.state, "sending"), "sent"),
      messageId: `<${domain}@test>`,
      threadId: `t-${domain}`,
      sentAt: new Date(NOW.getTime() - 24 * HOUR),
      offeredTimes: [TUE_10.toISOString(), WED_2.toISOString()],
    })
    .where(eq(messages.id, opener.id));
  return enrollment;
}

async function warmReply(
  enrollment: Enrollment,
  text: string,
  opts: { ago?: number; source?: "llm" | "operator"; disposition?: "interested" | "not_now" } = {},
): Promise<ThreadEvent> {
  const [event] = await db()
    .insert(threadEvents)
    .values({
      enrollmentId: enrollment.id,
      kind: "reply",
      gmailId: `g-${text.length}-${opts.ago ?? 0}`,
      gmailThreadId: `t-${enrollment.toEmail.split("@")[1]}`,
      headers: { "Message-ID": `<reply-${text.length}@them>` },
      fromAddress: enrollment.toEmail,
      snippet: text,
      bodyText: text,
      receivedAt: new Date(NOW.getTime() - (opts.ago ?? HOUR)),
      disposition: opts.disposition ?? "interested",
      dispositionSource: opts.source ?? "llm",
    })
    .returning();
  if (!event) throw new Error("no event");
  return event;
}

const reading = (r: Record<string, unknown>) => new FakeLlm({ respond: () => JSON.stringify(r) });

function pings() {
  const sent: { title: string; body: string; level: string }[] = [];
  const notifier: Notifier = {
    name: "test",
    notify: async (title, body, level) => {
      sent.push({ title, body: body ?? "", level: level ?? "info" });
      return true;
    },
  };
  return { sent, notifier };
}

const rows = () => db().select().from(callInvites);

/** The test sequence as an arm ("arm/opener") whose reply copy names the booked time. */
const COPY: ReplyCopy = {
  sequences: new Map([[SEQ.name, sequence(SEQ.name, [sequenceStep("arm/opener", 0)])]]),
  offerFacts: new Map(),
  templates: new Map([
    [
      "arm/reply",
      parseTemplate(
        "arm/reply",
        "Hi {first_name|there},\n\nSent you the invite(( for {call.booked})).\n",
      ),
    ],
  ]),
  factsView: null,
  signatures: { [SENDER]: "William" },
};
const COPIES = new Map([["sec_ria", COPY]]);
const quiet = () => new ConsoleTransport({ write: () => {} });
const FLEET = { fromNames: { [SENDER]: "William Jin" }, signatureHtml: {}, pages: {} };
const takesWednesday = () =>
  reading({
    pick: "offered",
    start: "2026-10-07T14:00",
    evidence: "Wednesday works",
    confidence: 0.9,
  });

describe("call invites", () => {
  it("a reply that takes an offered time is proposed with a draft; nothing books or sends", async () => {
    const enrollment = await offered();
    await warmReply(enrollment, "Wednesday works, thanks.");
    const calendar = new FakeCalendar([TUE_10, WED_2]);
    const { sent, notifier } = pings();
    const llm = takesWednesday();

    const stats = await runInvites(db(), llm, { calendar, notifier, copies: COPIES, now: NOW });
    const again = await runInvites(db(), llm, { calendar, notifier, copies: COPIES, now: NOW });

    expect([stats.selected, stats.proposed, again.selected]).toEqual([1, 1, 0]);
    expect(calendar.bookings).toEqual([]);
    const [row] = await rows();
    expect([row?.state, row?.start, row?.bookingUid]).toEqual(["proposed", WED_2, null]);
    const [draft] = await db()
      .select()
      .from(messages)
      .where(eq(messages.id, row?.replyMessageId ?? -1));
    expect([draft?.state, draft?.subject, draft?.template]).toEqual(["draft", null, "arm/reply"]);
    expect(draft?.body).toBe("Hi Jane,\n\nSent you the invite for Wednesday at 2pm ET.\n\nWilliam");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toContain("Wednesday works, thanks.");
    expect(sent[0]?.body).toContain(`wren email answers approve ${row?.id}`);
  });

  it("approve books the time and sends the draft in the thread, once", async () => {
    const enrollment = await offered();
    await warmReply(enrollment, "Wednesday works, thanks.");
    const calendar = new FakeCalendar([TUE_10, WED_2]);
    await runInvites(db(), takesWednesday(), { calendar, copies: COPIES, now: NOW });
    const [row] = await rows();
    const transport = quiet();

    const out = await approveInvite(db(), row?.id ?? -1, {
      calendar,
      transport,
      fleet: FLEET,
      now: NOW,
    });
    const twice = await approveInvite(db(), row?.id ?? -1, {
      calendar,
      transport,
      fleet: FLEET,
      now: NOW,
    });

    expect(out.ok && out.state).toBe("booked");
    expect(twice.ok).toBe(false);
    expect(calendar.bookings.map((b) => b.start)).toEqual([WED_2]);
    const mail = [...transport.mailbox.values()].flat();
    expect(mail).toHaveLength(1);
    const email = mail[0]?.email;
    expect([email?.to, email?.subject, email?.inReplyTo, email?.threadId, email?.fromName]).toEqual(
      [enrollment.toEmail, null, "<reply-24@them>", "t-oak.example", "William Jin"],
    );
    expect(email?.references).toEqual(["<oak.example@test>", "<reply-24@them>"]);
    const [after] = await rows();
    expect([after?.state, after?.bookingUid]).toEqual(["booked", "fake-1"]);
  });

  it("a slot taken since the proposal books nothing, sends nothing, and needs William", async () => {
    const enrollment = await offered();
    await warmReply(enrollment, "Wednesday works, thanks.");
    await runInvites(db(), takesWednesday(), {
      calendar: new FakeCalendar([TUE_10, WED_2]),
      copies: COPIES,
      now: NOW,
    });
    const [row] = await rows();
    const transport = quiet();

    const out = await approveInvite(db(), row?.id ?? -1, {
      calendar: new FakeCalendar([TUE_10]),
      transport,
      fleet: FLEET,
      now: NOW,
    });

    expect([out.ok, out.state]).toEqual([false, "needs_you"]);
    expect(transport.mailbox.size).toBe(0);
    // His own words still go out on it.
    const mine = await approveInvite(db(), row?.id ?? -1, {
      calendar: new FakeCalendar([]),
      transport,
      fleet: FLEET,
      body: "Wednesday filled up. Does Thursday at 10 work?",
      now: NOW,
    });
    expect(mine.ok && mine.state).toBe("sent");
    expect([...transport.mailbox.values()].flat()[0]?.email.body).toBe(
      "Wednesday filled up. Does Thursday at 10 work?",
    );
  });

  it("drop sends nothing and rejects the draft", async () => {
    const enrollment = await offered();
    await warmReply(enrollment, "Wednesday works, thanks.");
    const calendar = new FakeCalendar([TUE_10, WED_2]);
    await runInvites(db(), takesWednesday(), { calendar, copies: COPIES, now: NOW });
    const [row] = await rows();

    expect(await dropInvite(db(), row?.id ?? -1)).toBe("dropped");

    const [draft] = await db()
      .select()
      .from(messages)
      .where(eq(messages.id, row?.replyMessageId ?? -1));
    expect(draft?.state).toBe("rejected");
    expect(calendar.bookings).toEqual([]);
    await expect(dropInvite(db(), row?.id ?? -1)).rejects.toThrow(/dropped, not open/);
  });

  it("a thread that offered no times (the demo arm) gets a drafted reply, no read", async () => {
    const enrollment = await offered();
    await db()
      .update(messages)
      .set({ offeredTimes: null })
      .where(eq(messages.enrollmentId, enrollment.id));
    await warmReply(enrollment, "Sure, send it over.");
    const never = new FakeLlm({
      respond: () => {
        throw new Error("never read");
      },
    });
    const { sent, notifier } = pings();

    const stats = await runInvites(db(), never, {
      calendar: new FakeCalendar([]),
      notifier,
      copies: COPIES,
      now: NOW,
    });

    expect(stats.proposed).toBe(1);
    const [row] = await rows();
    expect([row?.state, row?.start]).toEqual(["proposed", null]);
    expect(sent[0]?.body).toContain("Sent you the invite.");
  });

  it("a client's pass reads only its sequences' niche and names the client", async () => {
    const enrollment = await offered();
    await db()
      .update(messages)
      .set({ offeredTimes: null })
      .where(eq(messages.enrollmentId, enrollment.id));
    await warmReply(enrollment, "Sure, send it over.");
    const never = new FakeLlm({
      respond: () => {
        throw new Error("never read");
      },
    });
    const run = (niches: string[]) =>
      runInvites(db(), never, {
        calendar: new FakeCalendar([]),
        notifier,
        copies: COPIES,
        now: NOW,
        niches,
        client: "acme",
      });
    const { sent, notifier } = pings();

    expect((await run(["agencies"])).selected).toBe(0);
    expect((await run(["sec_ria"])).proposed).toBe(1);
    expect(sent[0]?.title).toMatch(/^acme: Warm reply/);
    expect(sent[0]?.body).toContain("wren --client acme email answers approve");
  });

  it("a yes with no time pings William and books nothing", async () => {
    const enrollment = await offered();
    await warmReply(enrollment, "Sure, happy to chat.");
    const calendar = new FakeCalendar([TUE_10, WED_2]);
    const { sent, notifier } = pings();
    const llm = reading({ pick: "none", evidence: "happy to chat", confidence: 0.9 });

    const stats = await runInvites(db(), llm, { calendar, notifier, copies: COPIES, now: NOW });

    expect(stats.needs_you).toBe(1);
    expect(calendar.bookings).toEqual([]);
    const [row] = await rows();
    expect([row?.state, row?.detail, row?.replyMessageId]).toEqual([
      "needs_you",
      "no time in the reply",
      null,
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.level).toBe("action");
  });

  it("a time the calendar no longer has is never proposed: the row says needs_you", async () => {
    const enrollment = await offered();
    await warmReply(enrollment, "Tuesday is good.");
    const calendar = new FakeCalendar([WED_2]);
    const llm = reading({
      pick: "offered",
      start: "2026-10-06T10:00",
      evidence: "Tuesday is good",
      confidence: 0.9,
    });

    await runInvites(db(), llm, { calendar, now: NOW });

    expect(calendar.bookings).toEqual([]);
    expect((await rows())[0]?.state).toBe("needs_you");
  });

  it("someone already on the calendar is left alone", async () => {
    const enrollment = await offered();
    await warmReply(enrollment, "Booked myself, see you then.");
    const calendar = new FakeCalendar([TUE_10], [enrollment.toEmail]);
    const llm = new FakeLlm({
      respond: () => {
        throw new Error("never read");
      },
    });

    const stats = await runInvites(db(), llm, { calendar, now: NOW });

    expect(stats.already_booked).toBe(1);
    expect((await rows())[0]?.state).toBe("already_booked");
  });

  it("stale, operator-labelled, and cold replies are never touched", async () => {
    const enrollment = await offered();
    await warmReply(enrollment, "Old yes", { ago: 72 * HOUR });
    await warmReply(enrollment, "William has this", { source: "operator" });
    await warmReply(enrollment, "Ask me in Q2", { disposition: "not_now" });
    const llm = new FakeLlm({
      respond: () => {
        throw new Error("never read");
      },
    });

    const stats = await runInvites(db(), llm, { calendar: new FakeCalendar([TUE_10]), now: NOW });

    expect(stats.selected).toBe(0);
    expect(await rows()).toEqual([]);
  });
});
