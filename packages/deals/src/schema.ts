/**
 * Opportunities (designs/2026-10-09-opportunities.md). Main database, with an owner column (null
 * is Wren's), so the board reads one place.
 *
 * - `deal_pipelines`: an owner's pipelines, each its stages in order.
 * - `deals`: one sale being worked, in one stage of one pipeline.
 * - `deal_moves`: every stage change, the first one included: history and time in a stage.
 */
import { clients } from "@wren/core/clients";
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/** What landing in a stage means: still being worked, a sale, or gone. */
export const STAGE_KINDS = ["open", "won", "lost"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];
export interface Stage {
  /** Stable while its label changes: what deals and workflows name. */
  key: string;
  label: string;
  kind: StageKind;
}

/** Where a deal came from; `source_ref` holds that thing's id. */
export const DEAL_SOURCES = ["manual", "form", "text", "booking", "call"] as const;
export type DealSource = (typeof DEAL_SOURCES)[number];

export const dealPipelines = pgTable(
  "deal_pipelines",
  {
    id: uuid("id").defaultRandom().notNull(),
    /** Whose pipeline; null is Wren's. */
    client: varchar("client", { length: 40 }),
    name: varchar("name", { length: 80 }).notNull(),
    stages: jsonb("stages").$type<Stage[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_deal_pipelines" }),
    uniqueIndex("uq_deal_pipelines_name").on(sql`coalesce(${t.client}, '')`, t.name),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_deal_pipelines_client",
    }).onDelete("cascade"),
  ],
);
export type DealPipeline = typeof dealPipelines.$inferSelect;

export const deals = pgTable(
  "deals",
  {
    id: uuid("id").defaultRandom().notNull(),
    client: varchar("client", { length: 40 }),
    pipeline: uuid("pipeline").notNull(),
    /** A key of its pipeline's stages. */
    stage: varchar("stage", { length: 40 }).notNull(),
    /** The stage's kind when it moved there. */
    status: varchar("status", { length: 4 }).notNull().default("open"),
    name: varchar("name", { length: 200 }).notNull(),
    valueCents: integer("value_cents"),
    currency: varchar("currency", { length: 3 }).notNull().default("usd"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: varchar("contact_phone", { length: 20 }),
    source: varchar("source", { length: 8 }).notNull().default("manual"),
    sourceRef: text("source_ref"),
    /** The email of who works it. */
    owner: text("owner"),
    note: text("note"),
    /** When to follow up next. */
    nextOn: date("next_on", { mode: "string" }),
    movedAt: timestamp("moved_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_deals" }),
    index("ix_deals_client_status").on(t.client, t.status),
    index("ix_deals_pipeline_stage").on(t.pipeline, t.stage),
    index("ix_deals_source").on(t.source, t.sourceRef),
    foreignKey({
      columns: [t.client],
      foreignColumns: [clients.id],
      name: "fk_deals_client",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.pipeline],
      foreignColumns: [dealPipelines.id],
      name: "fk_deals_pipeline",
    }).onDelete("cascade"),
    oneOf("ck_deals_status", t.status, STAGE_KINDS),
    oneOf("ck_deals_source", t.source, DEAL_SOURCES),
    check("ck_deals_value", sql`${t.valueCents} is null or ${t.valueCents} >= 0`),
  ],
);
export type Deal = typeof deals.$inferSelect;

export const dealMoves = pgTable(
  "deal_moves",
  {
    id: bigserial("id", { mode: "number" }).notNull(),
    deal: uuid("deal").notNull(),
    /** Null on the first move: the deal was made there. */
    from: varchar("from", { length: 40 }),
    to: varchar("to", { length: 40 }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    by: text("by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_deal_moves" }),
    index("ix_deal_moves_deal_at").on(t.deal, t.at),
    foreignKey({
      columns: [t.deal],
      foreignColumns: [deals.id],
      name: "fk_deal_moves_deal",
    }).onDelete("cascade"),
  ],
);
export type DealMove = typeof dealMoves.$inferSelect;
