import { companies, imports, people } from "@wren/core/schema";
import {
  date,
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

/**
 * One row per CRM record, kept whole. People dedupe (the same person twice in
 * the export is one `people` row); these rows do not, so duplicates stay visible
 * to the health report. Re-importing an export updates its rows, never doubles them.
 */
export const crmContacts = pgTable(
  "crm_contacts",
  {
    id: serial("id").notNull(),
    personId: integer("person_id").notNull(),
    companyId: integer("company_id").notNull(),
    importId: integer("import_id").notNull(),
    rowNumber: integer("row_number").notNull(),
    /** The CRM dialect it came in as: hubspot, salesforce, bullhorn, crm-generic. */
    format: varchar("format", { length: 32 }).notNull(),
    /** The CRM's own record id, else a hash of the row. */
    crmKey: varchar("crm_key", { length: 128 }).notNull(),
    /** As the CRM holds it (normalized when it parses); the health report judges it. */
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 64 }),
    /** The recruiter who owns the relationship. */
    owner: text("owner"),
    status: text("status"),
    lastContactedOn: date("last_contacted_on"),
    lastPlacementOn: date("last_placement_on"),
    addedOn: date("added_on"),
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_crm_contacts" }),
    unique("uq_crm_contacts_key").on(t.format, t.crmKey),
    index("ix_crm_contacts_person_id").on(t.personId),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [people.id],
      name: "fk_crm_contacts_person_id_people",
    }),
    foreignKey({
      columns: [t.companyId],
      foreignColumns: [companies.id],
      name: "fk_crm_contacts_company_id_companies",
    }),
    foreignKey({
      columns: [t.importId],
      foreignColumns: [imports.id],
      name: "fk_crm_contacts_import_id_imports",
    }),
  ],
);

export type CrmContact = typeof crmContacts.$inferSelect;
