/**
 * Custom fields and custom values (designs/2026-10-09-custom-fields.md).
 *
 * - `custom_fields`: a field an owner adds to a record type ("deals.deal"), in the database that
 *   holds the record. In a client's own database the owner is null: the database is theirs.
 * - `custom_field_values`: one field's value on one record, by the record's key as text.
 * - `custom_values`: an owner's business facts, quoted as `{biz.<key>}`. Main database.
 *
 * Archived, never deleted: an archived field hides and keeps its values.
 */
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { clients } from "./clients/schema.js";

export const CUSTOM_KINDS = [
  "text",
  "number",
  "money",
  "date",
  "choice",
  "yes_no",
  "link",
] as const;
export type CustomKind = (typeof CUSTOM_KINDS)[number];
export interface CustomOption {
  key: string;
  label: string;
}

export const customFields = pgTable(
  "custom_fields",
  {
    id: uuid("id").defaultRandom().notNull(),
    /** Whose field; null is Wren's in main, the database's own client elsewhere. */
    owner: varchar("owner", { length: 40 }),
    /** The record type it adds to. */
    record: varchar("record", { length: 80 }).notNull(),
    /** Stable while the label changes: what copy and workflows name. */
    key: varchar("key", { length: 40 }).notNull(),
    label: varchar("label", { length: 80 }).notNull(),
    kind: varchar("kind", { length: 8 }).notNull(),
    /** A choice's options, in order. */
    options: jsonb("options").$type<CustomOption[]>(),
    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_custom_fields" }),
    // Leads with owner, so it serves the owner's foreign key too.
    unique("uq_custom_fields_key").on(t.owner, t.record, t.key).nullsNotDistinct(),
    foreignKey({
      columns: [t.owner],
      foreignColumns: [clients.id],
      name: "fk_custom_fields_owner",
    }).onDelete("cascade"),
    oneOf("ck_custom_fields_kind", t.kind, CUSTOM_KINDS),
    check("ck_custom_fields_key", sql`${t.key} ~ '^[a-z][a-z0-9_]*$'`),
  ],
);
export type CustomField = typeof customFields.$inferSelect;

export const customFieldValues = pgTable(
  "custom_field_values",
  {
    field: uuid("field").notNull(),
    /** The record's key, as text. */
    row: text("row").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.field, t.row], name: "pk_custom_field_values" }),
    foreignKey({
      columns: [t.field],
      foreignColumns: [customFields.id],
      name: "fk_custom_field_values_field",
    }).onDelete("cascade"),
  ],
);

export const customValues = pgTable(
  "custom_values",
  {
    id: uuid("id").defaultRandom().notNull(),
    owner: varchar("owner", { length: 40 }),
    key: varchar("key", { length: 40 }).notNull(),
    label: varchar("label", { length: 80 }).notNull(),
    value: varchar("value", { length: 2000 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_custom_values" }),
    unique("uq_custom_values_key").on(t.owner, t.key).nullsNotDistinct(),
    foreignKey({
      columns: [t.owner],
      foreignColumns: [clients.id],
      name: "fk_custom_values_owner",
    }).onDelete("cascade"),
    check("ck_custom_values_key", sql`${t.key} ~ '^[a-z][a-z0-9_]*$'`),
  ],
);
export type CustomValue = typeof customValues.$inferSelect;
