import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import type { Permission, RoleId } from "../access.js";

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
 * A named bundle of grants (designs/2026-10-06-scoped-access.md). The built-ins are rows with no
 * client, their verbs fixed in code (`TEAM_GRANTS`, `MEMBER_GRANTS`); a custom role belongs to a
 * client, or to `wren` for Wren's team, and its grants are `role_grants` rows. Its id is
 * `<client>.<slug>`. A seat or membership names its role here.
 */
export const roles = pgTable(
  "roles",
  {
    id: varchar("id", { length: 64 }).notNull(),
    /** Null for a built-in; a client id, or `wren` for Wren's own team. */
    client: varchar("client", { length: 40 }),
    name: text("name").notNull(),
    about: text("about"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.id], name: "pk_roles" }), index("ix_roles_client").on(t.client)],
);

/** One grant of a custom role: verbs over a scope. Left-out parts are all. */
export const roleGrants = pgTable(
  "role_grants",
  {
    id: serial("id").notNull(),
    role: varchar("role", { length: 64 }).notNull(),
    verbs: text("verbs").array().$type<Permission[]>().notNull(),
    apps: text("apps").array(),
    channels: text("channels").array(),
    /** `<type>:<id>`: one record. */
    record: text("record"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_role_grants" }),
    foreignKey({
      columns: [t.role],
      foreignColumns: [roles.id],
      name: "fk_role_grants_role",
    }).onDelete("cascade"),
    index("ix_role_grants_role").on(t.role),
  ],
);

/**
 * An extra grant to one login past its role: verbs over a scope at one client (or `wren`), until
 * a time or for a number of uses. Ending one sets `until`; ended and used-up grants drop out when
 * read, so nothing sweeps them, and the audit log keeps every change.
 */
export const grants = pgTable(
  "grants",
  {
    id: serial("id").notNull(),
    email: text("email").notNull(),
    /** A client id, or `wren` for Wren's own apps. */
    client: varchar("client", { length: 40 }).notNull(),
    verbs: text("verbs").array().$type<Permission[]>().notNull(),
    apps: text("apps").array(),
    channels: text("channels").array(),
    record: text("record"),
    until: timestamp("until", { withTimezone: true }),
    usesLeft: integer("uses_left"),
    reason: text("reason"),
    /** Who handed it out. */
    by: text("by").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_grants" }),
    index("ix_grants_email").on(t.email, t.client),
  ],
);
export type GrantRow = typeof grants.$inferSelect;

/**
 * An issue raised on one record by someone with `comment` there: a short note, open until
 * someone with `act` on that record resolves it. `app` and `channel` are the record's, so the
 * Inbox finds who can act on it.
 */
export const issues = pgTable(
  "issues",
  {
    id: serial("id").notNull(),
    /** A client id, or `wren` for Wren's own apps. */
    client: varchar("client", { length: 40 }).notNull(),
    /** `<type>:<id>`. */
    record: text("record").notNull(),
    title: text("title"),
    app: varchar("app", { length: 40 }).notNull(),
    channel: varchar("channel", { length: 40 }),
    body: text("body").notNull(),
    by: text("by").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_issues" }),
    index("ix_issues_record").on(t.client, t.record),
    index("ix_issues_open").on(t.client, t.resolvedAt),
  ],
);
export type IssueRow = typeof issues.$inferSelect;

/**
 * Someone asking for more: verbs over a scope, until a time, with a reason. It waits in the Inbox
 * of whoever could grant it; approving makes the grant, declining closes it.
 */
export const accessAsks = pgTable(
  "access_asks",
  {
    id: serial("id").notNull(),
    email: text("email").notNull(),
    client: varchar("client", { length: 40 }).notNull(),
    verbs: text("verbs").array().$type<Permission[]>().notNull(),
    apps: text("apps").array(),
    channels: text("channels").array(),
    record: text("record"),
    until: timestamp("until", { withTimezone: true }),
    reason: text("reason"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    approved: boolean("approved"),
    grantId: integer("grant_id"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_access_asks" }),
    foreignKey({
      columns: [t.grantId],
      foreignColumns: [grants.id],
      name: "fk_access_asks_grant",
    }).onDelete("set null"),
    index("ix_access_asks_grant").on(t.grantId),
    index("ix_access_asks_open").on(t.client, t.decidedAt),
    index("ix_access_asks_email").on(t.email),
  ],
);
export type AccessAskRow = typeof accessAsks.$inferSelect;

/**
 * Who sees which client in the portal, by sign-in email (lowercase). Auth says
 * who someone is; this says what they see. An owner invites teammates.
 */
export const clientMembers = pgTable(
  "client_members",
  {
    clientId: varchar("client_id", { length: 40 }).notNull(),
    email: text("email").notNull(),
    /** A built-in (`MEMBER_ROLES`) or this client's custom role. */
    role: varchar("role", { length: 64 }).$type<RoleId>().default("member").notNull(),
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
    foreignKey({
      columns: [t.role],
      foreignColumns: [roles.id],
      name: "fk_client_members_role",
    }),
    index("ix_client_members_role").on(t.role),
  ],
);

export type ClientMember = typeof clientMembers.$inferSelect;

/** A custom hostname's state at Cloudflare for SaaS, as its API reports it. */
export interface DomainRecords {
  /** What the client sets: a CNAME to our fallback origin. */
  cname: { name: string; target: string };
  /** Optional: proves ownership before the CNAME moves (Cloudflare's pre-validation). */
  txt: { name: string; value: string } | null;
}

/**
 * A client's own host for its portal (designs/2026-10-06-custom-domains.md): Cloudflare issues
 * the cert, the portal Worker pins every request on the host to `client_id`.
 */
export const clientDomains = pgTable(
  "client_domains",
  {
    hostname: text("hostname").notNull(),
    clientId: varchar("client_id", { length: 40 }).notNull(),
    /** Cloudflare's custom hostname id. */
    cfId: text("cf_id").notNull(),
    /** Cloudflare's hostname status: pending until the CNAME is seen, then active. */
    status: text("status").notNull(),
    /** Cloudflare's certificate status. */
    sslStatus: text("ssl_status").notNull(),
    records: jsonb("records").$type<DomainRecords>().notNull(),
    /** Cloudflare's last word on why it isn't live yet. */
    problem: text("problem"),
    addedBy: text("added_by").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.hostname], name: "pk_client_domains" }),
    foreignKey({
      columns: [t.clientId],
      foreignColumns: [clients.id],
      name: "fk_client_domains_client",
    }).onDelete("cascade"),
    index("ix_client_domains_client").on(t.clientId),
  ],
);

export type ClientDomain = typeof clientDomains.$inferSelect;

/**
 * Wren's own people (`@wren/core/access`): an admin does everything, an operator works its
 * clients, a viewer reads them. `clients` null is every client; `wren` in it is Wren's own apps.
 */
export const operators = pgTable(
  "operators",
  {
    email: text("email").notNull(),
    /** A built-in (`TEAM_ROLES`) or one of Wren's custom roles (`wren.<slug>`). */
    role: varchar("role", { length: 64 }).$type<RoleId>().default("admin").notNull(),
    clients: text("clients").array(),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.email], name: "pk_operators" }),
    foreignKey({ columns: [t.role], foreignColumns: [roles.id], name: "fk_operators_role" }),
    index("ix_operators_role").on(t.role),
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
