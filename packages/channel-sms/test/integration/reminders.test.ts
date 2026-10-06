/**
 * Day-before reminders, end to end on Postgres: a cal.com booking (faked) →
 * the contact who said yes to texts → one queued reminder in William's words →
 * the tick, which sends it or drops it, never late.
 */
import { addSuppression } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Booking, FakeBookings } from "../../src/bookings.js";
import { tick } from "../../src/deliver.js";
import { FakeProvider } from "../../src/provider.js";
import { remindBookings } from "../../src/reminders.js";
import { smsContacts, smsMessages, smsTemplates } from "../../src/schema.js";
import { DAY_BEFORE, HOUR_BEFORE } from "../../src/templates.js";
import { fillTemplates, numbers, OPEN, POLICY, SEQUENCES, TABLES } from "./fixtures.js";

let pg: TestPostgres;
let provider: FakeProvider;
const db = () => pg.db;
const WORDS = "hi {first_name|there}, see you tomorrow at {time}. {sender}";
const PHONE = "+12125550101";

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
  await fillTemplates(pg.db, { [DAY_BEFORE]: WORDS });
  provider = new FakeProvider();
  await numbers(db(), provider, ["+13125550001"]);
});

/** A form applicant who ticked the texts box (application `ref`). */
async function applicant(ref = "7", over: Partial<typeof smsContacts.$inferInsert> = {}) {
  const [c] = await db()
    .insert(smsContacts)
    .values({
      e164: PHONE,
      sourceKind: "form",
      sourceRef: ref,
      basis: "opt_in",
      basisDetail: "ticked the texts box",
      name: "dana smith",
      email: "dana@x.test",
      state: "finished",
      ...over,
    })
    .returning();
  return c as typeof smsContacts.$inferSelect;
}

// OPEN is Tue 2026-09-29 14:00 ET. The call is Wed 14:30 ET, booked Sunday.
function call(over: Partial<Booking> = {}): Booking {
  return {
    uid: "b1",
    start: new Date("2026-09-30T18:30:00Z"),
    createdAt: new Date("2026-09-27T15:00:00Z"),
    name: "Dana Smith",
    email: "dana@x.test",
    timeZone: "America/New_York",
    application: "7",
    ...over,
  };
}

const remind = (calls: Booking[], now = OPEN) =>
  remindBookings(db(), {
    bookings: new FakeBookings([], calls),
    policy: POLICY,
    senderName: "William",
    now,
  });

const send = (now: Date) =>
  tick(db(), {
    provider,
    policy: POLICY,
    live: true,
    sequences: SEQUENCES,
    senderName: "William",
    now,
  });

const messages = () => db().select().from(smsMessages);

describe("day-before reminders", () => {
  it("queues one text the day before, on their clock, and the tick sends it", async () => {
    const c = await applicant();
    expect(await remind([call()])).toMatchObject({ calls: 1, due: 1, queued: 1 });
    const [m] = await messages();
    expect(m).toMatchObject({
      contactId: c.id,
      kind: "reminder",
      template: DAY_BEFORE,
      ref: "b1",
      body: "hi Dana, see you tomorrow at 2:30 PM. William",
      state: "queued",
    });
    // The contact got a sticky number for it.
    const [after] = await db().select().from(smsContacts).where(eq(smsContacts.id, c.id));
    expect(after?.numberId).toBe(m?.numberId);
    expect(await remind([call()])).toMatchObject({ queued: 0, already: 1 });
    expect(await send(new Date(OPEN.getTime() + 5 * 60_000))).toMatchObject({ sent: 1 });
    expect(provider.sent.map((s) => s.text)).toEqual([m?.body]);
  });

  it("reads the time on the caller's own clock, and matches by email when the link lost the application", async () => {
    await applicant("7", { email: "Dana@X.test" });
    // Wed 14:30 Pacific.
    const pacific = call({
      start: new Date("2026-09-30T21:30:00Z"),
      timeZone: "America/Los_Angeles",
      application: null,
    });
    expect(await remind([pacific])).toMatchObject({ queued: 1 });
    expect((await messages())[0]?.body).toBe("hi Dana, see you tomorrow at 2:30 PM. William");
  });

  it("goes only inside the hours on their clock, any day of the week", async () => {
    await applicant();
    // 16:30 ET: past the last queue time for the East, mid-afternoon in the West.
    const late = new Date("2026-09-29T20:30:00Z");
    expect(await remind([call()], late)).toMatchObject({ due: 1, outOfHours: 1, queued: 0 });
    const west = call({ start: new Date("2026-09-30T21:30:00Z"), timeZone: "America/Los_Angeles" });
    expect(await remind([west], late)).toMatchObject({ queued: 1 });
    // Sunday 14:00 ET for a Monday call: weekends are fine for a reminder.
    const sunday = new Date("2026-10-04T18:00:00Z");
    const monday = call({ uid: "b2", start: new Date("2026-10-05T18:30:00Z") });
    expect(await remind([monday], sunday)).toMatchObject({ queued: 1 });
  });

  it("skips calls not tomorrow, calls booked today, and people who never said yes", async () => {
    await applicant();
    const stats = await remind([
      call({ uid: "later", start: new Date("2026-10-01T15:00:00Z") }),
      call({ uid: "today", createdAt: new Date("2026-09-29T13:00:00Z") }),
      call({ uid: "stranger", email: "someone@else.test", application: "99" }),
    ]);
    expect(stats).toMatchObject({ calls: 3, due: 2, bookedToday: 1, noConsent: 1, queued: 0 });
    expect(await messages()).toEqual([]);
  });

  it("sends nothing with an empty template or to an opted-out phone", async () => {
    await applicant();
    await db().delete(smsTemplates);
    expect(await remind([call()])).toMatchObject({ due: 1, empty: 1, queued: 0 });
    await fillTemplates(db(), { [DAY_BEFORE]: WORDS });
    await addSuppression(db(), { kind: "phone", value: PHONE, reason: "manual" });
    expect(await remind([call()])).toMatchObject({ ended: 1, queued: 0 });
    expect(await messages()).toEqual([]);
  });

  it("counts toward the monthly cap and skips a phone already at it", async () => {
    const c = await applicant();
    for (let i = 1; i <= POLICY.monthlyPerContact; i++)
      await db()
        .insert(smsMessages)
        .values({
          contactId: c.id,
          direction: "out",
          kind: "manual",
          toE164: PHONE,
          body: "earlier",
          state: "delivered",
          providerId: `p${i}`,
          attemptedAt: new Date(OPEN.getTime() - i * 86_400_000),
        });
    expect(await remind([call()])).toMatchObject({ capped: 1, queued: 0 });
  });

  it("the tick drops a reminder it could not send within the hour, or whose template was emptied", async () => {
    await applicant();
    await remind([call()]);
    expect(await send(new Date(OPEN.getTime() + 61 * 60_000))).toMatchObject({
      sent: 0,
      skipped: 1,
    });
    expect((await messages())[0]).toMatchObject({
      state: "skipped",
      detail: expect.stringMatching(/too late/),
    });
    await remind([call({ uid: "b2" })]);
    await db().delete(smsTemplates);
    expect(await send(new Date(OPEN.getTime() + 60_000))).toMatchObject({ sent: 0, skipped: 1 });
    expect(provider.sent).toEqual([]);
  });

  it("texts the hour before when a pass finds the call 30 to 90 minutes out, once, with its own words", async () => {
    await applicant();
    // OPEN is 14:00 ET; this call is 15:00 ET the same day, booked Sunday.
    const soon = call({ uid: "h1", start: new Date("2026-09-29T19:00:00Z") });
    expect(await remind([soon])).toMatchObject({ due: 1, empty: 1, queued: 0 });
    await fillTemplates(db(), { [HOUR_BEFORE]: "see you at {time}, {first_name}" });
    expect(await remind([soon])).toMatchObject({ queued: 1 });
    expect(await remind([soon])).toMatchObject({ queued: 0, already: 1 });
    const [m] = await messages();
    expect(m).toMatchObject({ template: HOUR_BEFORE, ref: "h1", body: "see you at 3:00 PM, Dana" });
    // Booked two hours before it: they remember. Twenty minutes out: too close for a pass.
    const fresh = call({
      uid: "h2",
      start: new Date("2026-09-29T19:00:00Z"),
      createdAt: new Date("2026-09-29T17:00:00Z"),
    });
    const close = call({ uid: "h3", start: new Date("2026-09-29T18:20:00Z") });
    expect(await remind([fresh, close])).toMatchObject({ due: 1, bookedToday: 1, queued: 0 });
  });
});
