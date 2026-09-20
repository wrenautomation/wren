/**
 * Review by hand: drafts listed with how each address was come by, approve (the
 * exact stored text becomes sendable), reject with a fixed reason vocabulary (the
 * earliest copy signal there is), edit with the original pinned as data, stop.
 * Every write is a one-row fact on messages/enrollments; the CLI wraps these.
 */
import { IllegalTransition } from "@wren/core";
import type { Queryable } from "@wren/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  type Enrollment,
  enrollments,
  type Message,
  messages,
  type RejectReason,
  type StopReason,
} from "../schema.js";
import { recordStop, stopCompany } from "../send/deliver.js";
import { ensureSuppression } from "../send/suppress.js";
import { transitionMessage } from "../state.js";
import { describeAddress } from "./provenance.js";

const DUPLICATE_KEY = "possible_duplicate_company";

export interface DraftRow {
  id: number;
  enrollmentId: number;
  step: number;
  to: string;
  /** Evidence tier and verification verdict compose pinned, one short line. */
  addressVia: string;
  template: string;
  /** Compose's cross-domain duplicate warning: the other firm's domain or id, or "". */
  duplicate: string;
  subject: string | null;
  firstLine: string;
}

/** Drafts awaiting review, in enrollment/step order; `flagged` keeps only duplicate warnings. */
export async function listDrafts(
  db: Queryable,
  opts: { enrollmentId?: number; flagged?: boolean } = {},
): Promise<DraftRow[]> {
  const where = [eq(messages.state, "draft")];
  if (opts.enrollmentId !== undefined) where.push(eq(messages.enrollmentId, opts.enrollmentId));
  if (opts.flagged) where.push(sql`${messages.provenance} ? ${DUPLICATE_KEY}`);
  const rows = await db
    .select()
    .from(messages)
    .where(and(...where))
    .orderBy(asc(messages.enrollmentId), asc(messages.step));
  return rows.map((m) => {
    const provenance = m.provenance as Record<string, unknown>;
    const duplicate = provenance[DUPLICATE_KEY] as Record<string, unknown> | undefined;
    return {
      id: m.id,
      enrollmentId: m.enrollmentId,
      step: m.step,
      to: m.toEmail,
      addressVia: describeAddress(provenance.address as Record<string, unknown> | undefined, {
        brief: true,
      }),
      template: m.template,
      duplicate: duplicate ? String(duplicate.domain ?? duplicate.company_id ?? "") : "",
      subject: m.subject,
      firstLine: (m.body.split("\n")[0] ?? "").slice(0, 60),
    };
  });
}

export type ApproveSelector = { ids: number[] } | { enrollmentId: number } | { all: true };

export interface ApproveResult {
  approved: number;
  /** Messages on an enrollment that is no longer active: history, not a queue. */
  refused: number;
  notices: string[];
}

/**
 * Approve drafts. Explicit ids may also re-arm a FAILED message (a transient transport
 * error must never wedge an enrollment); `all` and `enrollmentId` stay draft-only, so a
 * failure is only ever retried by someone choosing it. A message whose enrollment is
 * not active is refused: stopping is a promise, and the send tick would never walk it.
 */
export async function approveMessages(
  db: Queryable,
  selector: ApproveSelector,
  now: Date = new Date(),
): Promise<ApproveResult> {
  const byIds = "ids" in selector;
  const eligible: readonly Message["state"][] = byIds ? ["draft", "failed"] : ["draft"];
  const where = byIds
    ? inArray(messages.id, selector.ids)
    : "enrollmentId" in selector
      ? and(eq(messages.state, "draft"), eq(messages.enrollmentId, selector.enrollmentId))
      : eq(messages.state, "draft");
  const rows = await db
    .select({ message: messages, enrollment: enrollments })
    .from(messages)
    .innerJoin(enrollments, eq(enrollments.id, messages.enrollmentId))
    .where(where)
    .orderBy(asc(messages.id));
  if (byIds) {
    const missing = selector.ids.filter((id) => !rows.some((r) => r.message.id === id));
    if (missing.length > 0) throw new Error(`no such messages: ${JSON.stringify(missing)}`);
  }
  const result: ApproveResult = { approved: 0, refused: 0, notices: [] };
  for (const { message, enrollment } of rows) {
    if (!eligible.includes(message.state)) {
      result.notices.push(`message ${message.id} is ${message.state}`);
      continue;
    }
    if (enrollment.state !== "active") {
      result.notices.push(
        `message ${message.id} belongs to enrollment ${enrollment.id}, which is ${enrollment.state} — that conversation is over; approving a step of it would arm a message nothing will ever send`,
      );
      result.refused += 1;
      continue;
    }
    await db
      .update(messages)
      .set({
        state: transitionMessage(message.state, "approved"),
        approvedAt: now,
        approvedBy: "operator", // a review, countable
      })
      .where(eq(messages.id, message.id));
    result.approved += 1;
  }
  return result;
}

/**
 * Strike drafts or approved messages; later steps are unaffected. The reason is a
 * fixed vocabulary so `rejections_by_reason` reads per template version.
 */
export async function rejectMessages(
  db: Queryable,
  ids: number[],
  reason: RejectReason,
  note: string | null = null,
): Promise<number> {
  const rows = await db.select().from(messages).where(inArray(messages.id, ids));
  const missing = ids.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length > 0) throw new Error(`no such messages: ${JSON.stringify(missing)}`);
  for (const message of rows) {
    let next: Message["state"];
    try {
      next = transitionMessage(message.state, "rejected");
    } catch (err) {
      if (err instanceof IllegalTransition)
        throw new Error(`message ${message.id} is ${message.state} — cannot reject`);
      throw err;
    }
    await db
      .update(messages)
      .set({ state: next, reviewReason: reason, detail: note ?? `rejected by operator: ${reason}` })
      .where(eq(messages.id, message.id));
  }
  return rows.length;
}

const SUBJECT_LINE = "Subject: ";

/** A draft as one editable document: Subject line, blank line, body. A thread-rider is just the body. */
export function editableText(subject: string | null, body: string): string {
  return subject === null ? body : `${SUBJECT_LINE}${subject}\n\n${body}`;
}

/** The inverse of `editableText`, strict so a deleted Subject line is an error, not a subjectless send. */
export function parseEditable(
  text: string,
  opts: { riding: boolean },
): { subject: string | null; body: string } {
  if (opts.riding) return { subject: null, body: text.replace(/\n+$/, "") };
  const at = text.indexOf("\n\n");
  const head = at < 0 ? text : text.slice(0, at);
  if (!head.startsWith(SUBJECT_LINE) || at < 0)
    throw new Error("the first line must be 'Subject: …' followed by a blank line, then the body");
  const subject = head.slice(SUBJECT_LINE.length).trim();
  if (!subject) throw new Error("the subject is empty");
  return { subject, body: text.slice(at + 2).replace(/\n+$/, "") };
}

/**
 * Change a draft's copy; the original is pinned under `provenance.review.original` on the
 * first edit and every edit bumps the count, so `review_outcomes` can say how often a
 * version needed a hand. Only a draft: an approved message's text is what was approved.
 * Returns the edit number, or null when nothing changed.
 */
export async function editMessage(
  db: Queryable,
  id: number,
  edited: { subject: string | null; body: string },
  now: Date = new Date(),
): Promise<number | null> {
  const [message] = await db.select().from(messages).where(eq(messages.id, id));
  if (!message) throw new Error(`no message ${id}`);
  if (message.state !== "draft") {
    throw new Error(
      `message ${id} is ${message.state} — only a draft is editable (reject it and recompose, or edit before approving)`,
    );
  }
  if (edited.subject === message.subject && edited.body === message.body) return null;
  const provenance = message.provenance as Record<string, unknown>;
  const review = { ...((provenance.review as Record<string, unknown> | undefined) ?? {}) };
  review.original ??= { subject: message.subject, body: message.body };
  review.edits = Number(review.edits ?? 0) + 1;
  await db
    .update(messages)
    .set({
      provenance: { ...provenance, review },
      subject: edited.subject,
      body: edited.body,
      editedAt: now,
    })
    .where(eq(messages.id, id));
  return review.edits as number;
}

export interface StopOutcome {
  /** What happened, in one line for the operator. */
  summary: string;
}

/**
 * Record a stop by hand. An active enrollment stops and its unsent steps are skipped.
 * A finished one can still take a real post-sequence opt-out/complaint/bounce: the
 * suppression is written, the enrollment's state stands. A company-wide stop takes
 * every active enrollment at the domain.
 */
export async function stopByHand(
  db: Queryable,
  target: { enrollmentId: number } | { companyDomain: string },
  reason: StopReason,
  detail: string | null = null,
  now: Date = new Date(),
): Promise<StopOutcome> {
  if ("companyDomain" in target) {
    const [company] = (await db.execute(
      sql`SELECT id FROM companies WHERE domain = ${target.companyDomain}`,
    )) as unknown as { id: number }[];
    if (!company) throw new Error(`no company with domain ${JSON.stringify(target.companyDomain)}`);
    const stopped = await stopCompany(db, { companyId: company.id, reason, detail, now });
    return { summary: `stopped ${stopped} enrollment(s) at ${target.companyDomain}` };
  }
  const [row] = await db.select().from(enrollments).where(eq(enrollments.id, target.enrollmentId));
  if (!row) throw new Error(`no enrollment ${target.enrollmentId}`);
  return stopOne(db, row, reason, detail, now);
}

async function stopOne(
  db: Queryable,
  row: Enrollment,
  reason: StopReason,
  detail: string | null,
  now: Date,
): Promise<StopOutcome> {
  if (row.state === "active") {
    const skipped = await recordStop(db, row, reason, { detail, now });
    return { summary: `stopped enrollment ${row.id} (${reason}), skipped ${skipped} step(s)` };
  }
  if (row.state !== "finished") throw new Error(`enrollment ${row.id} is already ${row.state}`);
  const [first] = await db
    .select({ toEmail: messages.toEmail })
    .from(messages)
    .where(eq(messages.enrollmentId, row.id))
    .orderBy(asc(messages.step))
    .limit(1);
  if (!first) throw new Error(`enrollment ${row.id} has no messages — nothing to record`);
  const suppression = await ensureSuppression(db, first.toEmail, reason, {
    enrollment_id: row.id,
    stop_reason: reason,
    detail,
  });
  return {
    summary: suppression
      ? `enrollment ${row.id} already finished — its state did not change, but recorded a suppression (${reason})`
      : `enrollment ${row.id} already finished — a ${reason} after the sequence is recorded through the inbox; nothing to do here`,
  };
}
