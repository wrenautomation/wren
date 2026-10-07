/**
 * The key store's tables (designs/2026-10-07-key-store.md). Main only. `client_secrets` holds
 * sealed values and stays out of the audit log (a delete would keep the sealed row there for
 * good); `client_secret_events` is the log of every read and write, never with a value, and is
 * audited like any other table.
 */
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  bigserial,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { clients } from "./clients/schema.js";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (v) => Buffer.from(v),
  fromDriver: (v) => new Uint8Array(v),
});

/** `staged`: sealed at the edge, waiting for a handler to bind it. `live`: the client's key. */
export const SECRET_STATES = ["staged", "live"] as const;
export type SecretState = (typeof SECRET_STATES)[number];

export const clientSecrets = pgTable(
  "client_secrets",
  {
    /** The reference handlers and rows carry: `ks_` + 32 hex. Stays the same across rotations. */
    id: varchar("id", { length: 35 }).notNull(),
    client: varchar("client", { length: 40 }).notNull(),
    /** What it is, as Wren's env names it: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. */
    name: varchar("name", { length: 64 }).notNull(),
    state: varchar("state", { length: 8, enum: SECRET_STATES }).$type<SecretState>().notNull(),
    /** Which private key opens `wrapped`. */
    kid: varchar("kid", { length: 16 }).notNull(),
    /** The data key: the ephemeral public key, then it sealed under the shared key. */
    wrapped: bytea("wrapped").notNull(),
    /** The value under the data key. */
    sealed: bytea("sealed").notNull(),
    /** The value's last 4 characters, for a page to show. */
    last4: varchar("last4", { length: 4 }).notNull(),
    version: integer("version").default(1).notNull(),
    /** The staged ref this live value last came from: binding it again answers the same. */
    boundFrom: varchar("bound_from", { length: 35 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    createdBy: varchar("created_by", { length: 320 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedBy: varchar("updated_by", { length: 320 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_client_secrets" }),
    uniqueIndex("uq_client_secrets_live").on(t.client, t.name).where(sql`${t.state} = 'live'`),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_client_secrets_client",
    }).onDelete("cascade"),
    oneOf("ck_client_secrets_state", t.state, SECRET_STATES),
  ],
);
export type ClientSecretRow = typeof clientSecrets.$inferSelect;

export const SECRET_OPS = [
  "stage",
  "bind",
  "put",
  "rotate",
  "read",
  "delete",
  "expire",
  "rewrap",
] as const;
export type SecretOp = (typeof SECRET_OPS)[number];

/** Every read and write of a key: who, what, why. Kept for good, so no foreign key. */
export const clientSecretEvents = pgTable(
  "client_secret_events",
  {
    id: bigserial("id", { mode: "number" }).notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    secret: varchar("secret", { length: 35 }).notNull(),
    client: varchar("client", { length: 40 }).notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    op: varchar("op", { length: 8, enum: SECRET_OPS }).$type<SecretOp>().notNull(),
    by: varchar("by", { length: 320 }).notNull(),
    why: text("why"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_client_secret_events" }),
    index("ix_client_secret_events_client_at").on(t.client, t.at),
    oneOf("ck_client_secret_events_op", t.op, SECRET_OPS),
  ],
);
export type ClientSecretEvent = typeof clientSecretEvents.$inferSelect;
