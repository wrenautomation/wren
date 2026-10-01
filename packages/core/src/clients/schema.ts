import { oneOf } from "@wren/db/columns";
import {
  boolean,
  foreignKey,
  index,
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
    /**
     * Each product's settings, keyed by product: `{ reactivation: { … } }`. The
     * product parses its own block and owns the defaults; this layer never looks inside.
     */
    products: jsonb("products").$type<Record<string, unknown>>().default({}).notNull(),
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

export const MEMBER_ROLES = ["owner", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * Who sees which client in the portal, by sign-in email (lowercase). Auth says
 * who someone is; this says what they see. An owner invites teammates.
 */
export const clientMembers = pgTable(
  "client_members",
  {
    clientId: varchar("client_id", { length: 40 }).notNull(),
    email: text("email").notNull(),
    role: varchar("role", { length: 16, enum: MEMBER_ROLES }).default("member").notNull(),
    /** Who invited them: an operator's or an owner's email. */
    invitedBy: text("invited_by"),
    invitedAt: timestamp("invited_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.clientId, t.email], name: "pk_client_members" }),
    foreignKey({
      columns: [t.clientId],
      foreignColumns: [clients.id],
      name: "fk_client_members_client",
    }).onDelete("cascade"),
    index("ix_client_members_email").on(t.email),
    oneOf("ck_client_members_role", t.role, MEMBER_ROLES),
  ],
);

export type ClientMember = typeof clientMembers.$inferSelect;

/** Wren's own people: they see every client and the operator tools. */
export const operators = pgTable(
  "operators",
  {
    email: text("email").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.email], name: "pk_operators" })],
);
