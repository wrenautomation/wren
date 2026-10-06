import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  index,
  jsonb,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { MEMBER_ROLES, TEAM_ROLES } from "../access.js";

/** The channels a client can come in through: an engagement's source, a spend account's. */
export const CHANNELS = ["email", "sms", "ads", "content", "search", "reach"] as const;
export type Channel = (typeof CHANNELS)[number];

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
    /** The portal's look: a preset's name or `readTheme` input (`@wren/ui`). Null is Wren's. */
    look: jsonb("look"),
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

/**
 * Wren's own settings, one block per component: the same shape a client keeps in
 * `clients.products[id]`. Wren has no `clients` row (that would be a client with a database,
 * a watch and a portal login), so the components that run Wren's own business keep theirs here.
 */
export const wrenSettings = pgTable(
  "wren_settings",
  {
    /** The component's id, as in `clients.products`. */
    component: varchar("component", { length: 64 }).notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    /** The team login that last saved it. */
    updatedBy: varchar("updated_by", { length: 320 }),
  },
  (t) => [primaryKey({ columns: [t.component], name: "pk_wren_settings" })],
);

export { MEMBER_ROLES, type MemberRole, TEAM_ROLES, type TeamRole } from "../access.js";

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

/**
 * Wren's own people (`@wren/core/access`): an admin does everything, an operator works its
 * clients, a viewer reads them. `clients` null is every client; `wren` in it is Wren's own apps.
 */
export const operators = pgTable(
  "operators",
  {
    email: text("email").notNull(),
    role: varchar("role", { length: 16, enum: TEAM_ROLES }).default("admin").notNull(),
    clients: text("clients").array(),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.email], name: "pk_operators" }),
    oneOf("ck_operators_role", t.role, TEAM_ROLES),
  ],
);

/** Each client as a console record (`clientRecord`): its products, members and last sign-in. */
export const clientRecords = pgView("client_records", {
  id: text("id"),
  name: text("name"),
  kind: text("kind"),
  products: text("products"),
  members: bigint("members", { mode: "number" }),
  lastSeen: timestamp("last_seen", { withTimezone: true }),
  added: timestamp("added", { withTimezone: true }),
}).as(sql`
  select c.id::text id, c.name, case when c.demo then 'demo' else 'client' end kind,
    (select string_agg(k, ', ' order by k) from jsonb_object_keys(c.products) k) products,
    (select count(*) from client_members m where m.client_id = c.id) members,
    (select max(m.last_seen_at) from client_members m where m.client_id = c.id) last_seen,
    c.created_at added
  from clients c`);
