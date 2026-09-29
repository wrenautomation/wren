/**
 * Replies go to the client (R13). A handoff row is one reply passed to a
 * recruiter: who it went to, the Message-ID of the forward, and whether a
 * meeting came of it. A meeting booked is the billing unit, and only a person
 * marks it: the recruiter in the portal, or us.
 */
import { randomUUID } from "node:crypto";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { REACTIVATION } from "./compose.js";
import { type ClientProfile, handoffs } from "./schema.js";

export class HandoffRefusal extends Error {
  /** Not found, or not this viewer's to change. */
  constructor(
    message: string,
    readonly kind: "missing" | "forbidden" = "missing",
  ) {
    super(message);
  }
}

/** Our Message-ID for a forward, minted before it is sent, on the sender's domain. */
export const forwardMessageId = (sender: string) =>
  `<${randomUUID().replaceAll("-", "")}@${sender.slice(sender.lastIndexOf("@") + 1)}>`;

/**
 * Who a reply goes to: the recruiter the composer wrote as, else the firm's
 * default, else its first recruiter; never the mailbox that sent it (one in a
 * recruiter's own name). The sender back means nobody to send to yet.
 */
export function handoffRecruiter(
  wroteAs: string | null,
  profile: Pick<ClientProfile, "recruiters" | "defaultRecruiter"> | null,
  sender: string,
): string {
  const self = sender.toLowerCase();
  const candidates = [
    wroteAs,
    profile?.defaultRecruiter,
    ...(profile?.recruiters ?? []).map((r) => r.email),
  ];
  return candidates.find((c) => c && c.toLowerCase() !== self) ?? sender;
}

export interface ReplyRef {
  threadEventId: number;
  enrollmentId: number;
  personId: number | null;
  sender: string;
  /** The recruiter the composer wrote as (the opener's provenance). */
  wroteAs: string | null;
}

/** One reply to a reactivation email; null when the id names nothing of ours. */
export async function replyRef(db: Queryable, threadEventId: number): Promise<ReplyRef | null> {
  const [r] = await db.execute<{
    id: number;
    enrollment_id: number;
    person_id: number | null;
    sender: string;
    wrote_as: string | null;
  }>(sql`
    SELECT t.id, t.enrollment_id, e.person_id, e.sender,
      (SELECT m.provenance->>'recruiter' FROM messages m
        WHERE m.enrollment_id = e.id ORDER BY m.step LIMIT 1) AS wrote_as
    FROM thread_events t JOIN enrollments e ON e.id = t.enrollment_id
    WHERE t.id = ${threadEventId} AND t.kind = 'reply' AND e.niche = ${REACTIVATION}`);
  return r
    ? {
        threadEventId: Number(r.id),
        enrollmentId: Number(r.enrollment_id),
        personId: r.person_id === null ? null : Number(r.person_id),
        sender: r.sender,
        wroteAs: r.wrote_as,
      }
    : null;
}

/** The reply's handoff row, made if it has none; a new one is forwarded by the next handoff pass. */
export async function ensureHandoff(
  db: Queryable,
  reply: ReplyRef,
  profile: Pick<ClientProfile, "recruiters" | "defaultRecruiter"> | null,
): Promise<void> {
  await db
    .insert(handoffs)
    .values({
      threadEventId: reply.threadEventId,
      enrollmentId: reply.enrollmentId,
      personId: reply.personId,
      recruiterEmail: handoffRecruiter(reply.wroteAs, profile, reply.sender),
      forwardMessageId: forwardMessageId(reply.sender),
    })
    .onConflictDoNothing({ target: handoffs.threadEventId });
}

export interface Booking {
  threadEventId: number;
  /** false takes a mark back (a mistake). */
  booked: boolean;
  /** A portal login's email, or `operator`. */
  by: string;
  /**
   * Wren's side: may take back anyone's mark. A client login takes back only its
   * own, since each mark is a meeting billed.
   */
  operator?: boolean;
}

/**
 * Mark a reply as a meeting booked, or take the mark back. Marking twice keeps
 * the first time and who marked it.
 */
export async function markMeetingBooked(
  db: Queryable,
  booking: Booking,
  profile: Pick<ClientProfile, "recruiters" | "defaultRecruiter"> | null,
  now: Date = new Date(),
): Promise<{ bookedAt: Date | null; by: string | null }> {
  const by = booking.by.trim().toLowerCase();
  if (!by) throw new HandoffRefusal("say who marked it");
  return db.transaction(async (tx) => {
    const reply = await replyRef(tx, booking.threadEventId);
    if (!reply) throw new HandoffRefusal("no such reply");
    if (booking.booked) await ensureHandoff(tx, reply, profile);
    else if (!(booking.operator ?? by === "operator")) {
      const [mark] = await tx.execute<{ booked_by: string | null }>(sql`
        SELECT booked_by FROM handoffs WHERE thread_event_id = ${reply.threadEventId}`);
      const markedBy = mark?.booked_by ?? null;
      if (markedBy !== null && markedBy !== by) {
        throw new HandoffRefusal(
          `only ${markedBy} or Wren can take this booking back`,
          "forbidden",
        );
      }
    }
    const [row] = await tx.execute<{
      meeting_booked_at: Date | string | null;
      booked_by: string | null;
    }>(
      booking.booked
        ? sql`UPDATE handoffs SET meeting_booked_at = coalesce(meeting_booked_at, ${now.toISOString()}::timestamptz),
                booked_by = coalesce(booked_by, ${by})
              WHERE thread_event_id = ${reply.threadEventId}
              RETURNING meeting_booked_at, booked_by`
        : sql`UPDATE handoffs SET meeting_booked_at = null, booked_by = null
              WHERE thread_event_id = ${reply.threadEventId}
              RETURNING meeting_booked_at, booked_by`,
    );
    const at = row?.meeting_booked_at ?? null;
    return { bookedAt: at === null ? null : new Date(at), by: row?.booked_by ?? null };
  });
}

/** What the client owes (R18): the setup fee, plus each meeting up to the cap on meeting fees. */
export function billOf(
  meetings: number,
  offer: { upfront: number; perMeeting: number; cap: number },
): {
  meetings: number;
  upfront: number;
  perMeeting: number;
  cap: number;
  meetingFees: number;
  total: number;
} {
  const meetingFees = Math.min(meetings * offer.perMeeting, offer.cap);
  return { meetings, ...offer, meetingFees, total: offer.upfront + meetingFees };
}
