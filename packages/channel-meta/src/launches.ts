/**
 * The `ad_launches` ledger and the one judgement `AdsWatch` makes over it:
 * an ad set that has spent the guard amount with nothing to show (no clicks,
 * no results) gets paused. Conservative on purpose — it only ever stops
 * spend, never starts it, and one pause is one line to the channel.
 */
import type { Db } from "@wren/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { InsightRow, Launched, LaunchSpec } from "./ads.js";
import { type AdLaunch, adLaunches } from "./schema.js";

export async function recordLaunch(
  db: Db,
  r: { adAccountId: string; spec: LaunchSpec; launched: Launched },
): Promise<AdLaunch> {
  const [row] = await db
    .insert(adLaunches)
    .values({
      name: r.spec.name,
      adAccountId: r.adAccountId,
      campaignId: r.launched.campaignId,
      adsetId: r.launched.adsetId,
      creativeId: r.launched.creativeId,
      adId: r.launched.adId,
      spec: r.spec,
      status: r.launched.status === "ACTIVE" ? "active" : "paused",
      dailyBudgetUsd: r.launched.dailyBudgetUsd,
      ...(r.launched.status === "ACTIVE" ? { startedAt: new Date() } : {}),
    })
    .returning();
  if (!row) throw new Error("ad_launches: insert returned nothing");
  return row;
}

/** `start` happened: the row is active with the budget it was started at. Unknown campaign = no row (a launch made elsewhere). */
export async function markStarted(
  db: Db,
  campaignId: string,
  dailyBudgetUsd: number,
  now = new Date(),
): Promise<AdLaunch | null> {
  const [row] = await db
    .update(adLaunches)
    .set({ status: "active", dailyBudgetUsd, startedAt: now, stoppedAt: null, stopReason: null })
    .where(eq(adLaunches.campaignId, campaignId))
    .returning();
  return row ?? null;
}

export async function markStopped(
  db: Db,
  campaignId: string,
  reason: string | null = null,
  now = new Date(),
): Promise<AdLaunch | null> {
  const [row] = await db
    .update(adLaunches)
    .set({ status: "stopped", stoppedAt: now, stopReason: reason })
    .where(eq(adLaunches.campaignId, campaignId))
    .returning();
  return row ?? null;
}

export const activeLaunches = (db: Db): Promise<AdLaunch[]> =>
  db.select().from(adLaunches).where(eq(adLaunches.status, "active"));

export const listLaunches = (db: Db, limit = 50): Promise<AdLaunch[]> =>
  db.select().from(adLaunches).orderBy(desc(adLaunches.createdAt)).limit(limit);

export const launchesByCampaign = (db: Db, campaignIds: string[]): Promise<AdLaunch[]> =>
  campaignIds.length === 0
    ? Promise.resolve([])
    : db
        .select()
        .from(adLaunches)
        .where(and(inArray(adLaunches.campaignId, campaignIds)));

const when = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "-");

export function formatLaunches(rows: AdLaunch[]): string[] {
  if (rows.length === 0) return ["no launches"];
  return rows.map(
    (r) =>
      `${r.campaignId}  ${r.status.padEnd(7)}  $${r.dailyBudgetUsd.toFixed(2)}/day  started ${when(r.startedAt)}  stopped ${when(r.stoppedAt)}  ${r.name}${r.stopReason ? `  (${r.stopReason})` : ""}`,
  );
}

/** What an ad set did over the watched window, from one adset-level insight row. */
export interface AdsetResult {
  adsetId: string;
  campaignId: string | null;
  spendUsd: number;
  clicks: number;
  /** Every counted action (link clicks, leads, purchases …) summed. */
  results: number;
}

export function resultOf(row: InsightRow): AdsetResult | null {
  if (!row.adset_id) return null;
  return {
    adsetId: row.adset_id,
    campaignId: row.campaign_id ?? null,
    spendUsd: Number(row.spend ?? 0),
    clicks: Number(row.clicks ?? 0),
    results: (row.actions ?? []).reduce((n, a) => n + Number(a.value ?? 0), 0),
  };
}

export interface Verdict {
  launch: AdLaunch;
  result: AdsetResult;
  /** Set when the ad set should be paused; the reason as the channel reads it. */
  pause: string | null;
}

/**
 * The guard: spend ≥ `pauseAfterUsd` in the window with zero clicks and zero
 * results = pause. Anything with a click or a result stays on — a person
 * reads the numbers and decides. Launches with no insight row are untouched
 * (nothing delivered yet).
 */
export function judge(
  launches: AdLaunch[],
  rows: InsightRow[],
  o: { pauseAfterUsd: number },
): Verdict[] {
  const byAdset = new Map<string, AdsetResult>();
  for (const row of rows) {
    const r = resultOf(row);
    if (r) byAdset.set(r.adsetId, r);
  }
  const out: Verdict[] = [];
  for (const launch of launches) {
    const result = byAdset.get(launch.adsetId);
    if (!result) continue;
    const dead = result.clicks === 0 && result.results === 0;
    const pause =
      dead && result.spendUsd >= o.pauseAfterUsd
        ? `spent $${result.spendUsd.toFixed(2)} with no clicks or results (guard $${o.pauseAfterUsd})`
        : null;
    out.push({ launch, result, pause });
  }
  return out;
}

export function formatVerdicts(vs: Verdict[]): string[] {
  if (vs.length === 0) return ["no active launches delivered"];
  return vs.map(
    (v) =>
      `${v.launch.name}: $${v.result.spendUsd.toFixed(2)} spent, ${v.result.clicks} clicks, ${v.result.results} results${v.pause ? ` → PAUSED (${v.pause})` : ""}`,
  );
}
