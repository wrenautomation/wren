/**
 * Site applicants who ticked the texts box, end to end on Postgres: the lander's export (faked)
 * → the first pass records what's already there and texts none of it → a new application's run
 * and `opt_in` contact → its first text two minutes on, in their hours (an Indian number waits
 * for 08:00 IST) → the email after it → the follow-ups, stopped by a reply or a booking → one
 * notice when no text went, naming why. Synthetic people and a fake carrier; nothing leaves.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Bookings, FakeBookings } from "../../src/bookings.js";
import { tick } from "../../src/deliver.js";
import { enroll } from "../../src/enroll.js";
import { touch } from "../../src/follow.js";
import {
  FIRST_TEXT_AFTER_MS,
  FORM_SEQUENCES,
  type FormApplication,
  type FormOptions,
  followUpForms,
  formStep,
} from "../../src/form.js";
import {
  type AfterOptions,
  EMAIL_AFTER_MS,
  formAfter,
  formEmail,
  NOTICE_AFTER_MS,
  noTextNotice,
  whyNoText,
} from "../../src/form-after.js";
import { FakeProvider } from "../../src/provider.js";
import { smsContacts, smsMessages, speedRuns } from "../../src/schema.js";
import { smsStats } from "../../src/stats.js";
import { checkBody, sequenceSlots } from "../../src/templates.js";
import { fillTemplates, notes, numbers, OPEN, POLICY, SEQ, TABLES } from "./fixtures.js";

let pg: TestPostgres;
let provider: FakeProvider;
const db = () => pg.db;
const SEQUENCES = new Map([SEQ, ...FORM_SEQUENCES].map((s) => [s.name, s]));
const FIT = "hi {first_name|there}, {sender} here. book: {booking_link} STOP to opt out";
const WORDS = {
  "form-fit#1": FIT,
  "follow-up#1": "hi {first_name|there}, {sender} here. still want a call?",
  "follow-up#2": "last one from me",
};
const COUNTRIES = ["US", "CA", "IN"];
// A placeholder Indian mobile.
const INDIA = "+91 98765 43210";
const INDIA_E164 = "+919876543210";

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [...TABLES, "speed_runs"]);
  await fillTemplates(pg.db, WORDS);
  provider = new FakeProvider();
  await numbers(db(), provider, ["+13125550001"]);
});

const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * 60_000);

function application(id: number, over: Partial<FormApplication> = {}): FormApplication {
  return {
    id,
    ts: at(OPEN, -30).toISOString(),
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

/** The lander's export over `apps`, honoring `since`. */
function site(apps: FormApplication[]) {
  const asked: number[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const since = Number(url.searchParams.get("since"));
    const limit = Number(url.searchParams.get("limit"));
    asked.push(since);
    return Response.json({ applications: apps.filter((a) => a.id > since).slice(0, limit) });
  }) as typeof globalThis.fetch;
  return { asked, source: { baseUrl: "https://wrenautomation.com", exportToken: "t", fetch } };
}

const opts = (
  s: ReturnType<typeof site>,
  now: Date,
  bookings: Bookings | null = null,
): FormOptions => ({
  site: s.source,
  bookings,
  sequences: SEQUENCES,
  policy: POLICY,
  provider,
  senderName: "William",
  heldNiches: [],
  countries: COUNTRIES,
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
const contacts = () => db().select().from(smsContacts).orderBy(asc(smsContacts.id));
const runs = () => db().select().from(speedRuns).orderBy(asc(speedRuns.id));
const runFor = async (id: number) =>
  (await runs()).find((r) => r.subject === `site:applications:${id}`);

/** Starts texts: the first pass records the site as it stands (here, one old application). */
async function seeded(s: ReturnType<typeof site>) {
  const first = await followUpForms(db(), opts(s, at(OPEN, -60)));
  expect(first.seeded).toBeGreaterThan(0);
}

function mail() {
  const sent: { to: string; subject: string; text: string }[] = [];
  return {
    sent,
    send: async (m: { to: string; subject: string; text: string }) => {
      sent.push(m);
    },
  };
}
const afterOpts = (now: Date, o: Partial<AfterOptions> = {}): AfterOptions => ({
  send: null,
  bookings: null,
  senderName: "William",
  notifier: null,
  policy: POLICY,
  now,
  ...o,
});

describe("the first pass", () => {
  it("records every application already on the site and texts none of them", async () => {
    const s = site([application(1), application(2, { sms_consent: 0 }), application(3)]);
    const stats = await followUpForms(db(), opts(s, OPEN));
    expect(stats).toMatchObject({ read: 3, seeded: 3, added: 0, texted: 0 });
    expect((await runs()).map((r) => [r.subject, r.firstTouch, r.firstTouchDetail])).toEqual([
      ["site:applications:1", "refused", "applied before form texts were on: not texted"],
      ["site:applications:2", "no_consent", "applied before form texts were on: not texted"],
      ["site:applications:3", "refused", "applied before form texts were on: not texted"],
    ]);
    expect(await contacts()).toEqual([]);
    // The next pass reads past them, and no notice ever names them.
    const n = notes();
    expect(await followUpForms(db(), opts(s, OPEN))).toMatchObject({ read: 0 });
    expect(s.asked).toEqual([0, 3]);
    expect(await formAfter(db(), afterOpts(at(OPEN, 60), { notifier: n.notifier }))).toMatchObject({
      noticed: 0,
    });
  });
});

describe("a new application", () => {
  it("is texted two minutes after it came in, then emailed, then followed up", async () => {
    const s = site([application(1, { ts: at(OPEN, -60).toISOString() })]);
    await seeded(s);
    const app = application(2, { ts: OPEN.toISOString() });
    const waiting = await formStep(db(), app, opts(s, OPEN));
    expect(waiting).toEqual({ kind: "waiting", due: at(OPEN, 2) });
    const due = new Date(OPEN.getTime() + FIRST_TEXT_AFTER_MS);
    expect(await formStep(db(), app, opts(s, due))).toMatchObject({ kind: "texted" });
    // Twice is once.
    expect(await formStep(db(), app, opts(s, due))).toEqual({ kind: "done" });
    const [c] = await contacts();
    expect(c).toMatchObject({
      e164: "+12125550102",
      sourceKind: "form",
      basis: "opt_in",
      state: "enrolled",
      sequence: "form-fit",
      zone: null,
      bookingLink: "https://wrenautomation.com/book/recruiting?application=2",
    });
    expect((await send(due)).sent).toBe(1);
    expect(provider.sent[0]?.text).toBe(
      "hi Dana, William here. book: https://wrenautomation.com/book/recruiting?application=2 STOP to opt out",
    );
    expect(await runFor(2)).toMatchObject({ firstTouch: "sent", firstDueAt: due });

    // The email: not before five minutes after the text, then once, with the link.
    const m = mail();
    expect(await formEmail(db(), (await runFor(2))?.id as number, afterOpts(due, m))).toBe(
      "not_yet",
    );
    const later = new Date(due.getTime() + EMAIL_AFTER_MS);
    expect(await formAfter(db(), afterOpts(later, m))).toMatchObject({ emailed: 1 });
    expect(await formAfter(db(), afterOpts(at(later, 5), m))).toMatchObject({ emailed: 0 });
    expect(m.sent).toEqual([
      {
        to: "a2@x.test",
        subject: "Your form on wrenautomation.com",
        text: "Hi Dana,\n\nThanks for filling out the form. I just texted you too. Here's my calendar, pick any time that works: https://wrenautomation.com/book/recruiting?application=2\n\nWilliam",
      },
    ]);
    expect(await runFor(2)).toMatchObject({ emailDetail: "sent", emailAt: later });

    // Minutes to the text and the email, on the stats.
    const stats = await smsStats(db(), { since: at(OPEN, -24 * 60), niche: null });
    expect(stats.speed).toMatchObject({ leads: 2, texted: 1, textMinutes: 2, emailed: 1 });
    expect(stats.speed.emailMinutes).toBeCloseTo(7, 5);

    // The follow-ups: follow-up#1's words, from the same sequence.
    const contactId = c?.id as number;
    const touchOpts = { sequences: SEQUENCES, senderName: "William", now: at(later, 1440) };
    expect(await touch(db(), contactId, 2, touchOpts)).toBe("queued");
    const queued = await db().select().from(smsMessages).where(eq(smsMessages.step, 2));
    expect(queued[0]).toMatchObject({
      template: "follow-up#1",
      body: "hi Dana, William here. still want a call?",
    });
  });

  it("follow-ups stop on a reply, and on a booking", async () => {
    const s = site([application(1, { ts: at(OPEN, -60).toISOString() })]);
    await seeded(s);
    const due = at(OPEN, 2);
    for (const id of [2, 3])
      await formStep(db(), application(id, { ts: OPEN.toISOString() }), opts(s, due));
    expect((await send(due)).sent).toBe(2);
    const [replier, booker] = await contacts();
    await db()
      .update(smsContacts)
      .set({ state: "replied" })
      .where(eq(smsContacts.id, replier?.id as number));
    const bookings = new FakeBookings(["a3@x.test"]);
    const touchOpts = {
      sequences: SEQUENCES,
      senderName: "William",
      bookings,
      now: at(OPEN, 1442),
    };
    expect(await touch(db(), replier?.id as number, 2, touchOpts)).toBe("replied");
    expect(await touch(db(), booker?.id as number, 2, touchOpts)).toBe("booked");
    expect((await contacts())[1]).toMatchObject({ state: "finished" });
    expect((await runFor(3))?.bookedAt).toEqual(at(OPEN, 1442));
    expect(await db().select().from(smsMessages).where(eq(smsMessages.step, 2))).toEqual([]);
  });

  it("someone who booked first gets no text and no email", async () => {
    const s = site([application(1, { ts: at(OPEN, -60).toISOString() })]);
    await seeded(s);
    const bookings = new FakeBookings(["a2@x.test"]);
    const app = application(2, { ts: OPEN.toISOString() });
    expect(await formStep(db(), app, opts(s, at(OPEN, 2), bookings))).toEqual({ kind: "booked" });
    expect(await runFor(2)).toMatchObject({ firstTouch: "booked" });
    expect((await contacts())[0]).toMatchObject({ state: "finished" });
    expect(await db().select().from(smsMessages)).toEqual([]);
    const n = notes();
    const m = mail();
    expect(
      await formAfter(db(), afterOpts(at(OPEN, 60), { send: m.send, notifier: n.notifier })),
    ).toMatchObject({ emailed: 0, noticed: 0 });
    expect(m.sent).toEqual([]);
    expect(n.seen).toEqual([]);
  });

  it("a booking between the text and the email stops the email", async () => {
    const s = site([application(1, { ts: at(OPEN, -60).toISOString() })]);
    await seeded(s);
    const due = at(OPEN, 2);
    await formStep(db(), application(2, { ts: OPEN.toISOString() }), opts(s, due));
    await send(due);
    const m = mail();
    const bookings = new FakeBookings(["a2@x.test"]);
    expect(await formAfter(db(), afterOpts(at(due, 6), { send: m.send, bookings }))).toMatchObject({
      emailed: 0,
      booked: 1,
    });
    expect(m.sent).toEqual([]);
    expect((await runFor(2))?.emailDetail).toMatch(/^booked a call on fake/);
  });

  it("a failed booking check holds the text; a cold run never takes the applicant", async () => {
    const s = site([application(1, { ts: at(OPEN, -60).toISOString() })]);
    await seeded(s);
    s.source.fetch = site([
      application(1, { ts: at(OPEN, -60).toISOString() }),
      application(2, { ts: OPEN.toISOString() }),
    ]).source.fetch;
    const down: Bookings = {
      name: "down",
      booked: async () => {
        throw new Error("cal.com answered 503");
      },
      upcoming: async () => [],
    };
    const app = application(2, { ts: OPEN.toISOString() });
    expect(await formStep(db(), app, opts(s, at(OPEN, 2), down))).toEqual({
      kind: "error",
      why: "application 2: cal.com answered 503",
    });
    await fillTemplates(db(), { "recruiting-sms#1": "hi. STOP", "recruiting-sms#2": "again" });
    const cold = await enroll(db(), {
      sequence: SEQ,
      policy: POLICY,
      provider,
      senderName: "William",
      heldNiches: [],
      limit: 10,
      now: at(OPEN, 2),
    });
    expect(cold.considered).toBe(0);
    // The pass picks it back up from just before it.
    const pass = await followUpForms(db(), opts(s, at(OPEN, 3), new FakeBookings()));
    expect(pass).toMatchObject({ read: 1, added: 0, texted: 1 });
  });
});

describe("an applicant abroad", () => {
  it("an Indian number at night on their clock waits for 08:00 IST", async () => {
    const s = site([application(1, { ts: at(OPEN, -60).toISOString() })]);
    await seeded(s);
    // OPEN is 23:30 IST: the text waits for 08:00 IST, 02:30Z the next day.
    const app = application(2, { ts: OPEN.toISOString(), phone: INDIA });
    const morning = new Date("2026-09-30T02:30:00Z");
    expect(await formStep(db(), app, opts(s, at(OPEN, 2)))).toEqual({
      kind: "waiting",
      due: morning,
    });
    expect(await runFor(2)).toMatchObject({ zone: "Asia/Kolkata", firstDueAt: morning });
    expect((await contacts())[0]).toMatchObject({ e164: INDIA_E164, zone: "Asia/Kolkata" });
    expect(await formStep(db(), app, opts(s, morning))).toMatchObject({ kind: "texted" });
    expect((await send(morning)).sent).toBe(1);
    expect(provider.sent[0]?.to).toBe(INDIA_E164);
  });

  it("a country left off the list is recorded, and noticed once, by name", async () => {
    const s = site([application(1, { ts: at(OPEN, -60).toISOString() })]);
    await seeded(s);
    const app = application(2, { ts: OPEN.toISOString(), phone: INDIA });
    const usOnly = { ...opts(s, at(OPEN, 2)), countries: ["US", "CA"] };
    expect(await formStep(db(), app, usOnly)).toMatchObject({ kind: "no_phone" });
    const n = notes();
    const run = (await runFor(2))?.id as number;
    expect(await noTextNotice(db(), run, afterOpts(at(OPEN, 5), { notifier: n.notifier }))).toBe(
      "not_yet",
    );
    const late = at(OPEN, 2 + NOTICE_AFTER_MS / 60_000);
    expect(await formAfter(db(), afterOpts(late, { notifier: n.notifier }))).toMatchObject({
      noticed: 1,
    });
    expect(await formAfter(db(), afterOpts(at(late, 30), { notifier: n.notifier }))).toMatchObject({
      noticed: 0,
    });
    expect(n.seen).toHaveLength(1);
    expect(n.seen[0]).toMatchObject({ title: "No text to a site applicant", level: "action" });
    expect(n.seen[0]?.body).toContain(
      "Country: a IN number, and form texts go only to US, CA (WREN_SMS_FORM_COUNTRIES).",
    );
    // Never their phone or email.
    expect(n.seen[0]?.body).not.toContain("98765");
    expect(n.seen[0]?.body).not.toContain("a2@x.test");
  });

  it("a carrier refusal says so in plain words", async () => {
    const s = site([application(1, { ts: at(OPEN, -60).toISOString() })]);
    await seeded(s);
    provider.reject.set(INDIA_E164, { code: "40008", detail: "destination not allowed" });
    const morning = new Date("2026-09-30T02:30:00Z");
    await formStep(
      db(),
      application(2, { ts: OPEN.toISOString(), phone: INDIA }),
      opts(s, morning),
    );
    await send(morning);
    expect(await runFor(2)).toMatchObject({ firstTouch: "refused" });
    const n = notes();
    await formAfter(db(), afterOpts(at(morning, 11), { notifier: n.notifier }));
    expect(n.seen[0]?.body).toMatch(/Refused: Telnyx refused the text: .*destination not allowed/);
    expect(n.seen[0]?.body).toContain("international sending");
  });
});

describe("the reasons a notice names", () => {
  it("landline, an empty template, out of the window", async () => {
    const s = site([application(1, { ts: at(OPEN, -60).toISOString() })]);
    await seeded(s);
    provider.landlines.add("+12125550102");
    const due = at(OPEN, 2);
    await formStep(db(), application(2, { ts: OPEN.toISOString() }), opts(s, due));
    await formStep(db(), application(3, { ts: OPEN.toISOString(), fit: 0 }), opts(s, due));
    const n = notes();
    await formAfter(db(), afterOpts(at(due, 10), { notifier: n.notifier }));
    expect(n.seen.map((x) => x.body.replace(/^.*has no text\. /, ""))).toEqual([
      "Landline: not a mobile: line type landline.",
      "Template empty: the form-not-fit#1 template is empty.",
    ]);
    // A run still waiting at night on an IST clock: out of the window until 08:00 IST.
    const night = (await runFor(2)) as NonNullable<Awaited<ReturnType<typeof runFor>>>;
    const why = await whyNoText(
      db(),
      { ...night, firstTouch: "queued", zone: "Asia/Kolkata" },
      null,
      POLICY,
      OPEN,
    );
    expect(why).toMatch(
      /^Out of the texting window on their clock until Wed, 8:00 AM GMT\+5:30\.$/,
    );
  });

  it("its slots say when they go, take no company, and leave the follow-ups to theirs", () => {
    const [fit] = sequenceSlots(FORM_SEQUENCES[0] as (typeof FORM_SEQUENCES)[number]);
    expect(sequenceSlots(FORM_SEQUENCES[0] as (typeof FORM_SEQUENCES)[number])).toHaveLength(1);
    expect(fit).toMatchObject({
      purpose: "Applicant who fits: first text",
      goes: expect.stringMatching(/^Two minutes after they apply/),
    });
    expect(() => checkBody(fit as NonNullable<typeof fit>, "hi from {company}. STOP")).toThrow(
      /unknown field \{company\}/,
    );
  });
});
