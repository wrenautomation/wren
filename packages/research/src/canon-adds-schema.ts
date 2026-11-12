/**
 * Links and files a person asked Canon to file, from the portal's Add box
 * (designs/2026-11-12-canon-references.md, D4). Main only, never schema `canon` (rebuilt from git).
 * Any machine with the database, yt-dlp and Canon push rights drains it: `wren source drain`.
 */
import { oneOf } from "@wren/db/columns";
import {
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/** pending → claimed → done | failed; a claim whose lease ran out is pending again. */
export const CANON_ADD_STATES = ["pending", "claimed", "done", "failed"] as const;
export type CanonAddState = (typeof CANON_ADD_STATES)[number];

export const canonAddRequests = pgTable(
  "canon_add_requests",
  {
    id: serial("id").notNull(),
    /** a link, or `s3://<media bucket>/media/<sha32>.<ext>` for an uploaded file */
    what: text("what").notNull(),
    /** an uploaded file's own name */
    fileName: text("file_name"),
    /** the person's words, whole */
    note: text("note"),
    /** who the note and the source are from, as Canon names them (`william`) */
    person: text("person").notNull(),
    askedBy: text("asked_by").notNull(),
    state: varchar("state", { length: 8, enum: CANON_ADD_STATES }).default("pending").notNull(),
    /** the machine that holds the claim */
    worker: text("worker"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    attempts: integer("attempts").default(0).notNull(),
    error: text("error"),
    /** the Canon record ids it made or touched */
    records: text("records").array(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_canon_add_requests" }),
    oneOf("ck_canon_add_requests_state", t.state, CANON_ADD_STATES),
    index("ix_canon_add_requests_state").on(t.state, t.at),
  ],
);
export type CanonAddRequest = typeof canonAddRequests.$inferSelect;
