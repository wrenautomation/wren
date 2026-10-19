/**
 * Journeys and the shape (designs/2026-10-19-business-map.md). One schema, `pipeline`, in every
 * workspace DB.
 *
 * - `offer_versions`, `terms_versions`, `shape_versions`: append only (`never_edited` trigger).
 * - `shape_versions`: the business as one directed graph; every edit is a version.
 * - `funnels`, `funnel_versions`: the old funnels, kept as history. Nothing reads them; the shape
 *   replaced them (migration 0307 dropped the journey columns that pointed at them).
 * - `journeys`: one person on the shape. A cache of the spine events with subject `journey:<id>`.
 * - `deals`: made when a journey reaches an offer node.
 */
import { profiles } from "@wren/core/profiles-schema";
import { oneOf } from "@wren/db/columns";
import type { Icp, Offer, Terms } from "@wren/offers";
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
import type { Crossing, ShapeBody } from "./model.js";

export const pipeline = pgSchema("pipeline");

export const FUNNEL_STATUSES = ["live", "off"] as const;
export type FunnelStatus = (typeof FUNNEL_STATUSES)[number];
export const JOURNEY_STATUSES = ["open", "done", "dropped"] as const;
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];
export const DEAL_STATUSES = ["open", "won", "lost", "ended"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

/** Each published shape of a registry offer. Synced by hash against the newest version only: a change back to an older shape is the next number. */
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
    /** The old funnel body. History only: nothing reads it. */
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
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

/** Each saved shape of the business. Numbers count up from 1; a version never changes. */
export const shapeVersions = pipeline.table(
  "shape_versions",
  {
    number: integer("number").notNull(),
    body: jsonb("body").$type<ShapeBody>().notNull(),
    /** `depthOf(body)`, written by the store: SQL readers read a column, not a recursive query. */
    depths: jsonb("depths").$type<Record<string, number>>().notNull(),
    note: text("note").notNull(),
    /** The version this one was saved from. Null for the first. */
    parent: integer("parent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.number], name: "pk_shape_versions" }),
    foreignKey({
      columns: [t.parent],
      foreignColumns: [t.number],
      name: "fk_shape_versions_parent_shape_versions",
    }),
    index("ix_shape_versions_parent").on(t.parent),
  ],
);
export type ShapeVersion = typeof shapeVersions.$inferSelect;

export const journeys = pipeline.table(
  "journeys",
  {
    id: uuid("id").defaultRandom().notNull(),
    profileId: integer("profile_id").notNull(),
    /** The shape version number it is on now. */
    version: integer("version").notNull(),
    /** A node id of that version. */
    node: varchar("node", { length: 40 }).notNull(),
    /** Each edge it crossed, in order. Rebuilt from the events like the rest of the row. */
    trail: jsonb("trail").$type<Crossing[]>().notNull().default(sql`'[]'::jsonb`),
    status: varchar("status", { length: 7, enum: JOURNEY_STATUSES }).notNull().default("open"),
    dropReason: text("drop_reason"),
    /** The source node id that opened it (`manual` when none claims it). */
    entry: varchar("entry", { length: 40 }).notNull(),
    /** The cause that opened it: touch id, campaign, `/go/` path, `loop` (the journey it came from). */
    entryRef: jsonb("entry_ref").$type<Record<string, unknown>>(),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
    movedAt: timestamp("moved_at", { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** The old Opportunities deal this came from (its uuid); set only by the retired fold. */
    legacyDeal: uuid("legacy_deal"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_journeys" }),
    index("ix_journeys_profile_status").on(t.profileId, t.status),
    index("ix_journeys_shape_version").on(t.version),
    // One open journey per person. The code holds an advisory lock on the profile; this is the
    // backstop that makes a second open row an error.
    uniqueIndex("uq_journeys_open").on(t.profileId).where(sql`status = 'open'`),
    // The fold makes one journey per old deal, even when two folds run at once.
    uniqueIndex("uq_journeys_legacy_deal").on(t.legacyDeal).where(sql`legacy_deal is not null`),
    foreignKey({
      columns: [t.profileId],
      foreignColumns: [profiles.id],
      name: "fk_journeys_profile_id_profiles",
    }),
    foreignKey({
      columns: [t.version],
      foreignColumns: [shapeVersions.number],
      name: "fk_journeys_shape_version",
    }),
    oneOf("ck_journeys_status", t.status, JOURNEY_STATUSES),
  ],
);
export type Journey = typeof journeys.$inferSelect;

export const pipelineDeals = pipeline.table(
  "deals",
  {
    id: uuid("id").defaultRandom().notNull(),
    /** A journey holds one deal per offer node (`uq_deals_journey_node`). */
    journey: uuid("journey").notNull(),
    /** The offer node the deal was made at. A save with `moves` sends an open deal to the new node. Null on a deal made before the shape. */
    node: varchar("node", { length: 40 }),
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
    unique("uq_deals_journey_node").on(t.journey, t.node),
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

export const RESEARCH_STATES = ["queued", "started", "read", "skipped"] as const;
export type ResearchState = (typeof RESEARCH_STATES)[number];

/**
 * Research a journey asked for on arriving at a node (the node's `research`): one row per journey
 * and node (the `stage` column holds the node id), so a replay finds it and asks nothing new. `queued` means the long run is not started
 * yet; a repeat of the step starts it. `read` is a `light` result kept here.
 */
export const journeyResearch = pipeline.table(
  "journey_research",
  {
    journey: uuid("journey").notNull(),
    stage: varchar("stage", { length: 40 }).notNull(),
    profileId: integer("profile_id").notNull(),
    /** `light` or `full`. */
    level: varchar("level", { length: 5 }).notNull(),
    state: varchar("state", { length: 7, enum: RESEARCH_STATES }).notNull().default("queued"),
    /** The offer's `icp` at the time, as context for the reader. Null when the offer has none. */
    icp: jsonb("icp").$type<Icp | null>(),
    /** `full`: the `profile_lookups` row of the run. */
    lookupId: integer("lookup_id"),
    /** `light`: the reads. */
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    /** Why it was skipped, in plain words. */
    note: text("note"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.journey, t.stage], name: "pk_journey_research" }),
    index("ix_journey_research_profile_id").on(t.profileId),
    foreignKey({
      columns: [t.journey],
      foreignColumns: [journeys.id],
      name: "fk_journey_research_journey_journeys",
    }),
    oneOf("ck_journey_research_state", t.state, RESEARCH_STATES),
    oneOf("ck_journey_research_level", t.level, ["light", "full"]),
  ],
);
export type JourneyResearch = typeof journeyResearch.$inferSelect;
