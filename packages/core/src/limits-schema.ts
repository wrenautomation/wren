/**
 * Limits over the code's defaults (designs/2026-10-26-limits.md). Main only, like vendor_modes:
 * a row with no client is Wren-wide, a client's row is that client's alone. The audit log keeps
 * every edit.
 */

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  serial,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { clients } from "./clients/schema.js";

export const limits = pgTable(
  "limits",
  {
    id: serial("id").notNull(),
    client: varchar("client", { length: 40 }),
    /** A `LimitDef` name: `research.triggers`. */
    name: varchar("name", { length: 64 }).notNull(),
    perDay: integer("per_day").notNull(),
    /** The most spent at once; null for a daily count with no burst. */
    burst: integer("burst"),
    updatedBy: varchar("updated_by", { length: 320 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_limits" }),
    unique("uq_limits_owner").on(t.client, t.name).nullsNotDistinct(),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_limits_client",
    }).onDelete("cascade"),
    check("ck_limits_per_day", sql`${t.perDay} >= 0`),
    check("ck_limits_burst", sql`${t.burst} is null or ${t.burst} >= 1`),
  ],
);
export type LimitRow = typeof limits.$inferSelect;
