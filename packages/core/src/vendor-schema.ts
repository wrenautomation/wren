/**
 * Vendor modes and metered usage (designs/2026-10-07-setup-and-vendors.md). Main only: Wren's
 * team reads across clients, and a managed bucket is shared by every client on it. A row with no
 * client is Wren's own.
 */
import { oneOf } from "@wren/db/columns";
import {
  bigint,
  bigserial,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { clients } from "./clients/schema.js";

/** `own`: the client's key and bill. `managed`: Wren's key, metered, capped, billed through Books. */
export const VENDOR_MODES = ["own", "managed"] as const;
export type VendorMode = (typeof VENDOR_MODES)[number];

/** One owner's mode on one vendor. No row: parts that need the vendor wait with "Needs setup". */
export const vendorModes = pgTable(
  "vendor_modes",
  {
    id: serial("id").notNull(),
    client: varchar("client", { length: 40 }),
    /** A `VENDORS` id: `exa`, `youtube`. */
    vendor: varchar("vendor", { length: 32 }).notNull(),
    mode: varchar("mode", { length: 8, enum: VENDOR_MODES }).$type<VendorMode>().notNull(),
    /** Own key: its key store ref (`ks_…`). The key itself never sits here. */
    keyName: varchar("key_name", { length: 200 }),
    /** Managed: the client's share of Wren's quota a day. 0: none, so nothing runs. */
    perDay: integer("per_day").default(0).notNull(),
    /** Managed: the most a month may cost, in cents. 0: nothing runs. */
    capCents: integer("cap_cents").default(0).notNull(),
    updatedBy: varchar("updated_by", { length: 320 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_vendor_modes" }),
    unique("uq_vendor_modes_owner").on(t.client, t.vendor).nullsNotDistinct(),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_vendor_modes_client",
    }).onDelete("cascade"),
    oneOf("ck_vendor_modes_mode", t.mode, VENDOR_MODES),
  ],
);
export type VendorModeRow = typeof vendorModes.$inferSelect;

/**
 * One metered call or batch. Kept for good, as a ledger: no foreign key, so a client's usage
 * outlives the client.
 */
export const vendorUsage = pgTable(
  "vendor_usage",
  {
    id: bigserial("id", { mode: "number" }).notNull(),
    client: varchar("client", { length: 40 }),
    vendor: varchar("vendor", { length: 32 }).notNull(),
    mode: varchar("mode", { length: 8, enum: VENDOR_MODES }).$type<VendorMode>().notNull(),
    /** `<vendor>:own:<client>` or `<vendor>:managed`: whose quota it spent. */
    bucket: varchar("bucket", { length: 80 }).notNull(),
    units: integer("units").notNull(),
    /** Estimated from the public price, in micro-dollars. */
    micros: bigint("micros", { mode: "number" }).notNull(),
    /** The part that spent it: `signals.triggers`. */
    part: varchar("part", { length: 64 }),
    /** Its `runs` row, when one ran it. */
    runId: uuid("run_id"),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_vendor_usage" }),
    index("ix_vendor_usage_bucket").on(t.bucket, t.at),
    index("ix_vendor_usage_owner").on(t.client, t.vendor, t.at),
    oneOf("ck_vendor_usage_mode", t.mode, VENDOR_MODES),
  ],
);
export type UsageRow = typeof vendorUsage.$inferSelect;
