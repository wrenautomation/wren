/**
 * The answer to a warm reply: code drafts it, William approves it, it goes out in the thread.
 *
 *     warm reply ─→ draftReply: the arm's `reply` copy as a draft message
 *                     └─→ William: approve (as drafted or in his words) | drop
 *                           └─→ sendReply: in the thread, from the thread's inbox, now
 *
 * The arm is the folder of the sequence's first template ("book-first/opener" is
 * "book-first"); its copy is `<arm>/reply`. An arm with no such file, or copy whose facts
 * are missing, drafts nothing and William writes the answer. Nothing here sends on its
 * own: replies are unpredictable, so every one waits for a person's yes (William, 10-02).
 */
import { randomUUID } from "node:crypto";
import { MissingFactError, render, type Template } from "@wren/core/slots";
import { type Db, type Queryable, serializable } from "@wren/db";
import { and, asc, eq, max } from "drizzle-orm";
import { linkFacts, mintLinkCode, signed } from "../outreach/compose.js";
import { factsFor, factsForCompany } from "../outreach/facts.js";
import type { Filler } from "../outreach/fills.js";
import type { Sequence } from "../outreach/sequences.js";
import { type Enrollment, type Message, messages, type ThreadEvent } from "../schema.js";
import type { Fleet } from "../send/tick.js";
import {
  carrierOf,
  fillPage,
  type OutgoingEmail,
  type Transport,
  TransportAmbiguous,
  TransportRefused,
} from "../send/transport.js";
import { transitionMessage } from "../state.js";

/** What a niche's campaign knows that a reply needs; a compose `Campaign` is one. */
export interface ReplyCopy {
  readonly sequences: ReadonlyMap<string, Sequence>;
  readonly offerFacts: ReadonlyMap<string, Readonly<Record<string, string>>>;
  readonly site?: string | null;
  readonly templates: ReadonlyMap<string, Template>;
  readonly factsView: string | null;
  /** Plain sign-off per sender, page slot already filled. */
  readonly signatures: Readonly<Record<string, string>>;
  /** Casual names and prompt slots by a model, as compose had them. */
  readonly fill?: Filler;
}

/** `<arm>/reply` for the enrollment's sequence, or null when the arm has none. */
export function replyTemplate(copy: ReplyCopy, enrollment: Enrollment): Template | null {
  const first = copy.sequences.get(enrollment.sequenceName)?.steps[0]?.template;
  if (!first?.includes("/")) return null;
  return copy.templates.get(`${first.slice(0, first.lastIndexOf("/"))}/reply`) ?? null;
}

/**
 * Draft the arm's reply on the thread as the enrollment's next step, never approved.
 * `extra` adds facts only the moment knows (`call.booked`). null: no copy, or a fact
 * the copy needs is missing; William writes that one.
 */
export async function draftReply(
  db: Queryable,
  copy: ReplyCopy,
  enrollment: Enrollment,
  event: ThreadEvent,
  extra: Readonly<Record<string, string>> = {},
): Promise<Message | null> {
  const tpl = replyTemplate(copy, enrollment);
  if (tpl === null) return null;
  const filed = enrollment.personId
    ? await factsFor(db, enrollment.personId, copy.factsView)
    : await factsForCompany(db, enrollment.companyId, copy.factsView);
  const facts = copy.fill ? await copy.fill.fill(filed, [tpl]) : filed;
  const offerFacts = copy.offerFacts.get(enrollment.offer) ?? {};
  const code = mintLinkCode();
  let rendered: ReturnType<typeof render>;
  try {
    rendered = render(
      tpl,
      {
        ...facts.values,
        ...offerFacts,
        ...linkFacts(copy.site ?? null, enrollment.offer, facts.values, offerFacts, code),
        ...extra,
      },
      enrollment.personId ? `person:${enrollment.personId}` : `company:${enrollment.companyId}`,
    );
  } catch (err) {
    if (err instanceof MissingFactError) return null;
    throw err;
  }
  const [last] = await db
    .select({ step: max(messages.step) })
    .from(messages)
    .where(eq(messages.enrollmentId, enrollment.id));
  const [row] = await db
    .insert(messages)
    .values({
      enrollmentId: enrollment.id,
      step: (last?.step ?? -1) + 1,
      template: tpl.name,
      templateVersion: rendered.provenance.version,
      toEmail: event.fromAddress ?? enrollment.toEmail,
      subject: null,
      body: signed(rendered.body, copy.signatures[enrollment.sender] ?? ""),
      provenance: { ...rendered.provenance, reply_to_event: event.id },
      state: "draft",
      linkCode: code,
    })
    .returning();
  if (!row) throw new Error(`reply draft for enrollment ${enrollment.id} was not written`);
  return row;
}

/** The template name a reply William wrote himself is filed under. */
export const BY_HAND = "by-hand/reply";

/** William's own words as the thread's next step, a draft for `sendReply`. */
export async function draftByHand(
  db: Queryable,
  enrollment: Enrollment,
  event: ThreadEvent,
  body: string,
): Promise<Message> {
  const [last] = await db
    .select({ step: max(messages.step) })
    .from(messages)
    .where(eq(messages.enrollmentId, enrollment.id));
  const [row] = await db
    .insert(messages)
    .values({
      enrollmentId: enrollment.id,
      step: (last?.step ?? -1) + 1,
      template: BY_HAND,
      templateVersion: "by-hand",
      toEmail: event.fromAddress ?? enrollment.toEmail,
      subject: null,
      body,
      provenance: { by_hand: true, reply_to_event: event.id },
      state: "draft",
    })
    .returning();
  if (!row) throw new Error(`reply for enrollment ${enrollment.id} was not written`);
  return row;
}

export interface SendReplyOptions {
  transport: Transport;
  /** Display names and rich sign-offs per inbox. */
  fleet: Pick<Fleet, "fromNames" | "signatureHtml" | "pages">;
  now?: Date;
}

export type ReplyOutcome =
  | { sent: true; message: Message }
  | { sent: false; message: Message; reason: string };

/**
 * Approve and send one drafted reply in its thread: In-Reply-To their email, the
 * thread's References, the inbox's own Gmail thread. `body` replaces the draft's
 * words with William's. The row is SENDING with our Message-ID before the bytes
 * leave, as every send is; a lost answer is UNKNOWN for reconcile, never re-sent.
 */
export async function sendReply(
  db: Db,
  messageId: number,
  event: ThreadEvent,
  enrollment: Enrollment,
  opts: SendReplyOptions & { body?: string | null },
): Promise<ReplyOutcome> {
  const now = opts.now ?? new Date();
  const sender = enrollment.sender;
  const ourId = `<${randomUUID().replaceAll("-", "")}@${sender.slice(sender.lastIndexOf("@") + 1)}>`;
  const sending = await serializable(db, async (tx) => {
    const [draft] = await tx
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .for("update");
    if (!draft) throw new Error(`no message ${messageId}`);
    if (draft.state !== "draft")
      throw new Error(`message ${messageId} is ${draft.state}, not draft`);
    const [row] = await tx
      .update(messages)
      .set({
        ...(opts.body ? { body: opts.body, editedAt: now } : {}),
        state: transitionMessage(transitionMessage(draft.state, "approved"), "sending"),
        approvedAt: now,
        approvedBy: "operator",
        messageId: ourId,
        attemptedAt: now,
        transport: carrierOf(opts.transport, sender).name,
      })
      .where(eq(messages.id, messageId))
      .returning();
    return row as Message;
  });

  const thread = await db
    .select()
    .from(messages)
    .where(and(eq(messages.enrollmentId, enrollment.id), eq(messages.state, "sent")))
    .orderBy(asc(messages.step));
  // The email they answered, else the last one we sent.
  const anchor =
    thread.find((m) => m.id === event.inReplyToMessageId) ?? thread[thread.length - 1] ?? null;
  const theirs = (event.headers as Record<string, string> | null)?.["Message-ID"] ?? null;
  const html = opts.fleet.signatureHtml[sender];
  const outgoing: OutgoingEmail = {
    fromAddress: sender,
    fromName: opts.fleet.fromNames[sender] ?? null,
    to: sending.toEmail,
    subject: null,
    replySubject: anchor?.subject ?? thread.find((m) => m.subject)?.subject ?? null,
    body: sending.body,
    messageId: ourId,
    inReplyTo: theirs ?? anchor?.messageId ?? null,
    references: [
      ...thread.flatMap((m) => (m.messageId ? [m.messageId] : [])),
      ...(theirs ? [theirs] : []),
    ],
    threadId: event.gmailThreadId ?? anchor?.threadId ?? null,
    signatureHtml:
      html === undefined ? null : fillPage(html, opts.fleet.pages[enrollment.niche] ?? ""),
    linkCode: sending.linkCode,
  };

  let patch: Partial<Message>;
  let reason: string | null = null;
  try {
    const receipt = await opts.transport.send(outgoing);
    patch = {
      state: transitionMessage(sending.state, "sent"),
      sentAt: now,
      gmailId: receipt.providerId,
      threadId: receipt.threadId,
    };
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
    // Refused never left; anything else may have, so only reconcile may say.
    const next = err instanceof TransportRefused ? "failed" : "unknown";
    patch = {
      state: transitionMessage(sending.state, next),
      detail:
        err instanceof TransportRefused || err instanceof TransportAmbiguous
          ? reason
          : `unexpected: ${reason}`,
    };
  }
  const [final] = await db
    .update(messages)
    .set(patch)
    .where(eq(messages.id, messageId))
    .returning();
  const message = final ?? { ...sending, ...patch };
  return reason === null ? { sent: true, message } : { sent: false, message, reason };
}
