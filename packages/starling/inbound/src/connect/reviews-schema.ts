/**
 * Access reviews (designs/2026-10-23-access-reviews.md): each platform review a client waits on,
 * Wren's own under client `wren`, and every step of it. Main only, beside the social connections.
 * What a review needs lives in code (`REVIEWS`); its state and history live here.
 */
import { oneOf } from "@wren/db/columns";
import {
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

/** Where a review is. `more_info`: the platform asked something back. */
export const REVIEW_STATES = [
  "draft",
  "filed",
  "more_info",
  "refused",
  "passed",
  "withdrawn",
] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/** One step of a review. `note` and `checked` keep the state; the rest set it. */
export const REVIEW_EVENTS = [
  "filed",
  "more_info",
  "answered",
  "refused",
  "passed",
  "withdrawn",
  "note",
  "checked",
] as const;
export type ReviewEvent = (typeof REVIEW_EVENTS)[number];

/** One review per client and kind. `kind` is a `REVIEWS` id, or any id for one not in it. */
export const accessReviews = pgTable(
  "access_reviews",
  {
    id: serial("id").notNull(),
    client: varchar("client", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 64 }).notNull(),
    /** For a kind not in `REVIEWS`: what it is and where it's filed. */
    name: text("name"),
    where: text("where"),
    state: varchar("state", { length: 12, enum: REVIEW_STATES })
      .$type<ReviewState>()
      .default("draft")
      .notNull(),
    /** The platform's ticket, case or submission id. */
    ticket: varchar("ticket", { length: 200 }),
    /** The platform's last reason, refusal or question, in its words. */
    reason: text("reason"),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** When to look at it again. Null: nothing to wait for. */
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_access_reviews" }),
    unique("uq_access_reviews_kind").on(t.client, t.kind),
    oneOf("ck_access_reviews_state", t.state, REVIEW_STATES),
  ],
);
export type AccessReviewRow = typeof accessReviews.$inferSelect;

/** Every step, never changed: what the consoles forget. */
export const accessReviewEvents = pgTable(
  "access_review_events",
  {
    id: serial("id").notNull(),
    reviewId: integer("review_id").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    kind: varchar("kind", { length: 12, enum: REVIEW_EVENTS }).$type<ReviewEvent>().notNull(),
    note: text("note"),
    ticket: varchar("ticket", { length: 200 }),
    by: varchar("by", { length: 320 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_access_review_events" }),
    index("ix_access_review_events_review").on(t.reviewId, t.at),
    foreignKey({
      columns: [t.reviewId],
      foreignColumns: [accessReviews.id],
      name: "fk_access_review_events_review",
    }).onDelete("cascade"),
    oneOf("ck_access_review_events_kind", t.kind, REVIEW_EVENTS),
  ],
);
export type AccessReviewEventRow = typeof accessReviewEvents.$inferSelect;
