/**
 * The send journal's table: one row per keyed direct write, in the database of the send's own
 * ledger (Wren's, or a client's beside its `send_attempts`). See `send-journal.ts`.
 */
import { index, jsonb, pgTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/pg-core";
import type { SendVerdict } from "./send-verdict.js";

export const sendJournal = pgTable(
  "send_journal",
  {
    /** The write's key (`writeKey`): the send key, the route and its count. */
    key: varchar("key", { length: 200 }).notNull(),
    site: varchar("site", { length: 40 }).notNull(),
    method: varchar("method", { length: 8 }).notNull(),
    path: text("path").notNull(),
    /** The login the write went out as; null = the site's default. */
    account: varchar("account", { length: 120 }),
    /** Written before the act: a row with no verdict means a try began and its end is unknown. */
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** The end, once known; null while the try is open. */
    verdict: jsonb("verdict").$type<SendVerdict>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.key], name: "pk_send_journal" }),
    index("ix_send_journal_started").on(t.startedAt),
  ],
);
export type SendJournalRow = typeof sendJournal.$inferSelect;
