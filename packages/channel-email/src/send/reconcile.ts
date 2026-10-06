/**
 * Reconcile: ask the mailbox what actually happened to an in-flight send.
 *
 * UNKNOWN is the honest answer to a lost response; SENDING found by a fresh
 * process means the previous one died between committing its intent and
 * recording the outcome. In both cases the only authority is the sending
 * mailbox and the only key that survives is the Message-ID we minted before the
 * send. Found → SENT with the provider's handles. Not found and older than the
 * grace → FAILED, re-armable. Not found inside the grace → left alone: the
 * mailbox's own index takes a moment. A `find()` that throws is never a
 * verdict: the row is untouched and the tick reports an error.
 *
 * Only the transport that made the attempt may answer for it: a row whose
 * `transport` is not this one is counted `transport_mismatch` and left alone.
 */
import type { Db } from "@wren/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { enrollments, type Message, messages } from "../schema.js";
import { transitionMessage } from "../state.js";
import type { SendPolicy } from "./policy.js";
import { carrierOf, type Transport } from "./transport.js";

export const IN_FLIGHT = ["sending", "unknown"] as const;

export interface ReconcileStats {
  reconciled_sent: number;
  reconciled_failed: number;
  pending: number;
  errors: number;
  transport_mismatch: number;
}

function appendDetail(detail: string | null, note: string): string {
  return detail ? `${detail}; ${note}` : note;
}

/**
 * Resolve every SENDING/UNKNOWN message against its sender's mailbox. Each
 * verdict is its own transaction, so a long reconcile survives a crash with
 * everything it already decided.
 */
export async function reconcile(
  db: Db,
  opts: {
    transport: Transport;
    policy: SendPolicy;
    now: Date;
    onSent?: (enrollmentId: number, step: number) => void;
  },
): Promise<ReconcileStats> {
  const { transport, policy, now } = opts;
  const stats: ReconcileStats = {
    reconciled_sent: 0,
    reconciled_failed: 0,
    pending: 0,
    errors: 0,
    transport_mismatch: 0,
  };
  const rows = await db
    .select({ message: messages, sender: enrollments.sender })
    .from(messages)
    .innerJoin(enrollments, eq(enrollments.id, messages.enrollmentId))
    .where(inArray(messages.state, [...IN_FLIGHT]))
    .orderBy(asc(messages.id));
  for (const { message, sender } of rows) {
    if (message.transport !== carrierOf(transport, sender).name) {
      stats.transport_mismatch += 1;
      continue;
    }
    if (message.messageId === null) {
      // Unreachable under the schema CHECK; never guess for a row without our key.
      stats.pending += 1;
      continue;
    }
    const attempted = message.attemptedAt;
    let receipt: Awaited<ReturnType<Transport["find"]>>;
    try {
      receipt = await transport.find(sender, message.messageId);
    } catch {
      stats.errors += 1;
      continue;
    }
    let patch: Partial<Message>;
    if (receipt !== null) {
      patch = {
        state: transitionMessage(message.state, "sent"),
        sentAt: receipt.internalDate ?? attempted ?? now,
        gmailId: receipt.providerId,
        threadId: receipt.threadId,
        detail: appendDetail(message.detail, "reconciled: found in mailbox"),
      };
      stats.reconciled_sent += 1;
    } else if (
      attempted !== null &&
      now.getTime() - attempted.getTime() > policy.reconcileGraceMs
    ) {
      const minutes = Math.floor((now.getTime() - attempted.getTime()) / 60_000);
      patch = {
        state: transitionMessage(message.state, "failed"),
        detail: `not found in mailbox ${minutes} min after the attempt (reconcile)`,
      };
      stats.reconciled_failed += 1;
    } else {
      stats.pending += 1;
      continue;
    }
    await db
      .update(messages)
      .set(patch)
      .where(and(eq(messages.id, message.id), inArray(messages.state, [...IN_FLIGHT])));
    if (receipt !== null) opts.onSent?.(message.enrollmentId, message.step);
  }
  return stats;
}
