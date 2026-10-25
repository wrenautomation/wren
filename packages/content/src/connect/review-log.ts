/**
 * The access review log (designs/2026-10-23-access-reviews.md): each step a person or an agent
 * records moves the review's state and is kept. One write path: `logReview`.
 */
import { atomic, type Db } from "@wren/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { reviewOf } from "./app-reviews.js";
import {
  type AccessReviewEventRow,
  type AccessReviewRow,
  accessReviewEvents,
  accessReviews,
  type ReviewEvent,
  type ReviewState,
} from "./reviews-schema.js";

const DAY = 86_400_000;
/** A filed review is looked at again after this long, unless the step says otherwise. */
export const RECHECK_DAYS = 7;

/** The state a step leaves. `note` and `checked` keep it. */
export function stateAfter(state: ReviewState, event: ReviewEvent): ReviewState {
  switch (event) {
    case "filed":
    case "answered":
      return "filed";
    case "more_info":
    case "refused":
    case "passed":
    case "withdrawn":
      return event;
    default:
      return state;
  }
}

interface ReviewStep {
  client: string;
  kind: string;
  event: ReviewEvent;
  by: string;
  note?: string | null;
  ticket?: string | null;
  at?: Date | undefined;
  /** For a kind not in `REVIEWS`. */
  name?: string | null;
  where?: string | null;
  /** When to look again; null for never. Left out: 7 days after a filing, never after a decision. */
  nextCheckAt?: Date | null | undefined;
}

const DECIDED: readonly ReviewState[] = ["passed", "refused", "withdrawn"];

export async function logReview(db: Db, s: ReviewStep): Promise<AccessReviewRow> {
  const at = s.at ?? new Date();
  // The row lock orders two steps on one review: read committed is enough.
  return atomic(db, async (tx) => {
    await tx
      .insert(accessReviews)
      .values({ client: s.client, kind: s.kind, name: s.name, where: s.where })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(accessReviews)
      .where(and(eq(accessReviews.client, s.client), eq(accessReviews.kind, s.kind)))
      .for("update");
    if (!row) throw new Error(`no review ${s.client}/${s.kind}`);
    const state = stateAfter(row.state, s.event);
    const moved = s.event !== "note" && s.event !== "checked";
    const decided = DECIDED.includes(state);
    const nextCheckAt =
      s.nextCheckAt !== undefined
        ? s.nextCheckAt
        : !moved
          ? row.nextCheckAt
          : decided
            ? null
            : state === "more_info"
              ? at
              : new Date(at.getTime() + RECHECK_DAYS * DAY);
    const [out] = await tx
      .update(accessReviews)
      .set({
        state,
        name: s.name ?? row.name,
        where: s.where ?? row.where,
        ticket: s.ticket ?? row.ticket,
        reason:
          s.event === "refused" || s.event === "more_info" ? (s.note ?? row.reason) : row.reason,
        filedAt: s.event === "filed" ? at : row.filedAt,
        decidedAt: decided && moved ? at : moved ? null : row.decidedAt,
        nextCheckAt,
        updatedAt: sql`now()`,
      })
      .where(eq(accessReviews.id, row.id))
      .returning();
    await tx.insert(accessReviewEvents).values({
      reviewId: row.id,
      at,
      kind: s.event,
      note: s.note ?? null,
      ticket: s.ticket ?? null,
      by: s.by,
    });
    return out as AccessReviewRow;
  });
}

export interface ReviewView extends AccessReviewRow {
  /** The catalog's name, or the row's own. */
  title: string;
  last: AccessReviewEventRow | null;
}

/** One client's reviews, or every client's; each with its latest step. */
export async function listReviews(db: Db, client?: string): Promise<ReviewView[]> {
  const rows = await db
    .select()
    .from(accessReviews)
    .where(client ? eq(accessReviews.client, client) : undefined)
    .orderBy(asc(accessReviews.client), asc(accessReviews.kind));
  if (!rows.length) return [];
  const lasts = await db
    .selectDistinctOn([accessReviewEvents.reviewId])
    .from(accessReviewEvents)
    .orderBy(accessReviewEvents.reviewId, desc(accessReviewEvents.at), desc(accessReviewEvents.id));
  const byId = new Map(lasts.map((e) => [e.reviewId, e]));
  return rows.map((r) => ({
    ...r,
    title: reviewOf(r.kind)?.name ?? r.name ?? r.kind,
    last: byId.get(r.id) ?? null,
  }));
}

/** A review's steps, oldest first. */
export async function reviewHistory(
  db: Db,
  client: string,
  kind: string,
): Promise<{ review: AccessReviewRow; events: AccessReviewEventRow[] } | null> {
  const [review] = await db
    .select()
    .from(accessReviews)
    .where(and(eq(accessReviews.client, client), eq(accessReviews.kind, kind)));
  if (!review) return null;
  const events = await db
    .select()
    .from(accessReviewEvents)
    .where(eq(accessReviewEvents.reviewId, review.id))
    .orderBy(asc(accessReviewEvents.at), asc(accessReviewEvents.id));
  return { review, events };
}
