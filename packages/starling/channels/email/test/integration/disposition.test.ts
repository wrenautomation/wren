/**
 * Phase C against the migrated schema: the disposition run labels only what
 * the gate grounds, never overwrites a human, never stops or suppresses, and
 * bills through `email_llm_calls` like every other stage.
 */
import { randomUUID } from "node:crypto";
import { runs, suppressions } from "@wren/core";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DISPOSITION_VERSION, pendingEvents, runDisposition } from "../../src/inbox/disposition.js";
import { classify, TEXT_MAX_CHARS } from "../../src/inbox/inbound.js";
import { labelEvent } from "../../src/inbox/sync.js";
import {
  type Enrollment,
  enrollments,
  messages,
  type ThreadEvent,
  threadEvents,
} from "../../src/schema.js";
import { transitionMessage } from "../../src/state.js";
import { emailLlmCalls, emailStageCosts, llmUsageByMonth } from "../../src/views.js";
import {
  makeCompany,
  makePerson,
  messagesOf,
  runCompose,
  SENDER,
  TABLES,
} from "./compose-fixtures.js";

const NOW = new Date(Date.UTC(2026, 8, 8, 12, 0));
const DAY = 86_400_000;
const OUR_ID = "<opener@wren-automation.test>";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, [...TABLES, "suppression_events"]));
const db = (): Db => pg.db;

async function enrollAndSend(
  domain = "oakbridge.example",
  email = `jane@${domain}`,
): Promise<Enrollment> {
  const company = await makeCompany(db(), { domain });
  await makePerson(db(), company, { email });
  await runCompose(db(), { autoApprove: true });
  const [enrollment] = await db()
    .select()
    .from(enrollments)
    .where(eq(enrollments.companyId, company.id));
  if (!enrollment) throw new Error("compose enrolled nobody");
  const [opener] = await messagesOf(db(), enrollment);
  if (!opener) throw new Error("no opener");
  const sent = transitionMessage(transitionMessage(opener.state, "sending"), "sent");
  await db()
    .update(messages)
    .set({
      messageId: `<${domain}@test>`,
      state: sent,
      attemptedAt: new Date(NOW.getTime() - DAY),
      transport: "test",
      sentAt: new Date(NOW.getTime() - DAY),
    })
    .where(eq(messages.id, opener.id));
  return enrollment;
}

async function reply(
  enrollment: Enrollment,
  text: string,
  opts: { gmailId: string; when?: Date; snippet?: string | null },
): Promise<ThreadEvent> {
  const [opener] = await messagesOf(db(), enrollment);
  const [event] = await db()
    .insert(threadEvents)
    .values({
      enrollmentId: enrollment.id,
      inReplyToMessageId: opener?.id ?? null,
      kind: "reply",
      gmailId: opts.gmailId,
      fromAddress: enrollment.toEmail,
      subject: "Re: Quick question, Jane",
      snippet: opts.snippet === undefined ? text.slice(0, 300) : opts.snippet,
      bodyText: text,
      receivedAt: opts.when ?? NOW,
    })
    .returning();
  if (!event) throw new Error("no event");
  return event;
}

const proposing = (proposal: Record<string, unknown>) =>
  new FakeLlm({ respond: () => JSON.stringify(proposal) });

async function reload(event: ThreadEvent): Promise<ThreadEvent> {
  const [row] = await db().select().from(threadEvents).where(eq(threadEvents.id, event.id));
  if (!row) throw new Error("event vanished");
  return row;
}
type Record_ = Record<string, unknown>;
const classification = (event: ThreadEvent) => event.classification as Record_;
const pendingIds = async (model: string, niche?: string) =>
  (await pendingEvents(db(), { model, niche: niche ?? null })).map((e) => e.id);

describe("the disposition run", () => {
  it("a grounded reply is labelled with source llm and nothing else moves", async () => {
    const enrollment = await enrollAndSend();
    const event = await reply(enrollment, "Sure, let's talk. Thursday works.", { gmailId: "g1" });
    const llm = proposing({ disposition: "interested", evidence: "let's talk", confidence: 0.9 });

    const stats = await runDisposition(db(), llm, { now: NOW });

    expect([stats.selected, stats.labelled, stats.ungrounded]).toEqual([1, 1, 0]);
    const after = await reload(event);
    expect(after.disposition).toBe("interested");
    expect(after.dispositionSource).toBe("llm");
    expect(after.classifiedAt).toEqual(NOW);
    const record = classification(after);
    expect(record.model).toBe("fake");
    expect(record.prompt_version).toBe(DISPOSITION_VERSION);
    expect((record.verdict as Record_).grounded).toBe(true);
    expect((record.proposal as Record_).evidence).toBe("let's talk");
    expect((record.call as Record_).provider).toBe("fake");
    const [row] = await db().select().from(enrollments).where(eq(enrollments.id, enrollment.id));
    expect(row?.state).toBe("active");
    expect(await db().select().from(suppressions)).toEqual([]);
  });

  it("an ungrounded proposal is recorded but leaves the event for the operator", async () => {
    const enrollment = await enrollAndSend();
    const event = await reply(enrollment, "Not for us, thanks.", { gmailId: "g1" });
    const llm = proposing({ disposition: "interested", evidence: "sounds great", confidence: 0.9 });

    const stats = await runDisposition(db(), llm, { now: NOW });

    expect([stats.labelled, stats.ungrounded]).toEqual([0, 1]);
    const after = await reload(event);
    expect(after.disposition).toBeNull();
    expect(after.dispositionSource).toBeNull();
    expect((classification(after).verdict as Record_).reason).toBe(
      "evidence quote is not in the reply",
    );
    expect(await pendingIds("fake")).toEqual([]);
    expect(await pendingIds("other-model")).toEqual([event.id]);
  });

  it("a parse failure is retried next run", async () => {
    const enrollment = await enrollAndSend();
    const event = await reply(enrollment, "Not for us, thanks.", { gmailId: "g1" });

    const first = await runDisposition(db(), new FakeLlm({ default: "no json here" }), {
      now: NOW,
    });
    expect(first.parse_errors).toBe(1);
    expect(classification(await reload(event)).parse_error).toBeTruthy();
    expect(await pendingIds("fake")).toEqual([event.id]);

    const second = await runDisposition(
      db(),
      proposing({ disposition: "not_interested", evidence: "not for us", confidence: 0.8 }),
      { now: NOW },
    );
    expect(second.labelled).toBe(1);
    const after = await reload(event);
    expect(after.disposition).toBe("not_interested");
    expect(classification(after).parse_error).toBeNull(); // the record is replaced, not appended
  });

  it("a human label is never overwritten and beats the LLM afterwards", async () => {
    const enrollment = await enrollAndSend();
    const labelled = await reply(enrollment, "Not for us.", { gmailId: "g1" });
    await labelEvent(db(), { event: labelled, disposition: "not_now", now: NOW });
    const pending = await reply(enrollment, "Not for us either.", {
      gmailId: "g2",
      when: new Date(NOW.getTime() + 60_000),
    });
    const llm = proposing({
      disposition: "not_interested",
      evidence: "not for us",
      confidence: 0.9,
    });

    const stats = await runDisposition(db(), llm, { now: NOW });

    expect(stats.selected).toBe(1);
    const human = await reload(labelled);
    expect([human.disposition, human.dispositionSource]).toEqual(["not_now", "operator"]);
    const machine = await reload(pending);
    expect([machine.disposition, machine.dispositionSource]).toEqual(["not_interested", "llm"]);

    await labelEvent(db(), { event: machine, disposition: "not_now", now: NOW });
    const corrected = await reload(pending);
    expect(corrected.dispositionSource).toBe("operator");
    expect((classification(corrected).verdict as Record_).disposition).toBe("not_interested"); // history kept
  });

  it("an operator who labels while the LLM is thinking keeps their reading", async () => {
    const enrollment = await enrollAndSend();
    const event = await reply(enrollment, "Yes, let's talk Thursday.", { gmailId: "g-race" });
    const labelBehindOurBack = async () => {
      await db()
        .update(threadEvents)
        .set({ disposition: "not_interested", dispositionSource: "operator", classifiedAt: NOW })
        .where(eq(threadEvents.id, event.id));
      return JSON.stringify({ disposition: "interested", evidence: "let's talk", confidence: 0.9 });
    };

    const stats = await runDisposition(db(), new FakeLlm({ respond: labelBehindOurBack }), {
      now: NOW,
    });

    expect(stats.labelled).toBe(0);
    expect(stats.skipped_labelled_meanwhile).toBe(1);
    const after = await reload(event);
    expect(after.disposition).toBe("not_interested");
    expect(after.dispositionSource).toBe("operator");
    expect((classification(after).verdict as Record_).grounded).toBe(true); // the record is still kept
    expect(await pendingIds("fake")).toEqual([]);
    const [call] = await db()
      .select({ appliedAt: emailLlmCalls.appliedAt })
      .from(emailLlmCalls)
      .where(eq(emailLlmCalls.threadEventId, event.id));
    expect(call?.appliedAt).toBeNull();
  });

  it("only human replies are read and a niche filter narrows the run", async () => {
    const ours = await enrollAndSend();
    const other = await enrollAndSend("elsewhere.example", "bob@elsewhere.example");
    await db()
      .update(enrollments)
      .set({ niche: "other_niche" })
      .where(eq(enrollments.id, other.id));
    await db().insert(threadEvents).values({
      enrollmentId: ours.id,
      kind: "auto_reply",
      gmailId: "ooo",
      snippet: "Out of office until Monday",
      receivedAt: NOW,
    });
    const g1 = await reply(ours, "Yes please.", { gmailId: "g1" });
    const g2 = await reply(other, "Yes please.", { gmailId: "g2" });

    expect(await pendingIds("fake", "sec_ria")).toEqual([g1.id]);
    expect(new Set(await pendingIds("fake"))).toEqual(new Set([g1.id, g2.id]));
  });

  it("the run bills through email_llm_calls and email_stage_costs like every stage", async () => {
    const enrollment = await enrollAndSend();
    const event = await reply(enrollment, "Sure, let's talk.", { gmailId: "g1" });
    await reply(enrollment, "", {
      gmailId: "g2",
      when: new Date(NOW.getTime() + 60_000),
      snippet: null,
    });
    const runId = randomUUID();
    await db()
      .insert(runs)
      .values({ id: runId, command: "outreach inbox classify", argv: {}, startedAt: NOW });
    const llm = proposing({ disposition: "interested", evidence: "let's talk", confidence: 0.9 });

    const stats = await runDisposition(db(), llm, { runId, now: NOW });

    expect([stats.labelled, stats.no_text]).toEqual([1, 1]);
    const rows = await db()
      .select()
      .from(emailLlmCalls)
      .where(eq(emailLlmCalls.kind, "reply_disposition"));
    expect(rows.length).toBe(1); // the empty reply bought nothing and is not a call
    const [row] = rows;
    expect(row?.threadEventId).toBe(event.id);
    expect(row?.enrichmentId).toBeNull();
    expect(row?.runId).toBe(runId);
    expect(row?.companyId).toBe(enrollment.companyId);
    expect(row?.model).toBe("fake");
    expect(row?.appliedAt).toEqual(NOW);
    const [costs] = await db()
      .select({ calls: emailStageCosts.calls, command: emailStageCosts.command })
      .from(emailStageCosts)
      .where(eq(emailStageCosts.kind, "reply_disposition"));
    expect(costs).toEqual({ calls: 1, command: "outreach inbox classify" });
    const month = await db()
      .select()
      .from(llmUsageByMonth)
      .where(eq(llmUsageByMonth.kind, "reply_disposition"));
    expect(month).toEqual([
      expect.objectContaining({
        month: expect.stringMatching(/^\d{4}-\d{2}-01$/),
        model: "fake",
        calls: 1,
        rejectedCalls: 0,
        parseFailures: 0,
      }),
    ]);
  });

  it("sync keeps the reply's own words, capped for the classifier", () => {
    const body = "Yes, interested. ".repeat(400); // well past the cap
    const raw = new TextEncoder().encode(
      `From: Jane <jane@oakbridge.example>\r\nTo: ${SENDER}\r\nSubject: Re: hi\r\n` +
        `In-Reply-To: ${OUR_ID}\r\nMessage-ID: <r1@oakbridge.example>\r\n` +
        `Content-Type: text/plain\r\n\r\n${body}\r\n\r\nOn Mon, William wrote:\r\n> hi\r\n`,
    );
    const inbound = classify(raw, { ourMessageIds: [OUR_ID] });
    expect(inbound.text).not.toBeNull();
    expect((inbound.text ?? "").length).toBeLessThanOrEqual(TEXT_MAX_CHARS);
    expect((inbound.text ?? "").length).toBeGreaterThan((inbound.snippet ?? "").length);
    expect(inbound.text).not.toContain("William wrote"); // quoted thread stripped
  });
});
