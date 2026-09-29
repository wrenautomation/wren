import { sql } from "drizzle-orm";
import {
  boolean,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * The client registry. Read only in the main database; client databases carry
 * the table (one migration folder for all) but leave it empty.
 * Names live here, never in git: the repos are public.
 */
export const clients = pgTable(
  "clients",
  {
    id: varchar("id", { length: 40 }).notNull(),
    name: text("name").notNull(),
    /** `wren_client_<id>` on the main server. */
    database: varchar("database", { length: 63 }).notNull(),
    /** Site -> autobrowse account, e.g. { linkedin: "linkedin@research" }. A missing site is off. */
    accounts: jsonb("accounts").$type<Record<string, string>>().default({}).notNull(),
    /** Per-run limits, e.g. { linkedinProfiles: 60, xReads: 100 }. */
    caps: jsonb("caps").$type<Record<string, number>>().default({}).notNull(),
    /** Who may log in to this client's portal (Cloudflare Access email). */
    portalEmails: text("portal_emails").array().default(sql`'{}'::text[]`).notNull(),
    /** The demo: people masked on the way out, no login, no writes, no sends. */
    demo: boolean("demo").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_clients" }),
    unique("uq_clients_database").on(t.database),
  ],
);

export type Client = typeof clients.$inferSelect;
