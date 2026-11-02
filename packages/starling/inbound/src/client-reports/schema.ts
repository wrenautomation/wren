/**
 * Client reports (designs/2026-10-09-client-reports.md): what each report carries and to whom,
 * and every run kept. Main only: the runs read across clients.
 */
import { oneOf } from "@wren/db/columns";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { REPORT_EVERY, type ReportEvery, type ReportLine, type ReportTileId } from "./tiles.js";

export const clientReports = pgTable(
  "client_reports",
  {
    id: serial("id"),
    client: varchar("client", { length: 64 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    tiles: jsonb("tiles").$type<ReportTileId[]>().notNull(),
    every: varchar("every", { length: 8, enum: REPORT_EVERY }).$type<ReportEvery>().notNull(),
    zone: varchar("zone", { length: 64 }).notNull(),
    /** Members' addresses. */
    recipients: jsonb("recipients").$type<string[]>().default([]).notNull(),
    on: boolean("on").default(true).notNull(),
    /** When its chain wakes next; null while off. */
    nextAt: timestamp("next_at", { withTimezone: true }),
    by: varchar("by", { length: 320 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_client_reports" }),
    index("ix_client_reports_client").on(t.client),
    oneOf("ck_client_reports_every", t.every, REPORT_EVERY),
  ],
);
export type ClientReport = typeof clientReports.$inferSelect;

/** One run: the period read, its numbers as the whole workspace sees them, and who got mail. */
export const clientReportSends = pgTable(
  "client_report_sends",
  {
    id: serial("id"),
    reportId: integer("report_id").notNull(),
    from: timestamp("from", { withTimezone: true }).notNull(),
    to: timestamp("to", { withTimezone: true }).notNull(),
    /** A scheduled run of a closed period; false for Run now (the period so far). */
    closed: boolean("closed").notNull(),
    lines: jsonb("lines").$type<ReportLine[]>().notNull(),
    sentTo: jsonb("sent_to").$type<string[]>().default([]).notNull(),
    /** Why nobody got mail, said on the page. */
    why: text("why"),
    by: varchar("by", { length: 320 }),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_client_report_sends" }),
    index("ix_client_report_sends_report").on(t.reportId, t.at),
    foreignKey({
      columns: [t.reportId],
      foreignColumns: [clientReports.id],
      name: "fk_client_report_sends_report",
    }).onDelete("cascade"),
  ],
);
export type ClientReportSend = typeof clientReportSends.$inferSelect;
