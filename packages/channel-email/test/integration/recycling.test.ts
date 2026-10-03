/**
 * Lead recycling (designs/2026-09-30-lead-recycling.md): the contact_outcomes view, the
 * returning audience in compose, the queue-keeper's two sweeps and the pool-feeder's
 * re-check of returning companies. Rest is measured on the DB clock, so every test ages
 * its rows in SQL.
 */
import { loadSettings } from "@wren/config";
import { type Company, imports, type Lead, leads, type Person } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { asc, eq, sql } from "drizzle-orm";
import { LocalChecker } from "mailifier";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sequence, sequenceStep } from "../../src/outreach/sequences.js";
import { field, template, text } from "../../src/outreach/templates.js";
import { DEFAULT_RECONTACT, recontactPolicy } from "../../src/recontact.js";
import { type Campaign, topUp } from "../../src/restate/compose-scheduler.js";
import {
  type Enrollment,
  type EnrollmentKind,
  enrollments,
  messages,
  type ReplyDisposition,
  type StopReason,
  type ThreadEventKind,
  threadEvents,
  type VerificationResult,
  verifications,
} from "../../src/schema.js";
import { SendPolicy } from "../../src/send/policy.js";
import { runVerification } from "../../src/verification/service.js";
import { FakeVerifier } from "../../src/verification/verifier.js";
import {
  allEnrollments,
  makeCompany,
  makePerson,
  roleCompany,
  runCompose,
  SENDER,
  SEQ,
  TABLES,
  TEMPLATES,
} from "./compose-fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, TABLES));
const db = () => pg.db;

const DAY = 86_400_000;
/** A sequence the rested companies never had. */
const NEW_SEQ = sequence("new-seq", [sequenceStep("opener", 0), sequenceStep("followup", 3)]);
const NEW_OFFER = "new-offer";

// --------------------------------------------------------------------------
// Fixtures

/** Set `column` of row `id` to `days` ago on the DB clock. */
async function age(table: string, column: string, id: number, days: number) {
  await db().execute(
    sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier(column)} = now() - make_interval(days => ${days}::int) WHERE id = ${id}`,
  );
}

/** A raw past (or live) enrollment, created `daysAgo` and, when stopped, stopped `stoppedDaysAgo`. */
async function pastEnrollment(
  company: Company,
  opts: {
    toEmail: string;
    person?: Person | null;
    kind?: EnrollmentKind;
    niche?: string;
    sequence?: string;
    offer?: string;
    state?: "active" | "finished" | "stopped";
    stopReason?: StopReason;
    daysAgo?: number;
    stoppedDaysAgo?: number;
  },
): Promise<Enrollment> {
  const state = opts.state ?? (opts.stopReason ? "stopped" : "finished");
  const [row] = await db()
    .insert(enrollments)
    .values({
      personId: opts.person?.id ?? null,
      companyId: company.id,
      kind: opts.kind ?? (opts.person ? "person" : "role_inbox"),
      toEmail: opts.toEmail,
      sender: SENDER,
      niche: opts.niche ?? company.niche ?? "sec_ria",
      sequenceName: opts.sequence ?? SEQ.name,
      sequenceSnapshot: { name: opts.sequence ?? SEQ.name, steps: [] },
      offer: opts.offer ?? "test-offer",
      state,
      stopReason: state === "stopped" ? (opts.stopReason ?? "manual") : null,
    })
    .returning();
  const enrollment = row as Enrollment;
  const days = opts.daysAgo ?? 0;
  await age("enrollments", "created_at", enrollment.id, days);
  if (state === "stopped") {
    await age("enrollments", "stopped_at", enrollment.id, opts.stoppedDaysAgo ?? days);
  }
  return enrollment;
}

/** A sent message on `enrollment`, sent `daysAgo`. */
async function sentMessage(enrollment: Enrollment, step: number, daysAgo: number) {
  const [row] = await db()
    .insert(messages)
    .values({
      enrollmentId: enrollment.id,
      step,
      template: "opener",
      templateVersion: "v1",
      toEmail: enrollment.toEmail,
      subject: "hi",
      body: "hello",
      provenance: {},
      state: "sent",
      messageId: `<m${enrollment.id}-${step}@test>`,
      sentAt: new Date(),
    })
    .returning({ id: messages.id });
  const id = (row as { id: number }).id;
  await age("messages", "sent_at", id, daysAgo);
  return id;
}

/** An inbound thread event on `enrollment`, received `daysAgo`. */
async function inbound(
  enrollment: Enrollment,
  kind: ThreadEventKind,
  opts: { disposition?: ReplyDisposition; bounceClass?: "hard" | "soft"; daysAgo?: number } = {},
) {
  const [row] = await db()
    .insert(threadEvents)
    .values({
      enrollmentId: enrollment.id,
      kind,
      bounceClass: kind === "bounce" ? (opts.bounceClass ?? "hard") : null,
      disposition: opts.disposition ?? null,
      dispositionSource: opts.disposition ? "operator" : null,
      receivedAt: new Date(),
    })
    .returning({ id: threadEvents.id });
  const id = (row as { id: number }).id;
  await age("thread_events", "received_at", id, opts.daysAgo ?? 0);
  return id;
}

/** A stopped-on-reply enrollment whose reply carries `disposition` (null = unclassified). */
async function replied(
  company: Company,
  toEmail: string,
  disposition: ReplyDisposition | null,
  daysAgo = 0,
  person: Person | null = null,
) {
  const enrollment = await pastEnrollment(company, {
    toEmail,
    person,
    stopReason: "reply",
    daysAgo,
  });
  await inbound(enrollment, "reply", {
    ...(disposition ? { disposition } : {}),
    daysAgo,
  });
  return enrollment;
}

async function outcomes(): Promise<Map<number, { outcome: string; last_touch_at: Date }>> {
  const rows = (await db().execute(
    sql`SELECT enrollment_id, outcome, last_touch_at FROM contact_outcomes ORDER BY enrollment_id`,
  )) as unknown as { enrollment_id: number; outcome: string; last_touch_at: Date | string }[];
  return new Map(
    rows.map((r) => [
      r.enrollment_id,
      { outcome: r.outcome, last_touch_at: new Date(r.last_touch_at) },
    ]),
  );
}

/** A company with an Owner holding a fresh verified address. */
async function staffed(domain: string, email = `jane@${domain}`) {
  const company = await makeCompany(db(), { domain, name: `Firm ${domain}` });
  const person = await makePerson(db(), company, { email });
  return { company, person, email };
}

/** A company that had one no-reply sequence, finished `daysAgo`, and an Owner with a fresh address. */
async function rested(domain: string, daysAgo: number) {
  const s = await staffed(domain);
  const old = await pastEnrollment(s.company, {
    toEmail: s.email,
    person: s.person,
    state: "finished",
    daysAgo,
  });
  return { ...s, old };
}

const returning = (overrides: Parameters<typeof runCompose>[1] = {}) =>
  runCompose(db(), {
    audience: "returning",
    sequence: NEW_SEQ,
    offer: NEW_OFFER,
    ...overrides,
  });

const newEnrollments = async () =>
  (await allEnrollments(db())).filter((e) => e.sequenceName !== SEQ.name);

// --------------------------------------------------------------------------

describe("contact_outcomes", () => {
  it("names each enrollment's outcome", async () => {
    const c = await makeCompany(db(), { domain: "cases.example" });
    const at = (local: string) => `${local}@cases.example`;
    const want = new Map<number, string>();
    const expectOutcome = (e: Enrollment, outcome: string) => want.set(e.id, outcome);

    expectOutcome(await pastEnrollment(c, { toEmail: at("active"), state: "active" }), "active");
    expectOutcome(await pastEnrollment(c, { toEmail: at("done"), state: "finished" }), "no_reply");
    expectOutcome(
      await pastEnrollment(c, { toEmail: at("optout"), stopReason: "opt_out" }),
      "opted_out",
    );
    expectOutcome(
      await pastEnrollment(c, { toEmail: at("complaint"), stopReason: "complaint" }),
      "opted_out",
    );
    const unsubscribed = await pastEnrollment(c, { toEmail: at("unsub"), state: "finished" });
    await inbound(unsubscribed, "unsubscribe");
    expectOutcome(unsubscribed, "opted_out");
    const complained = await pastEnrollment(c, { toEmail: at("complained"), state: "finished" });
    await inbound(complained, "complaint");
    expectOutcome(complained, "opted_out");
    expectOutcome(await replied(c, at("warm"), "interested"), "warm");
    expectOutcome(await replied(c, at("booked"), "meeting_booked"), "warm");
    expectOutcome(await replied(c, at("unclassified"), null), "needs_a_look");
    expectOutcome(await replied(c, at("other"), "other"), "needs_a_look");
    expectOutcome(await replied(c, at("no"), "not_interested"), "not_interested");
    expectOutcome(await replied(c, at("later"), "not_now"), "not_now");
    expectOutcome(await replied(c, at("wrong"), "wrong_person"), "wrong_person");
    expectOutcome(await replied(c, at("ref"), "referral"), "referral");
    expectOutcome(
      await pastEnrollment(c, { toEmail: at("bounced"), stopReason: "bounce" }),
      "bounced",
    );
    const hard = await pastEnrollment(c, { toEmail: at("hard"), state: "finished" });
    await inbound(hard, "bounce", { bounceClass: "hard" });
    expectOutcome(hard, "bounced");
    const soft = await pastEnrollment(c, { toEmail: at("soft"), state: "finished" });
    await inbound(soft, "bounce", { bounceClass: "soft" });
    expectOutcome(soft, "no_reply");
    const auto = await pastEnrollment(c, { toEmail: at("ooo"), state: "finished" });
    await inbound(auto, "auto_reply");
    expectOutcome(auto, "no_reply");
    expectOutcome(
      await pastEnrollment(c, { toEmail: at("manual"), stopReason: "manual" }),
      "stopped_by_hand",
    );

    const got = await outcomes();
    expect(new Map([...got].map(([id, row]) => [id, row.outcome]))).toEqual(want);
  });

  it("opted_out beats warm; warm beats stopped by hand; by hand beats needs_a_look", async () => {
    const c = await makeCompany(db(), { domain: "order.example" });
    const warmThenUnsub = await replied(c, "a@order.example", "interested");
    await inbound(warmThenUnsub, "unsubscribe");
    const optOutReason = await pastEnrollment(c, {
      toEmail: "b@order.example",
      stopReason: "opt_out",
    });
    await inbound(optOutReason, "reply", { disposition: "interested" });
    const manualWarm = await pastEnrollment(c, {
      toEmail: "c@order.example",
      stopReason: "manual",
    });
    await inbound(manualWarm, "reply", { disposition: "meeting_booked" });
    const manualUnclassified = await pastEnrollment(c, {
      toEmail: "d@order.example",
      stopReason: "manual",
    });
    await inbound(manualUnclassified, "reply");
    const bounceThenNo = await pastEnrollment(c, {
      toEmail: "e@order.example",
      stopReason: "bounce",
    });
    await inbound(bounceThenNo, "reply", { disposition: "not_interested" });

    const got = await outcomes();
    expect(got.get(warmThenUnsub.id)?.outcome).toBe("opted_out");
    expect(got.get(optOutReason.id)?.outcome).toBe("opted_out");
    expect(got.get(manualWarm.id)?.outcome).toBe("warm");
    expect(got.get(manualUnclassified.id)?.outcome).toBe("stopped_by_hand");
    expect(got.get(bounceThenNo.id)?.outcome).toBe("not_interested");
  });

  it("the newest classified reply names a resting outcome", async () => {
    const c = await makeCompany(db(), { domain: "newest.example" });
    const e = await pastEnrollment(c, { toEmail: "a@newest.example", stopReason: "reply" });
    await inbound(e, "reply", { disposition: "not_now", daysAgo: 10 });
    await inbound(e, "reply", { disposition: "not_interested", daysAgo: 2 });
    expect((await outcomes()).get(e.id)?.outcome).toBe("not_interested");
  });

  it("the newest reply decides between classified and needs_a_look", async () => {
    const c = await makeCompany(db(), { domain: "latest.example" });
    const classifiedLast = await pastEnrollment(c, {
      toEmail: "a@latest.example",
      stopReason: "reply",
    });
    await inbound(classifiedLast, "reply", { daysAgo: 10 });
    await inbound(classifiedLast, "reply", { disposition: "not_interested", daysAgo: 2 });
    const unclassifiedLast = await pastEnrollment(c, {
      toEmail: "b@latest.example",
      stopReason: "reply",
    });
    await inbound(unclassifiedLast, "reply", { disposition: "not_interested", daysAgo: 10 });
    await inbound(unclassifiedLast, "reply", { daysAgo: 2 });
    const got = await outcomes();
    expect(got.get(classifiedLast.id)?.outcome).toBe("not_interested");
    expect(got.get(unclassifiedLast.id)?.outcome).toBe("needs_a_look");
  });

  it("last_touch_at is the latest of enrolled, stopped, last send and last inbound", async () => {
    const c = await makeCompany(db(), { domain: "touch.example" });
    const dbNow = async () => {
      const [row] = (await db().execute(sql`SELECT now() AS now`)) as unknown as {
        now: Date | string;
      }[];
      return new Date((row as { now: Date | string }).now).getTime();
    };
    const near = (got: Date | undefined, daysAgo: number, now: number) =>
      expect(Math.abs((got?.getTime() ?? 0) - (now - daysAgo * DAY))).toBeLessThan(60_000);

    // Only enrolled.
    const bare = await pastEnrollment(c, { toEmail: "a@touch.example", daysAgo: 120 });
    // Enrolled, then sends: the newest send wins, a later draft does not count.
    const sends = await pastEnrollment(c, { toEmail: "b@touch.example", daysAgo: 120 });
    await sentMessage(sends, 0, 118);
    await sentMessage(sends, 1, 113);
    // Stopped after the last send.
    const stopped = await pastEnrollment(c, {
      toEmail: "c@touch.example",
      stopReason: "manual",
      daysAgo: 120,
      stoppedDaysAgo: 100,
    });
    await sentMessage(stopped, 0, 118);
    // An inbound event after everything else.
    const inboundLast = await pastEnrollment(c, {
      toEmail: "d@touch.example",
      stopReason: "reply",
      daysAgo: 120,
      stoppedDaysAgo: 100,
    });
    await sentMessage(inboundLast, 0, 118);
    await inbound(inboundLast, "reply", { disposition: "not_now", daysAgo: 99 });
    await inbound(inboundLast, "auto_reply", { daysAgo: 95 });

    const got = await outcomes();
    const now = await dbNow();
    near(got.get(bare.id)?.last_touch_at, 120, now);
    near(got.get(sends.id)?.last_touch_at, 113, now);
    near(got.get(stopped.id)?.last_touch_at, 100, now);
    near(got.get(inboundLast.id)?.last_touch_at, 95, now);
  });
});

describe("compose audience=returning", () => {
  it("a no-reply company rested 91 days gets a new sequence as contact round 2", async () => {
    const { company, old, email } = await rested("oak.example", 91);
    const stats = await returning();
    expect(stats.enrolled).toBe(1);
    const rows = await allEnrollments(db());
    expect(rows.map((e) => [e.id, e.contactRound, e.sequenceName, e.offer])).toEqual([
      [old.id, 1, SEQ.name, "test-offer"],
      [expect.any(Number), 2, NEW_SEQ.name, NEW_OFFER],
    ]);
    const fresh = rows[1] as Enrollment;
    expect(fresh.companyId).toBe(company.id);
    expect(fresh.toEmail).toBe(email);
    expect(fresh.state).toBe("active");
  });

  it("a no-reply company at 89 days is still resting", async () => {
    await rested("oak.example", 89);
    const stats = await returning();
    expect(stats.enrolled).toBe(0);
    expect(await newEnrollments()).toEqual([]);
  });

  it("refuses the same sequence+offer again; a new offer on the same sequence is a new pitch", async () => {
    await rested("oak.example", 91);
    expect((await returning({ sequence: SEQ, offer: "test-offer" })).enrolled).toBe(0);
    const again = await returning({ sequence: SEQ, offer: NEW_OFFER });
    expect(again.enrolled).toBe(1);
    const rows = await allEnrollments(db());
    expect(rows.map((e) => [e.sequenceName, e.offer, e.contactRound])).toEqual([
      [SEQ.name, "test-offer", 1],
      [SEQ.name, NEW_OFFER, 2],
    ]);
  });

  it("not_interested rests 180 days: 179 refused, 181 enrolled", async () => {
    const early = await staffed("early.example");
    await replied(early.company, early.email, "not_interested", 179, early.person);
    const late = await staffed("late.example");
    await replied(late.company, late.email, "not_interested", 181, late.person);
    const stats = await returning();
    expect(stats.enrolled).toBe(1);
    expect((await newEnrollments()).map((e) => [e.companyId, e.contactRound])).toEqual([
      [late.company.id, 2],
    ]);
  });

  it("not_now rests 90 days like no reply", async () => {
    const early = await staffed("early.example");
    await replied(early.company, early.email, "not_now", 89, early.person);
    const late = await staffed("late.example");
    await replied(late.company, late.email, "not_now", 91, late.person);
    await returning();
    expect((await newEnrollments()).map((e) => e.companyId)).toEqual([late.company.id]);
  });

  it("never brings back opted out, warm, stopped by hand or unclassified companies", async () => {
    const optOut = await staffed("optout.example");
    await pastEnrollment(optOut.company, {
      toEmail: "old@optout.example",
      stopReason: "opt_out",
      daysAgo: 1000,
    });
    const unsub = await staffed("unsub.example");
    const u = await pastEnrollment(unsub.company, {
      toEmail: "old@unsub.example",
      state: "finished",
      daysAgo: 1000,
    });
    await inbound(u, "unsubscribe", { daysAgo: 1000 });
    const warm = await staffed("warm.example");
    await replied(warm.company, "old@warm.example", "interested", 1000);
    const manual = await staffed("manual.example");
    await pastEnrollment(manual.company, {
      toEmail: "old@manual.example",
      stopReason: "manual",
      daysAgo: 1000,
    });
    const unclassified = await staffed("look.example");
    await replied(unclassified.company, "old@look.example", null, 1000);
    const live = await staffed("live.example");
    await pastEnrollment(live.company, {
      toEmail: "old@live.example",
      state: "active",
      daysAgo: 1000,
    });
    const stats = await returning();
    expect(stats.enrolled).toBe(0);
    expect(await newEnrollments()).toEqual([]);
  });

  it("a third sequence inside 365 days is refused by perYear=2", async () => {
    const capped = await rested("capped.example", 300);
    await pastEnrollment(capped.company, {
      toEmail: capped.email,
      person: capped.person,
      sequence: "second-seq",
      offer: "second-offer",
      state: "finished",
      daysAgo: 100,
    });
    const open = await rested("open.example", 400);
    await pastEnrollment(open.company, {
      toEmail: open.email,
      person: open.person,
      sequence: "second-seq",
      offer: "second-offer",
      state: "finished",
      daysAgo: 100,
    });
    const stats = await returning();
    expect(stats.enrolled).toBe(1);
    expect((await newEnrollments()).filter((e) => e.sequenceName === NEW_SEQ.name)).toEqual([
      expect.objectContaining({ companyId: open.company.id, contactRound: 3 }),
    ]);
  });

  it("follows the niche's policy: shorter rest, never, and a cap of 1", async () => {
    await rested("short.example", 31);
    const shorter = recontactPolicy({ restDays: { no_reply: 30 } });
    expect((await returning({ recontact: DEFAULT_RECONTACT })).enrolled).toBe(0);
    expect(
      (await returning({ recontact: recontactPolicy({ restDays: { no_reply: null } }) })).enrolled,
    ).toBe(0);
    expect((await returning({ recontact: recontactPolicy({ perYear: 1 }) })).enrolled).toBe(0);
    expect((await returning({ recontact: shorter })).enrolled).toBe(1);
  });

  it("first_contact never picks a company that was enrolled before", async () => {
    const old = await rested("old.example", 400);
    const fresh = await staffed("fresh.example");
    const stats = await runCompose(db(), { sequence: NEW_SEQ, offer: NEW_OFFER });
    expect(stats.enrolled).toBe(1);
    const rows = await newEnrollments();
    expect(rows.map((e) => [e.companyId, e.contactRound])).toEqual([[fresh.company.id, 1]]);
    expect(rows.some((e) => e.companyId === old.company.id)).toBe(false);
  });

  it("returning never picks a company that was never enrolled", async () => {
    await staffed("fresh.example");
    expect((await returning()).enrolled).toBe(0);
  });

  it("wrong_person: the old address is done, another person goes right away", async () => {
    const company = await makeCompany(db(), { domain: "firm.example" });
    const jane = await makePerson(db(), company, {
      full: "Jane Doe",
      first: "Jane",
      title: "Owner",
      email: "jane@firm.example",
    });
    await makePerson(db(), company, {
      full: "Bob Roe",
      first: "Bob",
      title: "Partner",
      email: "bob@firm.example",
    });
    // Case differs from the address on file: done addresses compare lowercased.
    await replied(company, "Jane@Firm.example", "wrong_person", 0, jane);
    const stats = await returning();
    expect(stats.skipped_address_done).toBe(1);
    expect(stats.enrolled_person).toBe(1);
    const [fresh] = await newEnrollments();
    expect(fresh).toMatchObject({ toEmail: "bob@firm.example", contactRound: 2 });
  });

  it("referral: same as wrong_person", async () => {
    const company = await makeCompany(db(), { domain: "firm.example" });
    const jane = await makePerson(db(), company, { email: "jane@firm.example" });
    await makePerson(db(), company, {
      full: "Bob Roe",
      first: "Bob",
      title: "Partner",
      email: "bob@firm.example",
    });
    await replied(company, "jane@firm.example", "referral", 0, jane);
    const stats = await returning();
    expect(stats).toMatchObject({ skipped_address_done: 1, enrolled_person: 1 });
    expect((await newEnrollments())[0]?.toEmail).toBe("bob@firm.example");
  });

  it("a done address is never used again, even once its company has rested", async () => {
    const company = await makeCompany(db(), { domain: "solo.example" });
    const jane = await makePerson(db(), company, { email: "jane@solo.example" });
    await pastEnrollment(company, {
      toEmail: "jane@solo.example",
      person: jane,
      stopReason: "bounce",
      daysAgo: 400,
    });
    const stats = await returning();
    expect(stats).toMatchObject({ enrolled: 0, skipped_address_done: 1 });
  });
});

describe("compose audience=returning, role inbox", () => {
  const ROLE_OPENER = template(
    "opener",
    [text("automation at "), field("company_name")],
    [text("Hi "), field("first_name", "there"), text(",")],
  );
  const ROLE_TEMPLATES = new Map(TEMPLATES).set("opener", ROLE_OPENER);

  async function restedInbox(domain: string, daysAgo = 91) {
    const email = `info@${domain}`;
    const company = await roleCompany(db(), domain, email);
    const [lead] = await db().select().from(leads).where(eq(leads.email, email));
    await pastEnrollment(company, { toEmail: email, kind: "role_inbox", daysAgo });
    return { company, lead: lead as Lead, email };
  }
  async function verdict(lead: Lead, result: VerificationResult, daysAgo: number) {
    const [row] = await db()
      .insert(verifications)
      .values({ leadId: lead.id, email: lead.email, verifier: "smtp", result, raw: {} })
      .returning({ id: verifications.id });
    await age("verifications", "checked_at", (row as { id: number }).id, daysAgo);
  }
  const run = () => returning({ templates: ROLE_TEMPLATES, kind: "role_inbox" });

  it("needs a verdict: none is refused even with roleInboxNeedsVerdict off", async () => {
    await restedInbox("none.example");
    const stats = await returning({
      templates: ROLE_TEMPLATES,
      kind: "role_inbox",
      roleInboxNeedsVerdict: false,
    });
    expect(stats.enrolled).toBe(0);
  });

  it("a valid verdict older than the horizon is refused", async () => {
    const { lead } = await restedInbox("stale.example");
    await verdict(lead, "valid", 50);
    expect((await run()).enrolled).toBe(0);
  });

  it("a risky verdict inside the horizon is refused", async () => {
    const { lead } = await restedInbox("risky.example");
    await verdict(lead, "risky", 1);
    expect((await run()).enrolled).toBe(0);
  });

  it.each([
    ["valid", 10],
    ["catch_all", 0],
  ] as const)("a %s verdict %i days old is enough", async (result, daysAgo) => {
    const { lead, company, email } = await restedInbox("ok.example");
    await verdict(lead, result, daysAgo);
    const stats = await run();
    expect(stats.enrolled_role_inbox).toBe(1);
    expect(await newEnrollments()).toEqual([
      expect.objectContaining({
        companyId: company.id,
        kind: "role_inbox",
        toEmail: email,
        contactRound: 2,
      }),
    ]);
  });

  it("a bounced inbox is done even after its 30-day rest", async () => {
    const email = "info@bounced.example";
    const company = await roleCompany(db(), "bounced.example", email);
    const [lead] = await db().select().from(leads).where(eq(leads.email, email));
    await pastEnrollment(company, {
      toEmail: email,
      kind: "role_inbox",
      stopReason: "bounce",
      daysAgo: 31,
    });
    await verdict(lead as Lead, "valid", 0);
    const stats = await run();
    expect(stats).toMatchObject({ enrolled: 0, skipped_address_done: 1 });
  });
});

describe("topUp with returning companies", () => {
  const FRESH = sequence("fresh-seq", [sequenceStep("opener", 0), sequenceStep("followup", 3)]);
  const AGAIN = sequence("again-seq", [sequenceStep("opener", 0), sequenceStep("followup", 3)]);
  const campaign = (plan: Campaign["plan"]): Campaign => ({
    niche: "sec_ria",
    plan,
    mailsRoleInboxes: true,
    sequences: new Map([
      [FRESH.name, FRESH],
      [AGAIN.name, AGAIN],
    ]),
    offers: new Map([
      [FRESH.name, "fresh-offer"],
      [AGAIN.name, "again-offer"],
    ]),
    offerFacts: new Map(),
    templates: TEMPLATES,
    factsView: null,
    senders: [SENDER],
    signatures: {},
    companyLocation: () => null,
    recontact: DEFAULT_RECONTACT,
  });
  // Flat cap of 2 per inbox, one inbox: capacity 2/day.
  const POLICY = SendPolicy.fromSettings(
    loadSettings({
      WREN_DATABASE_URL: "postgresql://x",
      WREN_SEND_TIMEZONE: "UTC",
      WREN_COLD_SENDS_PER_INBOX_PER_DAY: "2",
    }),
  );
  const opts = (daysAhead: number) => ({
    policy: POLICY,
    now: new Date("2026-09-21T10:00:00Z"),
    daysAhead,
    verificationHorizonDays: 45,
    trackOpens: false,
    roleInboxNeedsVerdict: false,
    runId: null,
  });
  const SPLIT = campaign([
    { sequence: FRESH.name, audience: "first_contact" },
    { sequence: AGAIN.name, audience: "returning" },
  ]);

  it("fills with first contact first, then returning companies take the rest", async () => {
    const fresh = [await staffed("f1.example"), await staffed("f2.example")];
    const back = [
      await rested("r1.example", 100),
      await rested("r2.example", 100),
      await rested("r3.example", 100),
    ];
    const stats = await topUp(db(), SPLIT, opts(2));
    expect(stats).toMatchObject({ target: 4, shortfall: 4, enrolled: 4, exhausted: false });
    expect(stats.passes.map((p) => [p.audience, p.sequence, p.stats.enrolled])).toEqual([
      ["first_contact", FRESH.name, 2],
      ["returning", AGAIN.name, 2],
    ]);
    const rows = (await allEnrollments(db())).filter((e) => e.sequenceName !== SEQ.name);
    expect(rows.map((e) => [e.companyId, e.sequenceName, e.offer, e.contactRound])).toEqual([
      [fresh[0]?.company.id, FRESH.name, "fresh-offer", 1],
      [fresh[1]?.company.id, FRESH.name, "fresh-offer", 1],
      [back[0]?.company.id, AGAIN.name, "again-offer", 2],
      [back[1]?.company.id, AGAIN.name, "again-offer", 2],
    ]);
  });

  it("returning companies wait while first contact fills the day", async () => {
    await staffed("f1.example");
    await staffed("f2.example");
    await staffed("f3.example");
    await rested("r1.example", 100);
    const stats = await topUp(db(), SPLIT, opts(1));
    expect(stats).toMatchObject({ target: 2, enrolled: 2, exhausted: false });
    expect(stats.passes.map((p) => [p.audience, p.sequence, p.stats.enrolled])).toEqual([
      ["first_contact", FRESH.name, 2],
    ]);
    const rows = await allEnrollments(db());
    expect(rows.filter((e) => e.contactRound > 1)).toEqual([]);
  });

  it("a both-audience rule runs once per audience, each pass carrying it", async () => {
    await staffed("f1.example");
    const back = await rested("r1.example", 100);
    await rested("resting.example", 10);
    const stats = await topUp(db(), campaign([{ sequence: FRESH.name }]), opts(3));
    expect(stats.passes.map((p) => [p.audience, p.sequence, p.stats.enrolled])).toEqual([
      ["first_contact", FRESH.name, 1],
      ["returning", FRESH.name, 1],
    ]);
    expect(stats).toMatchObject({ enrolled: 2, exhausted: true });
    const recycled = (await allEnrollments(db())).filter((e) => e.contactRound === 2);
    expect(recycled.map((e) => e.companyId)).toEqual([back.company.id]);
  });
});

describe("runVerification recheckReturning", () => {
  const checker = () =>
    new LocalChecker(async (name, rtype) => (rtype === "MX" ? [`10 mail.${name}.`] : []));

  async function leadAt(
    company: Company,
    email: string,
    status: "imported" | "verified",
    result: VerificationResult,
    checkedDaysAgo: number,
  ): Promise<Lead> {
    const [batch] = await db()
      .insert(imports)
      .values({ sourceType: "test", sourceRef: "inline", stats: {} })
      .returning({ id: imports.id });
    const [lead] = await db()
      .insert(leads)
      .values({
        email,
        status,
        raw: {},
        importId: (batch as { id: number }).id,
        companyId: company.id,
      })
      .returning();
    const [v] = await db()
      .insert(verifications)
      .values({ leadId: (lead as Lead).id, email, verifier: "smtp", result, raw: {} })
      .returning({ id: verifications.id });
    await age("verifications", "checked_at", (v as { id: number }).id, checkedDaysAgo);
    return lead as Lead;
  }
  async function firm(domain: string, past?: Parameters<typeof pastEnrollment>[1]) {
    const company = await makeCompany(db(), { domain, name: domain });
    if (past) await pastEnrollment(company, past);
    return company;
  }
  const noReply = (domain: string, daysAgo: number) => ({
    toEmail: `old@${domain}`,
    state: "finished" as const,
    daysAgo,
  });

  it("re-checks stale proven addresses of rested companies only", async () => {
    const restedFirm = await firm("rested.example", noReply("rested.example", 100));
    const staleVerified = await leadAt(restedFirm, "a@rested.example", "verified", "valid", 60);
    const catchAll = await leadAt(restedFirm, "b@rested.example", "imported", "catch_all", 60);
    await leadAt(restedFirm, "c@rested.example", "verified", "valid", 10); // still fresh
    await leadAt(restedFirm, "d@rested.example", "imported", "risky", 60); // never proven

    const resting = await firm("resting.example", noReply("resting.example", 30));
    await leadAt(resting, "a@resting.example", "verified", "valid", 60);
    const never = await firm("never.example");
    await leadAt(never, "a@never.example", "verified", "valid", 60);
    const optedOut = await firm("optout.example", {
      toEmail: "old@optout.example",
      stopReason: "opt_out",
      daysAgo: 400,
    });
    await leadAt(optedOut, "a@optout.example", "verified", "valid", 60);

    const verifier = new FakeVerifier({ authoritative: true });
    // Without the option nothing is due: every lead already has a verdict.
    expect((await runVerification(db(), verifier, { checker: checker() })).selected).toBe(0);

    const stats = await runVerification(db(), verifier, {
      checker: checker(),
      recheckReturning: { policy: DEFAULT_RECONTACT, olderThanMs: 45 * DAY },
    });
    expect(stats).toMatchObject({ selected: 2, valid: 2, aborted: null });
    const fresh = await db()
      .select({ leadId: verifications.leadId })
      .from(verifications)
      .where(sql`${verifications.checkedAt} > now() - interval '1 minute'`)
      .orderBy(asc(verifications.leadId));
    expect(fresh.map((v) => v.leadId)).toEqual([staleVerified.id, catchAll.id]);
  });

  it("the policy passed decides who has rested", async () => {
    const company = await firm("short.example", noReply("short.example", 40));
    const lead = await leadAt(company, "a@short.example", "verified", "valid", 60);
    const verifier = new FakeVerifier({ authoritative: true });
    const run = (policy: typeof DEFAULT_RECONTACT) =>
      runVerification(db(), verifier, {
        checker: checker(),
        recheckReturning: { policy, olderThanMs: 45 * DAY },
      });
    expect((await run(DEFAULT_RECONTACT)).selected).toBe(0);
    const stats = await run(recontactPolicy({ restDays: { no_reply: 30 } }));
    expect(stats.selected).toBe(1);
    const rows = await db()
      .select()
      .from(verifications)
      .where(eq(verifications.leadId, lead.id))
      .orderBy(asc(verifications.id));
    expect(rows).toHaveLength(2);
  });
});

describe("returning end to end", () => {
  it("a stale address blocks the return until the re-check refreshes it", async () => {
    const company = await makeCompany(db(), { domain: "stale.example" });
    const jane = await makePerson(db(), company, {
      email: "jane@stale.example",
      verifiedCheckedAt: new Date(Date.now() - 100 * DAY),
    });
    await pastEnrollment(company, {
      toEmail: "jane@stale.example",
      person: jane,
      state: "finished",
      daysAgo: 100,
    });
    const blocked = await returning();
    expect(blocked).toMatchObject({ enrolled: 0, skipped_no_address: 1 });

    const recheck = await runVerification(db(), new FakeVerifier({ authoritative: true }), {
      checker: new LocalChecker(async (name, rtype) => (rtype === "MX" ? [`10 mx.${name}.`] : [])),
      recheckReturning: { policy: DEFAULT_RECONTACT, olderThanMs: 45 * DAY },
    });
    expect(recheck).toMatchObject({ selected: 1, valid: 1 });

    const back = await returning();
    expect(back.enrolled_person).toBe(1);
    expect(await newEnrollments()).toEqual([
      expect.objectContaining({ toEmail: "jane@stale.example", contactRound: 2 }),
    ]);
  });

  it("reports split first contact from recycled", async () => {
    await rested("oak.example", 100);
    await returning();
    const funnel = (await db().execute(
      sql`SELECT sequence_name, recycled, enrolled::int AS enrolled FROM campaign_funnel ORDER BY sequence_name`,
    )) as unknown as { sequence_name: string; recycled: boolean; enrolled: number }[];
    expect(funnel.map((r) => [r.sequence_name, r.recycled, r.enrolled])).toEqual([
      [NEW_SEQ.name, true, 1],
      [SEQ.name, false, 1],
    ]);
    const outcomesRows = (await db().execute(
      sql`SELECT sequence_name, contact_round FROM enrollment_outcomes ORDER BY enrollment_id`,
    )) as unknown as { sequence_name: string; contact_round: number }[];
    expect(outcomesRows.map((r) => [r.sequence_name, r.contact_round])).toEqual([
      [SEQ.name, 1],
      [NEW_SEQ.name, 2],
    ]);
  });
});
