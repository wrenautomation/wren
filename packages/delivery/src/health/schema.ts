/**
 * Client health and flags in main, beside the delivery schema (designs/2026-10-07-health.md).
 * Every row hangs off a client, so it drops with them; nothing else is ever deleted.
 */
import { clients } from "@wren/core/clients";
import { oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { delivery, engagements } from "../schema.js";
import { BANDS, type HealthInput, type Part } from "./score.js";

const at = (name: string) => timestamp(name, { withTimezone: true });

/** One client's health on one day: the last pass of the day stands. Kept for good. */
export const healthDays = delivery.table(
  "health_days",
  {
    clientId: varchar("client_id", { length: 40 }).notNull(),
    /** The fleet's day. */
    day: date("day").notNull(),
    /** The model's score; null is no data. */
    score: smallint("score"),
    band: varchar("band", { length: 8, enum: BANDS }).notNull(),
    results: smallint("results"),
    engagement: smallint("engagement"),
    sentiment: smallint("sentiment"),
    money: smallint("money"),
    /** Each part's weight as it counted, adding to 100 over the parts present. */
    weights: jsonb("weights").$type<Record<Part, number>>().notNull(),
    /** Why each part reads as it does, in words. */
    why: jsonb("why").$type<Partial<Record<Part, string>>>().default({}).notNull(),
    /** Each part's newest input (ISO), where it has one. */
    ages: jsonb("ages").$type<Partial<Record<Part, string>>>().default({}).notNull(),
    /** The parts whose newest input is past its limit. */
    stale: jsonb("stale").$type<Part[]>().default([]).notNull(),
    /** Anyone on the client's side opened the portal this day. */
    visited: boolean("visited").default(false).notNull(),
    /** The override standing that day, beside the model's score. */
    override: smallint("override"),
    /** The rows behind every part. */
    inputs: jsonb("inputs").$type<HealthInput[]>().default([]).notNull(),
    at: at("at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.clientId, t.day], name: "pk_health_days" }),
    foreignKey({
      columns: [t.clientId],
      foreignColumns: [clients.id],
      name: "fk_health_days_client",
    }).onDelete("cascade"),
    oneOf("ck_health_days_band", t.band, BANDS),
  ],
);
export type HealthDay = typeof healthDays.$inferSelect;

/** An operator's 1 to 5 read of a client, kept as history; the newest counts in sentiment. */
export const healthRatings = delivery.table(
  "health_ratings",
  {
    id: serial("id").notNull(),
    clientId: varchar("client_id", { length: 40 }).notNull(),
    score: smallint("score").notNull(),
    note: text("note"),
    by: text("by").notNull(),
    at: at("at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_health_ratings" }),
    foreignKey({
      columns: [t.clientId],
      foreignColumns: [clients.id],
      name: "fk_health_ratings_client",
    }).onDelete("cascade"),
    check("ck_health_ratings_score", sql`${t.score} between 1 and 5`),
    index("ix_health_ratings_client").on(t.clientId, t.at),
  ],
);

/** A person's score over the model's, with why. One stands per client; cleared ones stay. */
export const healthOverrides = delivery.table(
  "health_overrides",
  {
    id: serial("id").notNull(),
    clientId: varchar("client_id", { length: 40 }).notNull(),
    score: smallint("score").notNull(),
    reason: text("reason").notNull(),
    by: text("by").notNull(),
    at: at("at").defaultNow().notNull(),
    clearedAt: at("cleared_at"),
    clearedBy: text("cleared_by"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_health_overrides" }),
    foreignKey({
      columns: [t.clientId],
      foreignColumns: [clients.id],
      name: "fk_health_overrides_client",
    }).onDelete("cascade"),
    check("ck_health_overrides_score", sql`${t.score} between 0 and 100`),
    uniqueIndex("uq_health_overrides_open").on(t.clientId).where(sql`cleared_at is null`),
  ],
);

export const FLAG_SIDES = ["risk", "opportunity"] as const;
export type FlagSide = (typeof FLAG_SIDES)[number];
/** Who raised it: DeliveryWatch's problems, health, or a person. */
export const FLAG_SOURCES = ["delivery", "health", "person"] as const;
export type FlagSource = (typeof FLAG_SOURCES)[number];

/**
 * One list of what needs a look about a client (designs/2026-10-07-health.md, "Flags"). The
 * `cause` dedupes: one open flag per client, engagement and cause. It clears itself when a pass
 * no longer finds its cause, unless it's `once` (an interest, a quotable review), which a person
 * clears. `delivery.flags` is not `public.flags`, the feature flags.
 */
export const clientFlags = delivery.table(
  "flags",
  {
    id: serial("id").notNull(),
    clientId: varchar("client_id", { length: 40 }).notNull(),
    engagementId: integer("engagement_id"),
    side: varchar("side", { length: 12, enum: FLAG_SIDES }).notNull(),
    source: varchar("source", { length: 12, enum: FLAG_SOURCES }).notNull(),
    /** "quiet", "step:<key>", "invoice:<id>", "health:at-risk", "person:<n>". */
    cause: varchar("cause", { length: 80 }).notNull(),
    what: text("what").notNull(),
    /** What to do, for the alert only (it may name a command); never on screen. */
    how: text("how"),
    /** A one-time cause: it never clears itself. */
    once: boolean("once").default(false).notNull(),
    /** Told on the next pass, not in the morning digest. */
    urgent: boolean("urgent").default(false).notNull(),
    /** Unaddressed, it comes back in the digest after this many days. */
    remindDays: smallint("remind_days").default(7).notNull(),
    /** A teammate's email; null is the team's. */
    owner: text("owner"),
    raisedAt: at("raised_at").defaultNow().notNull(),
    raisedBy: text("raised_by").notNull(),
    addressedAt: at("addressed_at"),
    addressedBy: text("addressed_by"),
    note: text("note"),
    clearedAt: at("cleared_at"),
    /** Who cleared it; "watch" when its cause went away. */
    clearedBy: text("cleared_by"),
    /** The last alert or digest that named it. */
    toldAt: at("told_at"),
    /** The spine heard it raised, and cleared (an outbox: set when the pass hands it over). */
    raiseFiredAt: at("raise_fired_at"),
    clearFiredAt: at("clear_fired_at"),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_flags" }),
    foreignKey({
      columns: [t.clientId],
      foreignColumns: [clients.id],
      name: "fk_flags_client",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.engagementId],
      foreignColumns: [engagements.id],
      name: "fk_flags_engagement",
    }).onDelete("cascade"),
    oneOf("ck_flags_side", t.side, FLAG_SIDES),
    oneOf("ck_flags_source", t.source, FLAG_SOURCES),
    check("ck_flags_remind", sql`${t.remindDays} between 1 and 90`),
    uniqueIndex("uq_flags_open")
      .on(t.clientId, sql`coalesce(engagement_id, 0)`, t.cause)
      .where(sql`cleared_at is null`),
    index("ix_flags_raised").on(t.raisedAt),
    index("ix_flags_client").on(t.clientId, t.raisedAt),
    index("ix_flags_engagement").on(t.engagementId),
  ],
);
export type ClientFlag = typeof clientFlags.$inferSelect;

/** One row per fleet day the flags digest went out (designs/2026-10-07-health.md, "Alerts"). */
export const flagDigests = delivery.table(
  "flag_digests",
  {
    day: date("day").notNull(),
    /** Flags it named; 0 when nothing was due, so the day's digest still counts as done. */
    flags: integer("flags").notNull(),
    at: at("at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.day], name: "pk_flag_digests" })],
);
