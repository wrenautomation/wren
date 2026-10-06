/**
 * What `wren ads` launched, as rows: the spec, the four ids, the budget and
 * when it was started and stopped. `AdsWatch` reads the started ones; a
 * person reads the rest back without Ads Manager.
 */
import { baseColumns, oneOf } from "@wren/db/columns";
import { sql } from "drizzle-orm";
import {
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  primaryKey,
  real,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import type { LaunchSpec } from "./ads.js";

export const LAUNCH_STATUSES = ["paused", "active", "stopped"] as const;
export type LaunchStatus = (typeof LAUNCH_STATUSES)[number];

export const adLaunches = pgTable(
  "ad_launches",
  {
    ...baseColumns,
    name: varchar("name", { length: 200 }).notNull(),
    adAccountId: varchar("ad_account_id", { length: 32 }).notNull(),
    campaignId: varchar("campaign_id", { length: 32 }).notNull(),
    adsetId: varchar("adset_id", { length: 32 }).notNull(),
    creativeId: varchar("creative_id", { length: 32 }).notNull(),
    adId: varchar("ad_id", { length: 32 }).notNull(),
    spec: jsonb("spec").$type<LaunchSpec>().notNull(),
    status: varchar("status", { length: 16 }).$type<LaunchStatus>().notNull().default("paused"),
    dailyBudgetUsd: real("daily_budget_usd").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    /** Why AdsWatch stopped it, when it did. */
    stopReason: varchar("stop_reason", { length: 300 }),
  },
  (t) => [
    primaryKey({ columns: [t.id], name: "pk_ad_launches" }),
    index("ix_ad_launches_status").on(t.status),
    index("ix_ad_launches_campaign_id").on(t.campaignId),
    oneOf("ck_ad_launches_status", t.status, LAUNCH_STATUSES),
  ],
);

export type AdLaunch = typeof adLaunches.$inferSelect;

/**
 * What each ad set did each day, as Meta's insights said it on the last read. Meta forgets
 * nothing, but a read is a call: `AdsWatch` keeps the 7 days it reads, so the Marketing app
 * reads rows. Upserted per ad set and day, so a re-read overwrites and never adds.
 */
export const adDays = pgTable(
  "ad_days",
  {
    day: date("day").notNull(),
    adsetId: varchar("adset_id", { length: 32 }).notNull(),
    campaignId: varchar("campaign_id", { length: 32 }).notNull(),
    campaignName: text("campaign_name").notNull(),
    adsetName: text("adset_name").notNull(),
    /** The ad account's currency (Meta's `account_currency`). */
    currency: varchar("currency", { length: 3 }).notNull(),
    spend: doublePrecision("spend").notNull(),
    impressions: integer("impressions").notNull(),
    reach: integer("reach").notNull(),
    clicks: integer("clicks").notNull(),
    /** Lead actions: instant forms and pixel leads. */
    leads: integer("leads").notNull(),
    /** Every counted action, as `AdsWatch` judges. */
    results: integer("results").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.adsetId, t.day], name: "pk_ad_days" }),
    index("ix_ad_days_day").on(t.day),
    index("ix_ad_days_campaign_id").on(t.campaignId),
  ],
);

export type AdDay = typeof adDays.$inferSelect;

/**
 * Each ad set's day (`marketing.ad_day`), keyed `<campaign>/<ad set>/<day>` so an action knows the
 * campaign. `state` is the launch's when Wren launched it, else null. `age` buckets the day:
 * `week` is the last 7 days, today counting, `month` the 23 before.
 */
export const marketingAdDayRecords = pgView("marketing_ad_day_records", {
  id: text("id"),
  day: date("day"),
  campaign: text("campaign"),
  adset: text("adset"),
  currency: text("currency"),
  spend: doublePrecision("spend"),
  impressions: integer("impressions"),
  reach: integer("reach"),
  clicks: integer("clicks"),
  leads: integer("leads"),
  costPerLead: doublePrecision("cost_per_lead"),
  state: text("state"),
  age: text("age"),
}).as(sql`
  select concat_ws('/', d.campaign_id, d.adset_id, d.day) id, d.day, d.campaign_name campaign,
    d.adset_name adset, d.currency::text currency, d.spend, d.impressions, d.reach, d.clicks,
    d.leads, round((d.spend / nullif(d.leads, 0))::numeric, 2)::float cost_per_lead,
    l.status::text state,
    case when d.day > current_date - 7 then 'week'
      when d.day > current_date - 30 then 'month' else 'earlier' end age
  from ad_days d
  left join lateral (
    select a.status from ad_launches a where a.campaign_id = d.campaign_id
    order by a.created_at desc limit 1) l on true`);
