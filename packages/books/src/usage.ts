/**
 * Metered spend, daily, from the provider's cost API: the early look before the
 * month's bill. AWS Cost Explorer bills each request (one a day here), so one
 * request covers every service and the last few days at once.
 */
import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import type { Db } from "@wren/db";
import { and, eq, gte, lt, max, sql } from "drizzle-orm";
import { shiftDay } from "./day.js";
import { type UsageProvider, usage } from "./schema.js";

export interface UsageDay {
  on: string;
  service: string;
  currency: string;
  /** Exact decimal string, as the provider gives it. */
  amount: string;
}

/** Spend per day and service for `[from, to)`. */
export type UsageFeed = (from: string, to: string) => Promise<UsageDay[]>;

/** AWS Cost Explorer (us-east-1 only), unblended cost grouped by service. */
export function awsCostExplorer(
  client: CostExplorerClient = new CostExplorerClient({ region: "us-east-1" }),
): UsageFeed {
  return async (from, to) => {
    const out: UsageDay[] = [];
    let token: string | undefined;
    do {
      const page = await client.send(
        new GetCostAndUsageCommand({
          TimePeriod: { Start: from, End: to },
          Granularity: "DAILY",
          Metrics: ["UnblendedCost"],
          GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
          NextPageToken: token,
        }),
      );
      for (const day of page.ResultsByTime ?? [])
        for (const g of day.Groups ?? []) {
          const cost = g.Metrics?.UnblendedCost;
          const service = g.Keys?.[0];
          if (!day.TimePeriod?.Start || !service || !cost?.Amount) continue;
          out.push({
            on: day.TimePeriod.Start,
            service,
            currency: cost.Unit ?? "USD",
            amount: cost.Amount,
          });
        }
      token = page.NextPageToken;
    } while (token);
    return out;
  };
}

/** Days fetched again each pass: Cost Explorer revises a day for about two more. */
export const SETTLE_DAYS = 3;

export interface UsageIngest {
  from: string;
  to: string;
  rows: number;
}

/**
 * Upsert the provider's spend from the last settled day (or `since`, the
 * first time) through yesterday. Today is left out: it is still running.
 */
export async function ingestUsage(
  db: Db,
  provider: UsageProvider,
  feed: UsageFeed,
  opts: { since: string; on: string },
): Promise<UsageIngest> {
  const [row] = await db
    .select({ last: max(usage.on) })
    .from(usage)
    .where(eq(usage.provider, provider));
  const from = row?.last ? maxDay(shiftDay(row.last, 1 - SETTLE_DAYS), opts.since) : opts.since;
  const to = opts.on;
  if (from >= to) return { from, to, rows: 0 };
  const days = await feed(from, to);
  if (days.length)
    await db
      .insert(usage)
      .values(days.map((d) => ({ ...d, provider })))
      .onConflictDoUpdate({
        target: [usage.on, usage.provider, usage.service],
        set: {
          amount: sql`excluded.amount`,
          currency: sql`excluded.currency`,
          fetchedAt: sql`now()`,
        },
      });
  return { from, to, rows: days.length };
}

const maxDay = (a: string, b: string) => (a > b ? a : b);

/** A day counts as a spike past both: twice the usual, and this much more. */
export const SPIKE_FACTOR = 2;
export const SPIKE_FLOOR = 0.5;
/** "The usual" is the mean of this many days before. */
export const SPIKE_BASELINE_DAYS = 14;

export interface Spike {
  on: string;
  service: string;
  currency: string;
  amount: number;
  usual: number;
}

/** Services whose spend on `on` is a spike against the days before it. */
export async function usageSpikes(db: Db, provider: UsageProvider, on: string): Promise<Spike[]> {
  const from = shiftDay(on, -SPIKE_BASELINE_DAYS);
  const rows = await db
    .select({
      service: usage.service,
      currency: usage.currency,
      amount: sql<string>`sum(${usage.amount}) FILTER (WHERE ${usage.on} = ${on})`,
      usual: sql<string>`coalesce(sum(${usage.amount}) FILTER (WHERE ${usage.on} < ${on}), 0) / ${SPIKE_BASELINE_DAYS}`,
    })
    .from(usage)
    .where(and(eq(usage.provider, provider), gte(usage.on, from), lt(usage.on, shiftDay(on, 1))))
    .groupBy(usage.service, usage.currency);
  return rows
    .map((r) => ({
      on,
      service: r.service,
      currency: r.currency,
      amount: Number(r.amount ?? 0),
      usual: Number(r.usual),
    }))
    .filter((r) => r.amount >= r.usual * SPIKE_FACTOR && r.amount - r.usual >= SPIKE_FLOOR)
    .sort((a, b) => b.amount - a.amount);
}

export interface UsageMonth {
  service: string;
  currency: string;
  /** This month through `on` (exclusive). */
  sofar: number;
  /** Last month over the same days. */
  before: number;
}

/** Spend per service this month so far, beside the same days of last month. */
export async function usageMonth(
  db: Db,
  provider: UsageProvider,
  on: string,
): Promise<UsageMonth[]> {
  const start = `${on.slice(0, 8)}01`;
  const lastStart = shiftMonth(start, -1);
  const lastEnd = shiftMonth(on, -1);
  const rows = await db
    .select({
      service: usage.service,
      currency: usage.currency,
      sofar: sql<string>`coalesce(sum(${usage.amount}) FILTER (WHERE ${usage.on} >= ${start}), 0)`,
      before: sql<string>`coalesce(sum(${usage.amount}) FILTER (WHERE ${usage.on} < ${lastEnd}), 0)`,
    })
    .from(usage)
    .where(and(eq(usage.provider, provider), gte(usage.on, lastStart), lt(usage.on, on)))
    .groupBy(usage.service, usage.currency);
  return rows
    .map((r) => ({ ...r, sofar: Number(r.sofar), before: Number(r.before) }))
    .filter((r) => r.sofar > 0 || r.before > 0)
    .sort((a, b) => b.sofar - a.sofar);
}

/** `day` a month earlier or later, clamped to that month's last day. */
export function shiftMonth(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}
