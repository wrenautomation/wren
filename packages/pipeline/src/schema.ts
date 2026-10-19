/**
 * Journeys (designs/2026-10-18-journeys.md). One schema, `pipeline`, in every workspace DB.
 *
 * - `offer_versions`, `terms_versions`, `funnel_versions`: append only (`never_edited` trigger).
 * - `funnels`: the head of a funnel; `off` stops new journeys.
 * - `journeys`: one person in one funnel. A cache of the spine events with subject `journey:<id>`.
 * - `deals`: made when a journey reaches its funnel's sale stage.
 */
import { profiles } from "@wren/core/profiles-schema";
import { oneOf } from "@wren/db/columns";
import type { Offer, Terms } from "@wren/offers";
import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { FunnelBody } from "./model.js";

export const pipeline = pgSchema("pipeline");

export const FUNNEL_STATUSES = ["live", "off"] as const;
export type FunnelStatus = (typeof FUNNEL_STATUSES)[number];
export const JOURNEY_STATUSES = ["open", "done", "dropped"] as const;
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];
export const DEAL_STATUSES = ["open", "won", "lost", "ended"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

/** Each published shape of a registry offer. Synced by hash. */
export const offerVersions = pipeline.table(
  "offer_versions",
  {
    id: serial("id").notNull(),
    /** The registry id (`OFFERS`). No FK: the registry is code. */
    offer: varchar("offer", { length: 64 }).notNull(),
    number: integer("number").notNull(),
    /** sha256 of the canonical `Offer` JSON. */
    hash: varchar("hash", { length: 64 }).notNull(),
    body: jsonb("body").$type<Offer>().notNull(),
    why: text("why").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_offer_versions" }),
    unique("uq_offer_versions_number").on(t.offer, t.number),
    unique("uq_offer_versions_hash").on(t.offer, t.hash),
  ],
);
export type OfferVersion = typeof offerVersions.$inferSelect;

/** One plan of one offer from one date. The live one on a date: highest `number` with `effective_from <= date`. */
export const termsVersions = pipeline.table(
  "terms_versions",
  {
    id: serial("id").notNull(),
    offer: varchar("offer", { length: 64 }).notNull(),
    /** A slug: `standard`, `flat`, `partner-<n>`. */
    plan: varchar("plan", { length: 40 }).notNull(),
    number: integer("number").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    body: jsonb("body").$type<Terms>().notNull(),
    why: text("why").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_terms_versions" }),
    unique("uq_terms_versions_number").on(t.offer, t.plan, t.number),
  ],
);
export type TermsVersion = typeof termsVersions.$inferSelect;

export const funnels = pipeline.table(
  "funnels",
  {
    /** A slug. */
    id: varchar("id", { length: 40 }).notNull(),
    name: text("name").notNull(),
    status: varchar("status", { length: 4, enum: FUNNEL_STATUSES }).notNull().default("live"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_funnels" }),
    oneOf("ck_funnels_status", t.status, FUNNEL_STATUSES),
  ],
);
export type Funnel = typeof funnels.$inferSelect;

export const funnelVersions = pipeline.table(
  "funnel_versions",
  {
    id: serial("id").notNull(),
    funnel: varchar("funnel", { length: 40 }).notNull(),
    number: integer("number").notNull(),
    body: jsonb("body").$type<FunnelBody>().notNull(),
    why: text("why").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_funnel_versions" }),
    unique("uq_funnel_versions_number").on(t.funnel, t.number),
    foreignKey({
      columns: [t.funnel],
      foreignColumns: [funnels.id],
      name: "fk_funnel_versions_funnel_funnels",
    }),
  ],
);
export type FunnelVersion = typeof funnelVersions.$inferSelect;

export const journeys = pipeline.table(
  "journeys",
  {
    id: uuid("id").defaultRandom().notNull(),
    profileId: integer("profile_id").notNull(),
    funnel: varchar("funnel", { length: 40 }).notNull(),
    /** The funnel version number it is on now. */
    version: integer("version").notNull(),
    /** A stage key of that version. */
    stage: varchar("stage", { length: 40 }).notNull(),
    status: varchar("status", { length: 7, enum: JOURNEY_STATUSES }).notNull().default("open"),
    dropReason: text("drop_reason"),
    /** The entry id that opened it. */
    entry: varchar("entry", { length: 40 }).notNull(),
    /** The cause that opened it: touch id, campaign, `/go/` path, prior journey id. */
    entryRef: jsonb("entry_ref").$type<Record<string, unknown>>(),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
    movedAt: timestamp("moved_at", { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** The `@wren/deals` row this came from; set only by the fold. */
    legacyDeal: integer("legacy_deal"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_journeys" }),
    index("ix_journeys_profile_funnel_status").on(t.profileId, t.funnel, t.status),
    // One open journey per person per funnel. A person can hold journeys in many funnels.
    uniqueIndex("uq_journeys_open").on(t.profileId, t.funnel).where(sql`status = 'open'`),
    foreignKey({
      columns: [t.profileId],
      foreignColumns: [profiles.id],
      name: "fk_journeys_profile_id_profiles",
    }),
    foreignKey({
      columns: [t.funnel, t.version],
      foreignColumns: [funnelVersions.funnel, funnelVersions.number],
      name: "fk_journeys_funnel_version",
    }),
    oneOf("ck_journeys_status", t.status, JOURNEY_STATUSES),
  ],
);
export type Journey = typeof journeys.$inferSelect;

export const pipelineDeals = pipeline.table(
  "deals",
  {
    id: uuid("id").defaultRandom().notNull(),
    /** One deal per journey. */
    journey: uuid("journey").notNull(),
    profileId: integer("profile_id").notNull(),
    offer: varchar("offer", { length: 64 }).notNull(),
    /** The offer version number. */
    offerVersion: integer("offer_version").notNull(),
    /** Null until signed terms are known. */
    termsVersion: integer("terms_version"),
    signedAt: timestamp("signed_at", { withTimezone: true }).defaultNow().notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    status: varchar("status", { length: 5, enum: DEAL_STATUSES }).notNull().default("open"),
    /** A fold of the payment events about the deal. Never typed by hand. */
    collectedCents: bigint("collected_cents", { mode: "number" }).notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    /** Wren's own deals: the `delivery.engagements` row. Null in a client DB. */
    engagementId: integer("engagement_id"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_deals" }),
    unique("uq_deals_journey").on(t.journey),
    index("ix_deals_profile_id").on(t.profileId),
    index("ix_deals_terms_version").on(t.termsVersion),
    foreignKey({
      columns: [t.journey],
      foreignColumns: [journeys.id],
      name: "fk_deals_journey_journeys",
    }),
    foreignKey({
      columns: [t.profileId],
      foreignColumns: [profiles.id],
      name: "fk_deals_profile_id_profiles",
    }),
    foreignKey({
      columns: [t.termsVersion],
      foreignColumns: [termsVersions.id],
      name: "fk_deals_terms_version_terms_versions",
    }),
    oneOf("ck_deals_status", t.status, DEAL_STATUSES),
  ],
);
export type PipelineDeal = typeof pipelineDeals.$inferSelect;
