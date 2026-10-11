/**
 * The dead-letter queue's rows (designs/2026-10-11-dead-letters.md): one per Restate
 * invocation that used up its retries and paused. Main only: the invocations are the
 * platform's, whichever client they worked for.
 */
import { oneOf } from "@wren/db/columns";
import {
  index,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * How a letter ended. `retried`: resumed from where it stopped. `killed`: given up for good,
 * its caller told. `dropped`: marked handled with Restate left alone. `cleared`: it left
 * the paused state some other way (the `restate` CLI, a resume by hand).
 */
export const DEAD_LETTER_ENDS = ["retried", "killed", "dropped", "cleared"] as const;
export type DeadLetterEnd = (typeof DEAD_LETTER_ENDS)[number];

export const deadLetters = pgTable(
  "dead_letters",
  {
    id: serial("id").notNull(),
    /** Restate's `inv_…` id: the handle every action takes. */
    invocationId: varchar("invocation_id", { length: 64 }).notNull(),
    /** `Service/handler`. */
    target: varchar("target", { length: 200 }).notNull(),
    /** The object's key; null for a plain service. */
    key: text("key"),
    /** The last failure Restate kept, when it kept one. */
    error: text("error"),
    /** Who sent it: `ConsolePortal/call`, `ingress`. */
    invokedBy: varchar("invoked_by", { length: 200 }),
    /** When Restate paused it. */
    pausedAt: timestamp("paused_at", { withTimezone: true }).notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).defaultNow().notNull(),
    /** When the alert went out; null = not yet. */
    toldAt: timestamp("told_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    end: varchar("end", { length: 8, enum: DEAD_LETTER_ENDS }).$type<DeadLetterEnd>(),
    /** The login or `sweep` that ended it. */
    endedBy: varchar("ended_by", { length: 320 }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_dead_letters" }),
    unique("uq_dead_letters_invocation").on(t.invocationId),
    index("ix_dead_letters_open").on(t.endedAt, t.pausedAt),
    oneOf("ck_dead_letters_end", t.end, DEAD_LETTER_ENDS),
  ],
);
export type DeadLetterRow = typeof deadLetters.$inferSelect;
