/**
 * cal.com bookings against the migrated schema (designs/2026-10-04-booking-webhook.md): a
 * booking from an email's link stops the firm and is warm, the same event twice applies
 * once, a cancel only marks the row, a reschedule moves it, and one no email led to stays.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyBooking, bookingFromList, bookingFromWebhook } from "../../src/inbox/bookings.js";
import { allMessages, makeCompany, makePerson, runCompose, TABLES } from "./compose-fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, [...TABLES, "call_bookings"]));

const NOW = new Date("2026-10-04T12:00:00Z");
const hook = (trigger: string, payload: Record<string, unknown>) => {
  const e = bookingFromWebhook({ triggerEvent: trigger, payload });
  if (!e) throw new Error("no event");
  return e;
};
const rows = () =>
  pg.db.execute<{
    uid: string;
    state: string;
    enrollment_id: number | null;
    message_id: number | null;
  }>(sql`select uid, state, enrollment_id, message_id from call_bookings order by id`);
const enrollmentStates = () =>
  pg.db.execute<{ state: string; stop_reason: string | null }>(
    sql`select state, stop_reason from enrollments order by id`,
  );

async function oneFirm() {
  const company = await makeCompany(pg.db, { name: "Oakbridge" });
  await makePerson(pg.db, company, { email: "jane@oakbridge.example" });
  await runCompose(pg.db);
  const [opener] = await allMessages(pg.db);
  return opener as { id: number; enrollmentId: number; linkCode: string };
}

describe("applyBooking", () => {
  it("a booking with r stops its enrollment and company, once", async () => {
    const opener = await oneFirm();
    const e = hook("BOOKING_CREATED", {
      uid: "bk-1",
      startTime: "2026-10-06T15:00:00Z",
      attendees: [{ email: "Someone@Elsewhere.example", name: "Jane" }],
      metadata: { r: opener.linkCode, offer: "recruiting" },
    });
    const first = await applyBooking(pg.db, e, { now: NOW });
    expect(first).toMatchObject({ state: "booked", enrollmentId: opener.enrollmentId, stopped: 1 });
    expect(await enrollmentStates()).toEqual([{ state: "stopped", stop_reason: "booked" }]);
    const again = await applyBooking(pg.db, e, { now: NOW });
    expect(again).toMatchObject({ id: first.id, stopped: 0 });
    expect(await rows()).toEqual([
      { uid: "bk-1", state: "booked", enrollment_id: opener.enrollmentId, message_id: opener.id },
    ]);
    const [outcome] = await pg.db.execute<{ outcome: string }>(
      sql`select outcome from contact_outcomes`,
    );
    expect(outcome?.outcome).toBe("warm");
  });

  it("matches by the attendee's address with no r; keeps a booking no email led to", async () => {
    const opener = await oneFirm();
    await applyBooking(
      pg.db,
      hook("BOOKING_CREATED", { uid: "bk-2", attendees: [{ email: "JANE@oakbridge.example" }] }),
      { now: NOW },
    );
    await applyBooking(
      pg.db,
      hook("BOOKING_CREATED", { uid: "bk-3", attendees: [{ email: "stranger@else.example" }] }),
      { now: NOW },
    );
    expect(await rows()).toEqual([
      { uid: "bk-2", state: "booked", enrollment_id: opener.enrollmentId, message_id: null },
      { uid: "bk-3", state: "booked", enrollment_id: null, message_id: null },
    ]);
  });

  it("a cancel only marks the row; a reschedule moves it to the new uid and time", async () => {
    const opener = await oneFirm();
    const payload = {
      uid: "bk-4",
      startTime: "2026-10-06T15:00:00Z",
      metadata: { r: opener.linkCode },
    };
    await applyBooking(pg.db, hook("BOOKING_CREATED", payload), { now: NOW });
    await applyBooking(
      pg.db,
      hook("BOOKING_RESCHEDULED", {
        ...payload,
        uid: "bk-5",
        rescheduleUid: "bk-4",
        startTime: "2026-10-07T15:00:00Z",
      }),
      { now: NOW },
    );
    const [moved] = await pg.db.execute<{ uid: string; start: Date }>(
      sql`select uid, start from call_bookings`,
    );
    expect(moved?.uid).toBe("bk-5");
    expect(new Date(moved?.start as Date).toISOString()).toBe("2026-10-07T15:00:00.000Z");
    await applyBooking(pg.db, hook("BOOKING_CANCELLED", { uid: "bk-5" }), { now: NOW });
    // A late "created" never revives it, and the sequence stays stopped.
    await applyBooking(pg.db, hook("BOOKING_CREATED", { uid: "bk-5" }), { now: NOW });
    expect((await rows()).map((r) => r.state)).toEqual(["cancelled"]);
    expect(await enrollmentStates()).toEqual([{ state: "stopped", stop_reason: "booked" }]);
  });
});

describe("cal.com's shapes", () => {
  it("PING is no event; the list's old half of a reschedule is skipped", () => {
    expect(bookingFromWebhook({ triggerEvent: "PING", payload: {} })).toBeNull();
    expect(
      bookingFromList({
        uid: "a",
        status: "cancelled",
        start: "2026-10-06T15:00:00Z",
        rescheduled: true,
      }),
    ).toBeNull();
    expect(
      bookingFromList({
        uid: "b",
        status: "accepted",
        start: "2026-10-07T15:00:00Z",
        rescheduledFromUid: "a",
      }),
    ).toMatchObject({ change: "rescheduled", fromUid: "a" });
  });
});
