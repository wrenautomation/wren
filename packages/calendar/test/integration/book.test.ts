/**
 * Booking on Postgres, synthetic calendars only: one call per slot under a race, the buffer
 * between neighbours, the mirror into `call_bookings` (a booking from an email's link stops its
 * firm and counts), a move and a cancel, and the calls SmsWatch's reminder pass reads.
 */

import { setCallOutcome } from "@wren/channel-email/calls";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  allMessages,
  makeCompany,
  makePerson,
  runCompose,
  TABLES,
} from "../../../channel-email/test/integration/compose-fixtures.js";
import {
  type Booker,
  cancelBooking,
  claim,
  mirror,
  moveBooking,
  SlotTaken,
} from "../../src/book.js";
import { rulesOf } from "../../src/rules.js";
import { AllBookings, CalendarBookings } from "../../src/sms.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, [...TABLES, "call_bookings"]);
  await pg.db.execute(sql`truncate calendar.bookings restart identity`);
});

// Mon 2026-10-05 08:00 Toronto; open 10 to 5, 30-minute calls, 10 minutes either side.
const NOW = new Date("2026-10-05T12:00:00Z");
const RULES = rulesOf({ notice: 60, buffer: 10 });
const AT_10 = new Date("2026-10-05T14:00:00Z");
const booker = (over: Partial<Booker> = {}): Booker => ({
  name: "Ana Example",
  email: "Ana@Firm.example",
  zone: "America/Vancouver",
  offer: "intro",
  code: null,
  application: null,
  source: { utm_source: "email" },
  ...over,
});
const take = (start: Date, over: Partial<Booker> = {}) =>
  claim(pg.db, { calendar: "wren", rules: RULES, start, booker: booker(over), now: NOW, busy: [] });

describe("claim", () => {
  it("two bookers racing for one slot get one call and one refusal", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => take(AT_10, { email: `b${i}@firm.example` })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.filter((r) => r.status === "rejected");
    expect(refused).toHaveLength(5);
    for (const r of refused) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(SlotTaken);
    const [n] = await pg.db.execute<{ n: number }>(
      sql`select count(*)::int n from calendar.bookings`,
    );
    expect(n?.n).toBe(1);
  });

  it("keeps the buffer clear of a neighbour, refuses closed or busy times, frees a cancelled slot", async () => {
    const first = await take(AT_10);
    expect(first.email).toBe("ana@firm.example");
    expect(first.end.toISOString()).toBe("2026-10-05T14:30:00.000Z");
    // 10:30 starts inside 10:00's buffer; 11:00 is clear.
    await expect(take(new Date("2026-10-05T14:30:00Z"))).rejects.toBeInstanceOf(SlotTaken);
    await take(new Date("2026-10-05T15:00:00Z"));
    // 08:30 is closed; 10:00 Saturday too.
    await expect(take(new Date("2026-10-05T12:30:00Z"))).rejects.toBeInstanceOf(SlotTaken);
    await expect(take(new Date("2026-10-10T14:00:00Z"))).rejects.toBeInstanceOf(SlotTaken);
    const busy = [
      { start: new Date("2026-10-05T18:00:00Z"), end: new Date("2026-10-05T19:00:00Z") },
    ];
    await expect(
      claim(pg.db, {
        calendar: "wren",
        rules: RULES,
        start: new Date("2026-10-05T18:00:00Z"),
        booker: booker(),
        now: NOW,
        busy,
      }),
    ).rejects.toBeInstanceOf(SlotTaken);
    // Another calendar's 10:00 is its own.
    await claim(pg.db, {
      calendar: "other",
      rules: RULES,
      start: AT_10,
      booker: booker(),
      now: NOW,
      busy: [],
    });
    await cancelBooking(pg.db, { id: first.id, by: "booker", reason: null, now: NOW });
    await take(AT_10, { email: "next@firm.example" });
  });
});

describe("the shared bookings path", () => {
  it("a booking from an email's link stops its firm and counts; a move and a cancel follow it", async () => {
    const company = await makeCompany(pg.db, { name: "Synthetic Firm" });
    await makePerson(pg.db, company, { email: "jane@synthetic.example" });
    await runCompose(pg.db);
    const [opener] = (await allMessages(pg.db)) as { enrollmentId: number; linkCode: string }[];
    const row = await take(AT_10, {
      email: "someone@else.example",
      code: opener?.linkCode ?? null,
    });
    expect(await mirror(pg.db, row, "created", NOW)).toMatchObject({
      state: "booked",
      enrollmentId: opener?.enrollmentId,
      stopped: 1,
    });
    const [e] = await pg.db.execute<{ state: string; stop_reason: string }>(
      sql`select state, stop_reason from enrollments`,
    );
    expect(e).toEqual({ state: "stopped", stop_reason: "booked" });

    const later = new Date("2026-10-06T15:00:00Z");
    const { before, after } = await moveBooking(pg.db, {
      id: row.id,
      rules: RULES,
      start: later,
      now: NOW,
      // Its own Google event is busy at the old time: no matter.
      busy: [{ start: row.start, end: row.end }],
    });
    expect(before.start.toISOString()).toBe(AT_10.toISOString());
    expect(after.end.toISOString()).toBe("2026-10-06T15:30:00.000Z");
    await mirror(pg.db, after, "rescheduled", NOW);
    const { row: gone, changed } = await cancelBooking(pg.db, {
      id: row.id,
      by: "booker",
      reason: "conflict",
      now: NOW,
    });
    expect(changed).toBe(true);
    await mirror(pg.db, gone, "cancelled", NOW);
    expect(
      (await cancelBooking(pg.db, { id: row.id, by: "booker", reason: null, now: NOW })).changed,
    ).toBe(false);
    const calls = await pg.db.execute<{ uid: string; state: string; start: Date; code: string }>(
      sql`select uid, state, start, code from call_bookings`,
    );
    expect(calls.map((c) => ({ ...c, start: new Date(c.start).toISOString() }))).toEqual([
      {
        uid: `wren-${row.id}`,
        state: "cancelled",
        start: "2026-10-06T15:00:00.000Z",
        code: opener?.linkCode,
      },
    ]);
    await expect(
      moveBooking(pg.db, { id: row.id, rules: RULES, start: AT_10, now: NOW, busy: [] }),
    ).rejects.toThrow(/cancelled/);
  });

  it("says how a call went, on its mirror", async () => {
    const row = await take(AT_10);
    const { id } = await mirror(pg.db, row, "created", NOW);
    // Not before it starts.
    expect(
      await setCallOutcome(pg.db, { ids: [id], outcome: "no_show", by: "rep", now: NOW }),
    ).toEqual([]);
    const after = new Date(AT_10.getTime() + 3_600_000);
    const [marked] = await setCallOutcome(pg.db, {
      ids: [id],
      outcome: "not_yet",
      reason: "  Budget  ",
      by: "rep@wren.example",
      now: after,
    });
    expect(marked).toMatchObject({ id, outcome: "not_yet", reason: "Budget" });
    const [r] = await pg.db.execute<{ status: string; outcome_reason: string }>(
      sql`select status, outcome_reason from calendar.booking_records`,
    );
    expect(r).toEqual({ status: "not_yet", outcome_reason: "Budget" });
    // Clear takes it back to "say how it went".
    await setCallOutcome(pg.db, { ids: [id], outcome: null, by: "rep", now: after });
    const [back] = await pg.db.execute<{ status: string }>(
      sql`select status from calendar.booking_records`,
    );
    expect(back?.status).toBe("past");
  });
});

describe("the reminder pass's view", () => {
  it("lists booked calls in the window with a uid per start, next to another source", async () => {
    const row = await take(AT_10, { application: "app-7" });
    await take(new Date("2026-10-05T15:00:00Z"));
    const cancelled = await take(new Date("2026-10-05T16:00:00Z"));
    await cancelBooking(pg.db, { id: cancelled.id, by: "booker", reason: null, now: NOW });
    const ours = new CalendarBookings(pg.db, "wren", () => NOW);
    const listed = await ours.upcoming(NOW, new Date("2026-10-05T14:30:00Z"));
    expect(listed).toEqual([
      {
        uid: `wren-${row.id}-${AT_10.getTime() / 1000}`,
        start: AT_10,
        createdAt: NOW,
        name: "Ana Example",
        email: "ana@firm.example",
        timeZone: "America/Vancouver",
        application: "app-7",
      },
    ]);
    expect(await ours.booked("ANA@firm.example")).toBe(true);
    expect(await ours.booked("nobody@firm.example")).toBe(false);
    const other = {
      name: "other",
      booked: async (e: string) => e === "x@y.example",
      upcoming: async () => [{ ...(listed[0] as (typeof listed)[number]), uid: "o1", start: NOW }],
    };
    const all = new AllBookings([ours, other]);
    expect(all.name).toBe("calendar + other");
    expect(await all.booked("x@y.example")).toBe(true);
    expect((await all.upcoming(NOW, new Date("2026-10-05T14:30:00Z"))).map((b) => b.uid)).toEqual([
      "o1",
      `wren-${row.id}-${AT_10.getTime() / 1000}`,
    ]);
  });
});
