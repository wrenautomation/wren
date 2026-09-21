/**
 * What `wren ads` launched, as rows: the spec, the four ids, the budget and
 * when it was started and stopped. `AdsWatch` reads the started ones; a
 * person reads the rest back without Ads Manager.
 */
import { baseColumns, oneOf } from "@wren/db/columns";
import { index, jsonb, pgTable, real, timestamp, varchar } from "drizzle-orm/pg-core";
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
    index("ix_ad_launches_status").on(t.status),
    index("ix_ad_launches_campaign_id").on(t.campaignId),
    oneOf("ck_ad_launches_status", t.status, LAUNCH_STATUSES),
  ],
);

export type AdLaunch = typeof adLaunches.$inferSelect;
