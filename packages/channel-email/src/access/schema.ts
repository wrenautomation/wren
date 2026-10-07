/**
 * Mail access (designs/2026-10-07-mail-access.md): a client's mailboxes Wren may send from or
 * read. Main only, beside the account registry: the reader and the checks run across clients.
 * Tokens never sit here: a connection names its key in the key store.
 */
import { clientAccounts } from "@wren/core/setup-schema";
import { oneOf } from "@wren/db/columns";
import {
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const MAIL_PROVIDERS = ["google", "microsoft"] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

/** send: gmail.send or Mail.Send alone. read: read and send. */
export const MAIL_ACCESS = ["send", "read"] as const;
export type MailAccess = (typeof MAIL_ACCESS)[number];

/** connect: one mailbox's sign-in. consent: a Microsoft 365 admin's yes for the tenant. */
export const GRANT_KINDS = ["connect", "consent"] as const;
export type GrantKind = (typeof GRANT_KINDS)[number];

export const CONNECTION_STATES = ["connected", "broken"] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

/**
 * One sign-in in flight: the random `state` Google or Microsoft hands back, used once. It carries
 * whose account it is, so the callback needs no session.
 */
export const mailGrants = pgTable(
  "mail_grants",
  {
    state: varchar("state", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 8, enum: GRANT_KINDS }).$type<GrantKind>().notNull(),
    provider: varchar("provider", { length: 12, enum: MAIL_PROVIDERS })
      .$type<MailProvider>()
      .notNull(),
    /** The mailbox account (connect), or the Microsoft 365 org account (consent). */
    accountId: integer("account_id").notNull(),
    want: varchar("want", { length: 8, enum: MAIL_ACCESS }).$type<MailAccess>().notNull(),
    /** PKCE's verifier for a connect; null for a consent. */
    verifier: varchar("verifier", { length: 128 }),
    by: varchar("by", { length: 320 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.state], name: "pk_mail_grants" }),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [clientAccounts.id],
      name: "fk_mail_grants_account",
    }).onDelete("cascade"),
    index("ix_mail_grants_account").on(t.accountId),
    oneOf("ck_mail_grants_kind", t.kind, GRANT_KINDS),
    oneOf("ck_mail_grants_provider", t.provider, MAIL_PROVIDERS),
    oneOf("ck_mail_grants_want", t.want, MAIL_ACCESS),
  ],
);
export type GrantRow = typeof mailGrants.$inferSelect;

/** A mailbox's connection: what it may do and where its refresh token is kept. */
export const mailConnections = pgTable(
  "mail_connections",
  {
    accountId: integer("account_id").notNull(),
    provider: varchar("provider", { length: 12, enum: MAIL_PROVIDERS })
      .$type<MailProvider>()
      .notNull(),
    address: varchar("address", { length: 320 }).notNull(),
    /** Google's `hd` (a Workspace domain; null for personal Gmail), or Microsoft's tenant id. */
    org: varchar("org", { length: 255 }),
    /** The scopes granted, space-separated, as the provider said them. */
    scopes: text("scopes").notNull(),
    access: varchar("access", { length: 8, enum: MAIL_ACCESS }).$type<MailAccess>().notNull(),
    /** The key store's name for its refresh token; the value is never here. */
    tokenName: varchar("token_name", { length: 255 }).notNull(),
    state: varchar("state", { length: 12, enum: CONNECTION_STATES })
      .$type<ConnectionState>()
      .default("connected")
      .notNull(),
    /** Said to a person when broken: "The token was revoked". */
    why: text("why"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    by: varchar("by", { length: 320 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId], name: "pk_mail_connections" }),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [clientAccounts.id],
      name: "fk_mail_connections_account",
    }).onDelete("cascade"),
    oneOf("ck_mail_connections_provider", t.provider, MAIL_PROVIDERS),
    oneOf("ck_mail_connections_access", t.access, MAIL_ACCESS),
    oneOf("ck_mail_connections_state", t.state, CONNECTION_STATES),
  ],
);
export type ConnectionRow = typeof mailConnections.$inferSelect;

/** A Microsoft 365 admin's consent, per org account: the tenant it landed in. */
export const mailConsents = pgTable(
  "mail_consents",
  {
    accountId: integer("account_id").notNull(),
    tenant: varchar("tenant", { length: 64 }).notNull(),
    scopes: text("scopes").notNull(),
    by: varchar("by", { length: 320 }).notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId], name: "pk_mail_consents" }),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [clientAccounts.id],
      name: "fk_mail_consents_account",
    }).onDelete("cascade"),
  ],
);
export type ConsentRow = typeof mailConsents.$inferSelect;
