/**
 * Site applicants who ticked the texts box, end to end on Postgres: the
 * lander's export (faked) → an `opt_in` contact → the booking check → the
 * first text from William's template, or a written reason for none.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Bookings, FakeBookings } from "../../src/bookings.js";
import { tick } from "../../src/deliver.js";
import { enroll } from "../../src/enroll.js";
import {
  FIRST_TEXT_AFTER_MS,
  FORM_SEQUENCES,
  type FormApplication,
  followUpForms,
} from "../../src/form.js";
import { FakeProvider } from "../../src/provider.js";
import { smsContacts, smsMessages } from "../../src/schema.js";
import { checkBody, sequenceSlots } from "../../src/templates.js";
import { fillTemplates, numbers, OPEN, POLICY, SEQ, SHUT, TABLES } from "./fixtures.js";

let pg: TestPostgres;
let provider: FakeProvider;
const db = () => pg.db;
const SEQUENCES = new Map([SEQ, ...FORM_SEQUENCES].map((s) => [s.name, s]));
const FIT = "hi {first_name|there}, {sender} here about your application. STOP to opt out";

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
  await fillTemplates(pg.db, { "form-fit#1": FIT });
  provider = new FakeProvider();
  await numbers(db(), provider, ["+13125550001"]);
});

const minutesBefore = (at: Date, m: number) => new Date(at.getTime() - m * 60_000).toISOString();

function application(id: number, over: Partial<FormApplication> = {}): FormApplication {
  return {
    id,
    ts: minutesBefore(OPEN, 30),
    offer: "recruiting",
    name: "dana smith",
    email: `a${id}@x.test`,
    phone: `(212) 555-01${String(id).padStart(2, "0")}`,
    sms_consent: 1,
    fit: 1,
    page: "/recruiting",
    ...over,
  };
}

/** The lander's export over `apps`, honoring `since`; records each `since` asked for. */
function site(apps: FormApplication[]) {
  const asked: number[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const since = Number(url.searchParams.get("since"));
    asked.push(since);
    return Response.json({ applications: apps.filter((a) => a.id > since) });
  }) as typeof globalThis.fetch;
  return { asked, source: { baseUrl: "https://wrenautomation.com", exportToken: "t", fetch } };
}

const pass = (s: ReturnType<typeof site>, now = OPEN, bookings: Bookings | null = null) =>
  followUpForms(db(), {
    site: s.source,
    bookings,
    sequences: SEQUENCES,
    policy: POLICY,
    provider,
    senderName: "William",
    heldNiches: [],
    now,
  });
const contacts = () => db().select().from(smsContacts).orderBy(asc(smsContacts.id));

describe("form opt-ins", () => {
  it("a ticked box becomes an opt_in contact and gets its first text after the wait", async () => {
    const s = site([
      application(1),
      application(2, { sms_consent: 0 }),
      application(3, { ts: minutesBefore(OPEN, 5) }),
    ]);
    const first = await pass(s);
    expect(first).toMatchObject({ read: 3, added: 1, texted: 1, waiting: 1 });
    const [dana] = await contacts();
    expect(dana).toMatchObject({
      e164: "+12125550101",
      sourceKind: "form",
      sourceRef: "1",
      basis: "opt_in",
      name: "dana smith",
      email: "a1@x.test",
      state: "enrolled",
      sequence: "form-fit",
      sourceUrl: "https://wrenautomation.com/recruiting",
    });
    expect(dana?.basisDetail).toContain("wrenautomation.com/recruiting");
    const sent = await tick(db(), {
      provider,
      policy: POLICY,
      live: true,
      sequences: SEQUENCES,
      senderName: "William",
      now: OPEN,
    });
    expect(sent.sent).toBe(1);
    expect(provider.sent[0]?.text).toBe(
      "hi Dana, William here about your application. STOP to opt out",
    );
    // One step: the thread finishes after it, and the next pass reads past it.
    expect((await contacts())[0]).toMatchObject({
      state: "finished",
      stateReason: "every step sent",
    });
    const later = new Date(OPEN.getTime() + FIRST_TEXT_AFTER_MS);
    const second = await pass(s, later);
    expect(s.asked).toEqual([0, 1]);
    expect(second).toMatchObject({ added: 1, texted: 1, waiting: 0 });
  });

  it("an empty template, a booking or an old application sends nothing, and says why", async () => {
    const s = site([
      application(1, { fit: 0 }),
      application(2, { email: "booked@x.test" }),
      application(3, { ts: minutesBefore(OPEN, 5 * 24 * 60) }),
    ]);
    const bookings = new FakeBookings(["booked@x.test"]);
    expect(await pass(s, OPEN, bookings)).toMatchObject({
      empty: 1,
      booked: 1,
      tooOld: 1,
      texted: 0,
    });
    expect((await contacts()).map((c) => [c.sourceRef, c.state, c.stateReason])).toEqual([
      ["1", "finished", "template form-not-fit#1 was empty: nothing sent"],
      ["2", "finished", "booked a call on fake before the first text"],
      ["3", "finished", expect.stringMatching(/too long ago for a first text/)],
    ]);
    expect(bookings.asked).toEqual(["a1@x.test", "booked@x.test"]);
    expect(await db().select().from(smsMessages)).toEqual([]);
  });

  it("a failed booking check holds the text, and the next pass retries it", async () => {
    const s = site([application(1), application(2)]);
    const down: Bookings = {
      name: "down",
      booked: async () => {
        throw new Error("cal.com answered 503");
      },
      upcoming: async () => [],
    };
    const held = await pass(s, OPEN, down);
    expect(held).toMatchObject({ added: 2, texted: 0 });
    expect(held.errors).toEqual([
      "application 1: cal.com answered 503",
      "application 2: cal.com answered 503",
    ]);
    // A cold run never takes a form applicant, even one still `new`.
    await fillTemplates(db());
    const cold = await enroll(db(), {
      sequence: SEQ,
      policy: POLICY,
      provider,
      senderName: "William",
      heldNiches: [],
      limit: 10,
      now: OPEN,
    });
    expect(cold.considered).toBe(0);
    expect(await pass(s, OPEN, new FakeBookings())).toMatchObject({ added: 0, texted: 2 });
    expect(s.asked).toEqual([0, 0]);
  });

  it("outside the window records applicants but texts no one, and turns away a landline", async () => {
    const s = site([application(1, { ts: minutesBefore(SHUT, 30) })]);
    const bookings = new FakeBookings();
    expect(await pass(s, SHUT, bookings)).toMatchObject({
      outOfWindow: true,
      read: 1,
      added: 1,
      texted: 0,
    });
    expect((await contacts())[0]?.state).toBe("new");
    expect(bookings.asked).toEqual([]);
    provider.landlines.add("+12125550101");
    expect(await pass(s, OPEN, bookings)).toMatchObject({ added: 0, texted: 0, ended: 1 });
    expect(s.asked).toEqual([0, 0]);
    const [c] = await db().select().from(smsContacts).where(eq(smsContacts.sourceRef, "1"));
    expect(c).toMatchObject({ state: "unreachable", stateReason: "line type landline" });
  });

  it("its slots say when they go and take no company", () => {
    const [fit] = sequenceSlots(FORM_SEQUENCES[0] as (typeof FORM_SEQUENCES)[number]);
    expect(fit?.purpose).toMatch(
      /^form-fit: first text, about half an hour after someone who fits/,
    );
    expect(() => checkBody(fit as NonNullable<typeof fit>, "hi from {company}. STOP")).toThrow(
      /unknown field \{company\}/,
    );
  });
});
