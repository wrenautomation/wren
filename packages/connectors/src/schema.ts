/**
 * Connectors (designs/2026-10-09-connectors.md): sign-ins in flight, connected apps, and what each
 * already told the spine. Main only: the hourly sync reads across clients. Tokens never sit here:
 * a link names its key in the key store.
 */
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
import { CONNECTOR_APPS, type ConnectorApp } from "./apps.js";

export const LINK_STATES = ["connected", "broken"] as const;
export type LinkState = (typeof LINK_STATES)[number];

/** One sign-in in flight: the random `state` the app hands back, used once. */
export const connectorGrants = pgTable(
  "connector_grants",
  {
    state: varchar("state", { length: 64 }).notNull(),
    client: varchar("client", { length: 64 }).notNull(),
    app: varchar("app", { length: 16, enum: CONNECTOR_APPS }).$type<ConnectorApp>().notNull(),
    by: varchar("by", { length: 320 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.state], name: "pk_connector_grants" }),
    index("ix_connector_grants_client").on(t.client),
    oneOf("ck_connector_grants_app", t.app, CONNECTOR_APPS),
  ],
);

/** What a link carries beside its token: QuickBooks' company (`realmId`). */
export interface LinkExtra {
  realm?: string;
}

/** Where each read left off: the newest change seen, per thing it reads. */
export type LinkCursor = Record<string, string>;

/** A connected app: whose account it is and where its token is kept. */
export const connectorLinks = pgTable(
  "connector_links",
  {
    id: serial("id"),
    client: varchar("client", { length: 64 }).notNull(),
    app: varchar("app", { length: 16, enum: CONNECTOR_APPS }).$type<ConnectorApp>().notNull(),
    /** The app's id for the account: HubSpot's hub, QuickBooks' realm, Jobber's account. */
    externalId: varchar("external_id", { length: 128 }).notNull(),
    name: text("name"),
    scopes: text("scopes").notNull(),
    /** The key store's ref (`ks_…`) for its token; the value is never here. */
    tokenRef: varchar("token_ref", { length: 64 }).notNull(),
    extra: jsonb("extra").$type<LinkExtra>().default({}).notNull(),
    state: varchar("state", { length: 12, enum: LINK_STATES })
      .$type<LinkState>()
      .default("connected")
      .notNull(),
    /** Said to a person when broken. */
    why: text("why"),
    cursor: jsonb("cursor").$type<LinkCursor>().default({}).notNull(),
    /** People read in, all time. */
    people: integer("people").default(0).notNull(),
    /** Events told to the spine, all time. */
    fired: integer("fired").default(0).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    by: varchar("by", { length: 320 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_connector_links" }),
    unique("uq_connector_links_account").on(t.client, t.app, t.externalId),
    oneOf("ck_connector_links_app", t.app, CONNECTOR_APPS),
    oneOf("ck_connector_links_state", t.state, LINK_STATES),
  ],
);
export type ConnectorLink = typeof connectorLinks.$inferSelect;

/** What a link already told the spine, once each: `invoice:12`, `job:9`. */
export const connectorFired = pgTable(
  "connector_fired",
  {
    linkId: integer("link_id").notNull(),
    key: varchar("key", { length: 160 }).notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.linkId, t.key], name: "pk_connector_fired" }),
    foreignKey({
      columns: [t.linkId],
      foreignColumns: [connectorLinks.id],
      name: "fk_connector_fired_link",
    }).onDelete("cascade"),
  ],
);
