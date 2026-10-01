/**
 * Speed to lead against the migrated schema: a fresh warm reply that takes a
 * time is booked once; anything else is one `needs_you` ping; a stale, operator
 * labelled, or cold reply is never touched.
 */
import { FakeCalendar } from "@wren/core/calendar";
import type { Notifier } from "@wren/core/notify";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runInvites } from "../../src/inbox/invite.js";
import {
  callInvites,
  type Enrollment,
  enrollments,
  messages,
  type ThreadEvent,
  threadEvents,
} from "../../src/schema.js";
import { transitionMessage } from "../../src/state.js";
import { makeCompany, makePerson, messagesOf, runCompose, TABLES } from "./compose-fixtures.js";

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
  const sent: { title: string; level: string }[] = [];
  const notifier: Notifier = {
    name: "test",
    notify: async (title, _body, level) => {
      sent.push({ title, level: level ?? "info" });
      return true;
    },
  };
  return { sent, notifier };
}

const rows = () => db().select().from(callInvites);

describe("call invites", () => {
  it("a reply that takes an offered time is booked once, and William hears", async () => {
    const enrollment = await offered();
    await warmReply(enrollment, "Wednesday works, thanks.");
    const calendar = new FakeCalendar([TUE_10, WED_2]);
    const { sent, notifier } = pings();
    const llm = reading({
      pick: "offered",
      start: "2026-10-07T14:00",
      evidence: "Wednesday works",
      confidence: 0.9,
    });

    const stats = await runInvites(db(), llm, { calendar, notifier, now: NOW });
    const again = await runInvites(db(), llm, { calendar, notifier, now: NOW });

    expect([stats.selected, stats.booked, again.selected]).toEqual([1, 1, 0]);
    expect(calendar.bookings).toHaveLength(1);
    expect(calendar.bookings[0]?.start).toEqual(WED_2);
    expect(calendar.bookings[0]?.attendee.email).toBe(enrollment.toEmail);
    const [row] = await rows();
    expect([row?.state, row?.bookingUid, row?.start]).toEqual(["booked", "fake-1", WED_2]);
    expect(sent.map((p) => p.level)).toEqual(["info"]);
  });

  it("a yes with no time pings William and books nothing", async () => {
    const enrollment = await offered();
    await warmReply(enrollment, "Sure, happy to chat.");
    const calendar = new FakeCalendar([TUE_10, WED_2]);
    const { sent, notifier } = pings();
    const llm = reading({ pick: "none", evidence: "happy to chat", confidence: 0.9 });

    const stats = await runInvites(db(), llm, { calendar, notifier, now: NOW });

    expect(stats.needs_you).toBe(1);
    expect(calendar.bookings).toEqual([]);
    const [row] = await rows();
    expect([row?.state, row?.detail]).toEqual(["needs_you", "no time in the reply"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.level).toBe("warning");
  });

  it("a taken slot is never double booked: the row says needs_you", async () => {
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
