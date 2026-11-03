/** Stopping enrollments: unsent steps skipped, suppressions kept. A reply, a booking or a won race calls these. */
import type { Queryable } from "@wren/db";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { SharedSuppressions } from "../guards.js";
import {
  type Enrollment,
  enrollments,
  type Message,
  type MessageState,
  messages,
  type StopReason,
} from "../schema.js";
import { transitionEnrollment, transitionMessage } from "../state.js";
import { ensureSuppression } from "./suppress.js";

/** States a step can still be sent from — and the only states a stop may skip. */
export const LIVE = ["draft", "approved", "failed"] as const satisfies readonly MessageState[];
export const isLive = (state: MessageState) => (LIVE as readonly MessageState[]).includes(state);

export const messagesOf = (db: Queryable, enrollmentId: number): Promise<Message[]> =>
  db
    .select()
    .from(messages)
    .where(eq(messages.enrollmentId, enrollmentId))
    .orderBy(asc(messages.step));

/**
 * Stop one ACTIVE enrollment: every unsent step (draft, approved, or wedged
 * failed) becomes SKIPPED so nothing can send later. Returns the number of
 * steps skipped. Illegal on a finished/stopped enrollment.
 *
 * A SENDING or UNKNOWN step is deliberately NOT skipped: that mail may already
 * be on its way, and the enrollment being STOPPED means the walk never touches
 * it again either way.
 *
 * opt_out/complaint/bounce also get-or-create a Suppression for the
 * enrollment's to_email — the row compose/send actually gate on — with the
 * enrollment id, stop reason and detail as the event's evidence.
 */
export async function recordStop(
  db: Queryable,
  enrollment: Enrollment,
  reason: StopReason,
  opts: {
    detail?: string | null;
    now?: Date;
    messages?: Message[];
    shared?: SharedSuppressions | null;
  } = {},
): Promise<number> {
  const detail = opts.detail ?? null;
  await db
    .update(enrollments)
    .set({
      state: transitionEnrollment(enrollment.state, "stopped"),
      stopReason: reason,
      stoppedAt: opts.now ?? new Date(),
    })
    .where(eq(enrollments.id, enrollment.id));
  const msgs = opts.messages ?? (await messagesOf(db, enrollment.id));
  let skipped = 0;
  for (const message of msgs) {
    if (!isLive(message.state)) continue;
    message.state = transitionMessage(message.state, "skipped");
    message.detail = detail ?? `enrollment stopped: ${reason}`;
    await db
      .update(messages)
      .set({ state: message.state, detail: message.detail })
      .where(eq(messages.id, message.id));
    skipped += 1;
  }
  const first = msgs[0];
  if (first !== undefined) {
    await ensureSuppression(
      db,
      first.toEmail,
      reason,
      { enrollment_id: enrollment.id, stop_reason: reason, detail },
      opts.shared,
    );
  }
  return skipped;
}

/**
 * Company-scoped stop: a reply from anyone at the firm stops every active
 * enrollment into it. Returns enrollments stopped. Filters on
 * `enrollments.company_id`, pinned at compose — never through `people`.
 */
export async function stopCompany(
  db: Queryable,
  opts: {
    companyId: number;
    reason: StopReason;
    detail?: string | null;
    now?: Date;
    shared?: SharedSuppressions | null;
  },
): Promise<number> {
  const rows = await db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.companyId, opts.companyId), eq(enrollments.state, "active")))
    .orderBy(asc(enrollments.id));
  for (const enrollment of rows) {
    await recordStop(db, enrollment, opts.reason, {
      detail: opts.detail ?? null,
      ...(opts.now ? { now: opts.now } : {}),
      shared: opts.shared ?? null,
    });
  }
  return rows.length;
}

/**
 * A race won in a metro campaign: the person's active enrollments in it stop
 * (designs/2026-11-02-campaigns.md). Matched by address or people id; null is
 * the default campaign. Returns enrollments stopped.
 */
export async function stopCampaignEnrollments(
  db: Queryable,
  opts: {
    campaign: string | null;
    emails: readonly string[];
    persons: readonly number[];
    reason: StopReason;
    detail: string;
    now: Date;
  },
): Promise<number> {
  const who = [
    ...(opts.emails.length
      ? [
          inArray(
            sql`lower(${enrollments.toEmail})`,
            opts.emails.map((e) => e.toLowerCase()),
          ),
        ]
      : []),
    ...(opts.persons.length ? [inArray(enrollments.personId, [...opts.persons])] : []),
  ];
  if (!who.length) return 0;
  const rows = await db
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.state, "active"),
        opts.campaign === null
          ? isNull(enrollments.campaign)
          : eq(enrollments.campaign, opts.campaign),
        or(...who),
      ),
    )
    .orderBy(asc(enrollments.id));
  for (const enrollment of rows)
    await recordStop(db, enrollment, opts.reason, { detail: opts.detail, now: opts.now });
  return rows.length;
}
