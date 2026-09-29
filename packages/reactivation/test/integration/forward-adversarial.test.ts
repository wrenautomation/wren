/**
 * Adversarial cases for forwarding replies to recruiters (R13, step 7e):
 * never twice, only the right replies, to the right person, from the right
 * mailbox, sensible text, no contact names for the operator, and a failure
 * that never blocks the rest. A failing test here is a bug, marked "Was a bug:".
 */
import {
  buildMime,
  ConsoleTransport,
  type OutgoingEmail,
  type SendReceipt,
  type Transport,
  TransportRefused,
} from "@wren/channel-email";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CRM_FORMATS } from "../../src/crm/formats.js";
import { runCrmImport } from "../../src/crm/import.js";
import { CrmCsvSource } from "../../src/crm/source.js";
import { forwardEmail, forwardHandoffs } from "../../src/forward.js";
import { HandoffRefusal, markMeetingBooked } from "../../src/handoff.js";

const SAM = "sam@acme-talent.example";
const PAT = "pat@acme.example";
const LEE = "lee@acme.example";
const JANE = "jane@umbrella.example";
const BOB = "bob@umbrella.example";
const PROFILE = {
  recruiters: [
    { name: "Pat", email: PAT, owners: [] },
    { name: "Lee", email: LEE, owners: [] },
  ],
  defaultRecruiter: LEE,
};
const SETTINGS = { senders: [{ address: SAM, name: "Sam Park" }] };
const quiet = (opts: ConstructorParameters<typeof ConsoleTransport>[0] = {}) =>
  new ConsoleTransport({ write: () => {}, ...opts });

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, [
    "handoffs",
    "thread_events",
    "messages",
    "enrollments",
    "crm_contacts",
    "import_errors",
    "people",
    "companies",
    "imports",
  ]);
  const f = CRM_FORMATS.get("crm-generic");
  if (!f) throw new Error("crm-generic");
  const csv = [
    "ID,Name,Email,Company,Website",
    `1,Jane Doe,${JANE},Umbrella,https://umbrella.example`,
    `2,Bob Roe,${BOB},Umbrella,https://umbrella.example`,
  ].join("\n");
  await runCrmImport(pg.db, new CrmCsvSource(f, "export.csv", new TextEncoder().encode(csv)));
});

interface ReplyOpts {
  wroteAs?: string | null;
  niche?: string;
  sender?: string;
  kind?: "person" | "role_inbox";
  subject?: string | null;
  body?: string | null;
  snippet?: string | null;
  from?: string | null;
}

/** An email to this person written as `wroteAs`, and their reply with this disposition. */
async function reply(email: string, disposition: string | null, o: ReplyOpts = {}) {
  const [person] = await pg.db.execute<{ id: number; company_id: number }>(
    sql`select person_id as id, company_id from crm_contacts where email = ${email} limit 1`,
  );
  const kind = o.kind ?? "person";
  const personId = kind === "role_inbox" ? null : person?.id;
  const [enr] = await pg.db.execute<{ id: number }>(sql`
    insert into enrollments (person_id, company_id, niche, sequence_name, sequence_snapshot, offer,
      state, kind, to_email, sender)
    values (${personId}, ${person?.company_id}, ${o.niche ?? "reactivation"}, 'reactivation',
      '{}'::jsonb, 'reactivation', 'finished', ${kind}, ${email}, ${o.sender ?? SAM})
    returning id`);
  const wroteAs = o.wroteAs === undefined ? PAT : o.wroteAs;
  await pg.db.execute(sql`
    insert into messages (enrollment_id, step, template, template_version, to_email, subject, body,
      provenance, state)
    values (${enr?.id}, 0, 'reactivation_opener', 'v1', ${email}, 'umbrella', 'Hi',
      ${JSON.stringify(wroteAs ? { recruiter: wroteAs } : {})}::jsonb, 'draft')`);
  const [t] = await pg.db.execute<{ id: number }>(sql`
    insert into thread_events (enrollment_id, kind, disposition, disposition_source, from_address,
      subject, body_text, snippet, received_at)
    values (${enr?.id}, 'reply', ${disposition}, ${disposition ? "llm" : null},
      ${o.from === undefined ? email : o.from},
      ${o.subject === undefined ? "Re: umbrella" : o.subject},
      ${o.body === undefined ? "Sounds good, Tuesday works." : o.body},
      ${o.snippet ?? null}, now())
    returning id`);
  return Number(t?.id);
}

const handoffRows = () =>
  pg.db.execute<{ thread_event_id: number; recruiter_email: string; forwarded: boolean }>(sql`
    select thread_event_id, recruiter_email, forwarded_at is not null as forwarded
    from handoffs order by id`);

const pass = (transport: Transport, extra: { limit?: number; profile?: unknown } = {}) =>
  forwardHandoffs(pg.db, transport, {
    profile: (extra.profile === undefined ? PROFILE : extra.profile) as typeof PROFILE | null,
    settings: SETTINGS,
    ...(extra.limit === undefined ? {} : { limit: extra.limit }),
  });

const sentFrom = (t: ConsoleTransport, sender = SAM) =>
  (t.mailbox.get(sender) ?? []).map((s) => s.email);

/** A transport that answers `send` slowly, like a real provider. */
class Slow implements Transport {
  readonly name = "slow";
  constructor(
    readonly inner: ConsoleTransport,
    readonly ms = 150,
  ) {}
  async send(email: OutgoingEmail): Promise<SendReceipt> {
    await new Promise((r) => setTimeout(r, this.ms));
    return this.inner.send(email);
  }
  find(sender: string, messageId: string) {
    return this.inner.find(sender, messageId);
  }
}

/** `db` whose `execute` throws once on the statement matching `pattern`, in a transaction too. */
function failOnce(db: Db, pattern: RegExp): Db {
  const dialect = new PgDialect();
  let failed = false;
  const wrap = <T extends object>(inner: T): T =>
    new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === "execute") {
          return (q: SQL) => {
            if (!failed && pattern.test(dialect.sqlToQuery(q).sql)) {
              failed = true;
              return Promise.reject(new Error("connection reset"));
            }
            return (target as unknown as Db).execute(q);
          };
        }
        if (prop === "transaction") {
          return (fn: (tx: unknown) => Promise<unknown>) =>
            (target as unknown as Db).transaction((tx) => fn(wrap(tx)));
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  return wrap(db);
}

describe("never twice", () => {
  it("an ambiguous send is found on the next pass, not sent again", async () => {
    await reply(JANE, "interested");
    let lose = true;
    const t = quiet({ ambiguousAfter: () => lose });
    const first = await pass(t);
    expect(first).toMatchObject({ forwarded: 0, failed: 1 });
    lose = false;
    const second = await pass(t);
    expect(second).toMatchObject({ forwarded: 0, found: 1, failed: 0 });
    const third = await pass(t);
    expect(third).toMatchObject({ forwarded: 0, found: 0 });
    expect(sentFrom(t)).toHaveLength(1);
  });

  it("when find itself fails, nothing is sent blind; it goes once find answers", async () => {
    await reply(JANE, "interested");
    const down = quiet({ findFails: new Error("mailbox search 503") });
    const out = await pass(down);
    expect(out).toMatchObject({ forwarded: 0, failed: 1 });
    expect(sentFrom(down)).toHaveLength(0);
    const up = quiet();
    expect(await pass(up)).toMatchObject({ forwarded: 1 });
    expect(await pass(up)).toMatchObject({ forwarded: 0, found: 0 });
    expect(sentFrom(up)).toHaveLength(1);
  });

  it("a mark that fails after the send is repaired by find, not a second send", async () => {
    await reply(JANE, "interested");
    const t = quiet();
    const broken = failOnce(pg.db, /update "?handoffs"? set forwarded_at/i);
    const out = await forwardHandoffs(broken, t, { profile: PROFILE, settings: SETTINGS });
    expect(out).toMatchObject({ forwarded: 0, failed: 1 });
    expect(sentFrom(t)).toHaveLength(1);
    expect(await pass(t)).toMatchObject({ forwarded: 0, found: 1 });
    expect(sentFrom(t)).toHaveLength(1);
    expect((await handoffRows())[0]?.forwarded).toBe(true);
  });

  it("two passes that overlap forward once", async () => {
    // Was a bug: forwardHandoffs claims nothing before it sends. Two passes that
    // overlap (a Restate retry of a stuck attempt while the old one still runs,
    // or two deployments during a rollout) both read the row with
    // forwarded_at null, both ask find (nothing yet: the first send is still in
    // flight), and both send. The recruiter gets the reply twice.
    await reply(JANE, "interested");
    const inner = quiet();
    const t = new Slow(inner);
    await Promise.all([pass(t), pass(t)]);
    expect(sentFrom(inner)).toHaveLength(1);
  });
});

describe("which replies", () => {
  it("never other niches, other dispositions, or events that are not replies", async () => {
    await reply(JANE, "interested", { niche: "agencies" });
    for (const d of ["not_interested", "not_now", "wrong_person", "referral", "other", null]) {
      await reply(BOB, d);
    }
    // Non-reply kinds cannot carry a disposition (CHECK); add one anyway.
    const [enr] = await pg.db.execute<{ id: number }>(sql`select id from enrollments limit 1`);
    await pg.db.execute(sql`
      insert into thread_events (enrollment_id, kind, from_address, received_at)
      values (${enr?.id}, 'auto_reply', ${BOB}, now()), (${enr?.id}, 'unsubscribe', ${BOB}, now())`);
    const t = quiet();
    expect(await pass(t)).toMatchObject({ opened: 0, forwarded: 0 });
    expect(sentFrom(t)).toHaveLength(0);
  });

  it("a booking can't be marked on another niche's reply or on a non-reply", async () => {
    const other = await reply(JANE, "interested", { niche: "agencies" });
    await expect(
      markMeetingBooked(pg.db, { threadEventId: other, booked: true, by: "operator" }, PROFILE),
    ).rejects.toBeInstanceOf(HandoffRefusal);
    const [enr] = await pg.db.execute<{ id: number }>(
      sql`select id from enrollments where niche = 'agencies'`,
    );
    const [auto] = await pg.db.execute<{ id: number }>(sql`
      insert into thread_events (enrollment_id, kind, from_address, received_at)
      values (${enr?.id}, 'auto_reply', ${JANE}, now()) returning id`);
    await expect(
      markMeetingBooked(
        pg.db,
        { threadEventId: Number(auto?.id), booked: true, by: "operator" },
        PROFILE,
      ),
    ).rejects.toBeInstanceOf(HandoffRefusal);
  });

  it("a reply relabelled not interested before it went is not forwarded", async () => {
    // Was a bug: the pending query (forward.ts:90-101) never re-reads the
    // disposition. A reply the classifier called `interested` gets a handoff
    // row; it waits (no recruiter yet, or the mailbox refused). The operator
    // corrects it to `not_interested` (labelEvent). The next pass forwards it
    // anyway. Fix: in the pending query require
    // `t.disposition IN HANDED_OFF OR h.meeting_booked_at IS NOT NULL`.
    const jane = await reply(JANE, "interested", { wroteAs: null });
    const t = quiet();
    expect(await pass(t, { profile: null })).toMatchObject({ opened: 1, noRecruiter: 1 });
    await pg.db.execute(sql`
      update thread_events set disposition = 'not_interested', disposition_source = 'operator'
      where id = ${jane}`);
    await pass(t);
    expect(sentFrom(t)).toHaveLength(0);
  });

  it("a booking marked by mistake and taken back is not forwarded", async () => {
    // Was a bug: markMeetingBooked(booked: true) makes a handoff row; taking
    // the mark back (booked: false, "a mistake") clears the booking but leaves
    // the row, so a `not_interested` reply is still forwarded to the
    // recruiter on the next pass. Fix: same as above; the pending query
    // should require a handed-off disposition or a live booking.
    const jane = await reply(JANE, "not_interested");
    await markMeetingBooked(pg.db, { threadEventId: jane, booked: true, by: "operator" }, PROFILE);
    await markMeetingBooked(pg.db, { threadEventId: jane, booked: false, by: "operator" }, PROFILE);
    const t = quiet();
    await pass(t);
    expect(sentFrom(t)).toHaveLength(0);
  });
});

describe("to whom", () => {
  it("the recruiter the opener wrote as, in any case, else the default, else the first", async () => {
    await reply(JANE, "interested", { wroteAs: "Pat@ACME.example" });
    await reply(BOB, "meeting_booked", { wroteAs: null });
    const t = quiet();
    const out = await pass(t);
    expect(out).toMatchObject({ forwarded: 2 });
    expect(sentFrom(t).map((e) => e.to)).toEqual([PAT, LEE]);

    await truncate(pg.db, ["handoffs"]);
    const t2 = quiet();
    await pass(t2, { profile: { recruiters: PROFILE.recruiters, defaultRecruiter: null } });
    // Jane's recruiter stays Pat; Bob's falls to the first recruiter.
    expect(sentFrom(t2).map((e) => e.to)).toEqual([PAT, PAT]);
  });

  it("never back to the sending mailbox, whatever its case", async () => {
    await reply(JANE, "interested", { wroteAs: null });
    const t = quiet();
    // A profile whose only recruiter is the mailbox itself, in another case.
    const self = {
      recruiters: [{ name: "Sam", email: SAM.toUpperCase(), owners: [] }],
      defaultRecruiter: null,
    };
    expect(await pass(t, { profile: self })).toMatchObject({ forwarded: 0, noRecruiter: 1 });
    expect(sentFrom(t)).toHaveLength(0);
    // Later the firm names a recruiter: the row is re-resolved and stored.
    expect(await pass(t)).toMatchObject({ forwarded: 1 });
    expect((await handoffRows())[0]?.recruiter_email).toBe(LEE);
  });

  it("a mailbox in a recruiter's own name still reaches the firm's default", async () => {
    // Was a bug: compose's pickSender picks a sender whose address IS the
    // recruiter's email (compose.ts:92, `s.address === owned.email`), and then
    // provenance.recruiter is that address. handoffRecruiter returns wroteAs
    // before the default (handoff.ts:37), so the forward would go back to its
    // own mailbox; forward.ts:109 re-resolves with the same wroteAs and gets
    // the sender again, so the row counts `noRecruiter` every pass forever
    // (and holds one of the `limit` slots). Fix: in handoffRecruiter skip a
    // candidate equal to the sender (case-insensitive) and fall through to
    // the default, then the first other recruiter.
    await reply(JANE, "interested", { wroteAs: SAM });
    const t = quiet();
    const out = await pass(t, {
      profile: {
        recruiters: [{ name: "Sam", email: SAM, owners: [] }, ...PROFILE.recruiters],
        defaultRecruiter: LEE,
      },
    });
    expect(out).toMatchObject({ forwarded: 1, noRecruiter: 0 });
    expect(sentFrom(t).map((e) => e.to)).toEqual([LEE]);
  });
});

describe("from where, and what it says", () => {
  it("goes from the enrollment's mailbox with that mailbox's name", async () => {
    const OTHER = "kim@acme-talent.example";
    await reply(JANE, "interested", { sender: OTHER });
    const t = quiet();
    await forwardHandoffs(pg.db, t, {
      profile: PROFILE,
      settings: { senders: [...SETTINGS.senders, { address: OTHER, name: "Kim Lo" }] },
    });
    expect(sentFrom(t, SAM)).toHaveLength(0);
    const [e] = sentFrom(t, OTHER);
    expect(e).toMatchObject({ fromAddress: OTHER, fromName: "Kim Lo", to: PAT });
    expect(e?.messageId).toMatch(/@acme-talent\.example>$/);
  });

  it("a mailbox no longer in the settings still forwards, with no From name", async () => {
    await reply(JANE, "interested", { sender: "gone@acme-talent.example" });
    const t = quiet();
    expect(await pass(t)).toMatchObject({ forwarded: 1 });
    expect(sentFrom(t, "gone@acme-talent.example")[0]?.fromName).toBeNull();
  });

  it("no subject, no body, no name, no address: still a valid, readable email", async () => {
    await reply(JANE, "meeting_booked", {
      kind: "role_inbox",
      subject: null,
      body: null,
      from: null,
    });
    const t = quiet();
    expect(await pass(t)).toMatchObject({ forwarded: 1, failed: 0 });
    const [e] = sentFrom(t);
    expect(e?.subject).toBe("Fwd: reply from someone");
    expect(e?.body).toContain("(no text)");
    expect(e?.body).toContain("replied to book a meeting.");
    expect(e?.body).not.toMatch(/undefined|null/);
    expect(() => buildMime(e as OutgoingEmail)).not.toThrow();
  });

  it("blank subject and body fall back to the snippet and the contact's name", async () => {
    await reply(JANE, "interested", { subject: "   ", body: null, snippet: "Yes, call me." });
    const t = quiet();
    await pass(t);
    const [e] = sentFrom(t);
    expect(e?.subject).toBe("Fwd: reply from Jane Doe");
    expect(e?.body).toContain("Yes, call me.");
    expect(e?.body).toContain(`From: Jane Doe <${JANE}>`);
  });

  it("a huge body is forwarded whole and builds", async () => {
    const huge = `${"x".repeat(80)}\n`.repeat(20_000);
    await reply(JANE, "interested", { body: huge });
    const t = quiet();
    expect(await pass(t)).toMatchObject({ forwarded: 1 });
    const [e] = sentFrom(t);
    expect(e?.body).toContain(huge.trim());
    expect(buildMime(e as OutgoingEmail).length).toBeGreaterThan(huge.length);
  });

  it("forwardEmail's subject and headers never carry a line break", () => {
    const e = forwardEmail(
      {
        id: 1,
        thread_event_id: 1,
        recruiter_email: PAT,
        forward_message_id: "<a@acme-talent.example>",
        sender: SAM,
        wrote_as: null,
        full_name: "Jane Doe",
        from_address: JANE,
        subject: "  Re: umbrella  ",
        body_text: "hi",
        snippet: null,
        received_at: "2026-09-29T10:00:00Z",
        disposition: "interested",
      },
      PAT,
      "Sam Park",
    );
    expect(e.subject).toBe("Fwd: Re: umbrella");
    expect(e.body).toContain("Date: Tue, 29 Sep 2026 10:00:00 GMT");
    expect(() => buildMime(e)).not.toThrow();
  });
});

describe("what the operator hears", () => {
  it("sent lines never name the contact or their address", async () => {
    await reply(JANE, "interested");
    await reply(BOB, "meeting_booked", { wroteAs: null });
    const t = quiet();
    const out = await pass(t);
    expect(out.sent).toHaveLength(2);
    expect(out.sent.join("\n")).not.toMatch(/jane|bob|doe|roe|umbrella/i);
  });

  it("a forward that went but was only confirmed by find is still announced", async () => {
    // Was a bug: forward.ts:121 counts a forward confirmed by find as `found`
    // and pushes nothing to `sent`. After an ambiguous send the operator heard
    // "1 forward failed ... tried again next pass", and then never hears that
    // it had in fact gone. Fix: push a sent line for `found` too.
    await reply(JANE, "interested");
    let lose = true;
    const t = quiet({ ambiguousAfter: () => lose });
    await pass(t);
    lose = false;
    const again = await pass(t);
    expect(again.found).toBe(1);
    expect(again.sent).toHaveLength(1);
  });
});

describe("failures and limits", () => {
  it("a mailbox that refuses one forward doesn't stop the others in the same pass", async () => {
    await reply(JANE, "interested");
    await reply(BOB, "interested", { wroteAs: LEE });
    const t = quiet({
      refuse: (e) => (e.to === PAT ? new TransportRefused("550 no such user") : null),
    });
    const out = await pass(t);
    expect(out).toMatchObject({ forwarded: 1, failed: 1 });
    expect(out.errors[0]).toMatch(/^handoff \d+: 550 no such user$/);
    expect(sentFrom(t).map((e) => e.to)).toEqual([LEE]);
  });

  it("limit bounds rows opened and forwarded per pass; the rest go next pass", async () => {
    await reply(JANE, "interested");
    await reply(BOB, "interested");
    await reply(JANE, "meeting_booked");
    const t = quiet();
    expect(await pass(t, { limit: 2 })).toMatchObject({ opened: 2, forwarded: 2 });
    expect(await pass(t, { limit: 2 })).toMatchObject({ opened: 1, forwarded: 1 });
    expect(await pass(t, { limit: 2 })).toMatchObject({ opened: 0, forwarded: 0 });
    expect(sentFrom(t)).toHaveLength(3);
  });

  it("forwards that fail every pass don't starve newer ones", async () => {
    // Was a bug: the pending query is `ORDER BY h.id LIMIT limit` over every
    // unforwarded row (forward.ts:100-101). `limit` rows that fail every pass
    // (a recruiter address the mailbox rejects, a row stuck on noRecruiter as
    // in "a mailbox in a recruiter's own name") hold the head of the queue, and
    // every newer reply waits forever. The loop's limit is 10, so ten stuck
    // rows stop all forwarding for that client. Fix: order by last attempt
    // (add `attempted_at`, `ORDER BY attempted_at NULLS FIRST, id`), or skip
    // rows whose last failure is recent.
    await reply(JANE, "interested"); // to Pat: always refused
    await reply(BOB, "interested", { wroteAs: LEE });
    const t = quiet({
      refuse: (e) => (e.to === PAT ? new TransportRefused("550 no such user") : null),
    });
    for (let i = 0; i < 3; i++) await pass(t, { limit: 1 });
    expect(sentFrom(t).map((e) => e.to)).toEqual([LEE]);
  });
});
