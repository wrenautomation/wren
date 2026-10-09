/**
 * Client social access (designs/2026-10-07-client-social.md): sign-ins in flight and connected
 * accounts. Main only, beside the account registry: the checks and the worker read across
 * clients. Tokens never sit here: a connection names its key in the key store.
 */
import { clientAccounts } from "@wren/core/setup-schema";
import { oneOf } from "@wren/db/columns";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "./platforms.js";

export const SOCIAL_STATES = ["connected", "broken"] as const;
export type SocialState = (typeof SOCIAL_STATES)[number];

/**
 * One sign-in in flight: the random `state` the platform hands back, used once. It carries whose
 * it is, so the callback needs no session.
 */
export const socialGrants = pgTable(
  "social_grants",
  {
    state: varchar("state", { length: 64 }).notNull(),
    client: varchar("client", { length: 64 }).notNull(),
    platform: varchar("platform", { length: 16, enum: SOCIAL_PLATFORMS })
      .$type<SocialPlatform>()
      .notNull(),
    /** PKCE's verifier, where the platform takes one. */
    verifier: varchar("verifier", { length: 128 }),
    by: varchar("by", { length: 320 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.state], name: "pk_social_grants" }),
    index("ix_social_grants_client").on(t.client),
    oneOf("ck_social_grants_platform", t.platform, SOCIAL_PLATFORMS),
  ],
);
export type SocialGrantRow = typeof socialGrants.$inferSelect;

/**
 * What a connection carries beside its token: the Page an Instagram account posts through, a
 * LinkedIn company page's URN, a Business Profile's location.
 */
export interface SocialExtra {
  pageId?: string;
  pageName?: string;
  igUserId?: string;
  /** `urn:li:organization:<id>`: the company page it posts as. */
  orgUrn?: string;
  /** `accounts/<a>/locations/<l>`: the Business Profile it posts as and reads reviews of. */
  location?: string;
}

/** A connected account: who it is on the platform and where its token is kept. */
export const socialConnections = pgTable(
  "social_connections",
  {
    id: serial("id"),
    client: varchar("client", { length: 64 }).notNull(),
    platform: varchar("platform", { length: 16, enum: SOCIAL_PLATFORMS })
      .$type<SocialPlatform>()
      .notNull(),
    /** Its `client_accounts` row (site `social`), so setups recheck it. */
    accountId: integer("account_id").notNull(),
    /** The platform's id for it: a Page id, a channel id, an X user id, a member `sub`. */
    externalId: varchar("external_id", { length: 128 }).notNull(),
    name: text("name"),
    handle: varchar("handle", { length: 120 }),
    /** The scopes granted, space-separated, as the platform said them. */
    scopes: text("scopes").notNull(),
    /** The key store's ref (`ks_…`) for its token; the value is never here. */
    tokenRef: varchar("token_ref", { length: 64 }).notNull(),
    /** When the stored token lapses (LinkedIn's 60 days); null when it doesn't. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    extra: jsonb("extra").$type<SocialExtra>().default({}).notNull(),
    state: varchar("state", { length: 12, enum: SOCIAL_STATES })
      .$type<SocialState>()
      .default("connected")
      .notNull(),
    /** Said to a person when broken: "Access was taken back". */
    why: text("why"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    by: varchar("by", { length: 320 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_social_connections" }),
    unique("uq_social_connections_account").on(t.client, t.platform, t.externalId),
    index("ix_social_connections_account").on(t.accountId),
    foreignKey({
      columns: [t.accountId],
      foreignColumns: [clientAccounts.id],
      name: "fk_social_connections_account",
    }).onDelete("cascade"),
    oneOf("ck_social_connections_platform", t.platform, SOCIAL_PLATFORMS),
    oneOf("ck_social_connections_state", t.state, SOCIAL_STATES),
  ],
);
export type SocialConnectionRow = typeof socialConnections.$inferSelect;
