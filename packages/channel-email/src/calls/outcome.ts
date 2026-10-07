/**
 * A call's outcome, marked by a person once it's over (designs/2026-10-07-close-brief-outcome.md).
 * One write for every call: cal.com's and our own calendar's mirror alike. What it moves on the
 * spine is `outcomeEmits`: won queues onboarding, not yet goes back to keep warm after the
 * `close` wire's wait, a no-show is the row alone. Nothing here sends.
 */
import type { MeetingOutcome } from "@wren/core/calls";
import type { SpineEvent } from "@wren/core/spine";
import type { Queryable } from "@wren/db";
import { and, eq, inArray, isNotNull, lte, type SQL } from "drizzle-orm";
import { callBookings } from "../schema.js";

export interface MarkedCall {
  id: number;
  outcome: MeetingOutcome | null;
  reason: string | null;
  start: string | null;
  email: string | null;
  name: string | null;
  offer: string | null;
}

export interface OutcomeAsk {
  ids: readonly number[];
  /** null takes it back. */
  outcome: MeetingOutcome | null;
  reason?: string | null;
  by: string;
  now: Date;
}

/**
 * Mark booked calls that have started. A cancelled call or one still ahead is skipped; the
 * answer is the calls it changed. Run it inside the caller's `atomic`.
 */
export async function setCallOutcome(db: Queryable, o: OutcomeAsk): Promise<MarkedCall[]> {
  if (!o.ids.length) return [];
  const clearing = o.outcome === null;
  const where: SQL[] = [inArray(callBookings.id, [...o.ids]), eq(callBookings.state, "booked")];
  // Taking one back needs no start check; marking one does: nobody no-shows ahead of time.
  if (!clearing) where.push(isNotNull(callBookings.start), lte(callBookings.start, o.now));
  const reason = clearing ? null : o.reason?.trim().slice(0, 500) || null;
  const rows = await db
    .update(callBookings)
    .set({
      outcome: o.outcome,
      outcomeReason: reason,
      outcomeAt: clearing ? null : o.now,
      outcomeBy: clearing ? null : o.by,
      updatedAt: o.now,
    })
    .where(and(...where))
    .returning();
  return rows.map((r) => ({
    id: r.id,
    outcome: r.outcome,
    reason: r.outcomeReason,
    start: r.start?.toISOString() ?? null,
    email: r.email,
    name: r.name,
    offer: r.offer,
  }));
}

/** The subject every event about one call carries. */
export const callSubject = (id: number) => `call:${id}`;

export interface OutcomeEmit {
  workflow: string;
  from: string;
  events: SpineEvent[];
}

/**
 * What each marked call sends on the spine. Won leaves `close` and enters `onboarding`, whose
 * contract has no step yet, so it waits there. Not yet leaves `close` by `later`, whose wire
 * waits 30 days into keep warm. A no-show or a clear moves nothing.
 */
export function outcomeEmits(marked: readonly MarkedCall[]): OutcomeEmit[] {
  const out: OutcomeEmit[] = [];
  const eventOf = (m: MarkedCall, kind: SpineEvent["kind"]): SpineEvent => ({
    subject: callSubject(m.id),
    kind,
    data: {
      call: m.id,
      outcome: m.outcome,
      reason: m.reason,
      start: m.start,
      name: m.name,
      email: m.email,
      offer: m.offer,
    },
  });
  const won = marked.filter((m) => m.outcome === "won");
  const later = marked.filter((m) => m.outcome === "not_yet");
  if (won.length) {
    out.push({
      workflow: "close",
      from: "outcome.won",
      events: won.map((m) => eventOf(m, "client")),
    });
    out.push({
      workflow: "onboarding",
      from: "in.clients",
      events: won.map((m) => eventOf(m, "client")),
    });
  }
  if (later.length)
    out.push({
      workflow: "close",
      from: "outcome.later",
      events: later.map((m) => eventOf(m, "lead")),
    });
  return out;
}
