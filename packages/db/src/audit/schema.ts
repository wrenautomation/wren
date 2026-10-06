import { sql } from "drizzle-orm";
import {
  bigint,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * Every change to an audited table, one row per row changed (`audit_row()`
 * trigger, attached by `syncAuditTriggers`). Append-only: a guard trigger
 * refuses UPDATE, DELETE and TRUNCATE, and client logins may only read it.
 * - insert: `row_key` only (the row is in its table).
 * - update: only the columns that changed, in `old_values` and `new_values`;
 *   for a table without a primary key, the whole row before and after.
 * - delete: the whole row in `old_values`.
 * - truncate: one row per table, no data.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    /** The server's era (`audit_eras`): (era, tx) orders the chain across a restore. */
    era: integer("era").default(sql`audit_era()`).notNull(),
    /** The writing transaction. Seals take only finished ones, so none is ever missed. */
    tx: bigint("tx", { mode: "number" })
      .default(sql`(pg_current_xact_id())::text::bigint`)
      .notNull(),
    tableName: text("table_name").notNull(),
    op: text("op").$type<"insert" | "update" | "delete" | "truncate">().notNull(),
    /** The primary key's columns and values; null for a table without one (then `new_values` holds the row). */
    rowKey: jsonb("row_key").$type<Record<string, unknown>>(),
    oldValues: jsonb("old_values").$type<Record<string, unknown>>(),
    newValues: jsonb("new_values").$type<Record<string, unknown>>(),
    /** The Postgres login: main's, or a client's own. */
    dbUser: text("db_user").default(sql`SESSION_USER`).notNull(),
    /** The connection's application_name: wren-worker, wren-cli:<command>, wren-migrate. */
    app: text("app").default(sql`current_setting('application_name')`).notNull(),
    /** The person, when known: the portal viewer, or whoever ran the CLI. */
    actor: text("actor").default(sql`NULLIF(current_setting('wren.actor', true), '')`),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_audit_events" }),
    index("ix_audit_events_era_tx").on(t.era, t.tx, t.id),
    index("ix_audit_events_table_at").on(t.tableName, t.at),
    index("ix_audit_events_at").on(t.at),
  ],
);

/**
 * The chain: each seal covers every event in [(from_era, from_tx),
 * (through_era, through_tx)), all finished when it was made. `hash` =
 * sha256(prev_hash || sha256(event)...) in (era, tx, id) order;
 * `audit_verify()` recomputes it.
 */
export const auditSeals = pgTable(
  "audit_seals",
  {
    id: integer("id").generatedAlwaysAsIdentity(),
    sealedAt: timestamp("sealed_at", { withTimezone: true }).defaultNow().notNull(),
    fromEra: integer("from_era").notNull(),
    fromTx: bigint("from_tx", { mode: "number" }).notNull(),
    throughEra: integer("through_era").notNull(),
    throughTx: bigint("through_tx", { mode: "number" }).notNull(),
    events: bigint("events", { mode: "number" }).notNull(),
    prevHash: bytea("prev_hash"),
    hash: bytea("hash").notNull(),
  },
  (t) => [primaryKey({ columns: [t.id], name: "pk_audit_seals" })],
);

/**
 * Each server the database has lived on, in order: Postgres's `system_identifier`
 * and the era it follows. A restore elsewhere, or a move back, starts a new one.
 */
export const auditEras = pgTable(
  "audit_eras",
  {
    era: integer("era").generatedAlwaysAsIdentity(),
    cluster: bigint("cluster", { mode: "bigint" }).notNull(),
    follows: integer("follows").notNull(),
    beganAt: timestamp("began_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.era], name: "pk_audit_eras" }),
    unique().on(t.cluster, t.follows),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type AuditSealRow = typeof auditSeals.$inferSelect;
