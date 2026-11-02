/**
 * `ad_days`: Meta's daily ad set rows kept as they were read. A row is one ad set on one day;
 * a re-read of the same day overwrites it, so nothing is counted twice.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import type { InsightRow } from "./ads.js";
import { adDays } from "./schema.js";

const LEADS = ["lead", "onsite_conversion.lead_grouped"];

/** The lead count: Meta's rolled-up `lead`, else the instant-form one. */
export function leadsOf(row: InsightRow): number {
  for (const type of LEADS) {
    const a = row.actions?.find((x) => x.action_type === type);
    if (a) return Number(a.value) || 0;
  }
  return 0;
}

const int = (v: string | undefined) => Math.round(Number(v ?? 0)) || 0;

/** Upsert daily adset-level rows; rows without a day or an ad set are skipped. Returns rows written. */
export async function upsertAdDays(db: Queryable, rows: readonly InsightRow[]): Promise<number> {
  const values = rows
    .filter((r) => r.adset_id && r.date_start && r.date_start === (r.date_stop ?? r.date_start))
    .map((r) => ({
      day: r.date_start as string,
      adsetId: r.adset_id as string,
      campaignId: r.campaign_id ?? "",
      campaignName: r.campaign_name ?? "",
      adsetName: r.adset_name ?? "",
      currency: (r.account_currency ?? "USD").toUpperCase(),
      spend: Number(r.spend ?? 0) || 0,
      impressions: int(r.impressions),
      reach: int(r.reach),
      clicks: int(r.clicks),
      leads: leadsOf(r),
      results: (r.actions ?? []).reduce((n, a) => n + (Number(a.value) || 0), 0),
    }));
  if (values.length === 0) return 0;
  const x = (c: string) => sql.raw(`excluded.${c}`);
  await db
    .insert(adDays)
    .values(values)
    .onConflictDoUpdate({
      target: [adDays.adsetId, adDays.day],
      set: {
        campaignId: x("campaign_id"),
        campaignName: x("campaign_name"),
        adsetName: x("adset_name"),
        currency: x("currency"),
        spend: x("spend"),
        impressions: x("impressions"),
        reach: x("reach"),
        clicks: x("clicks"),
        leads: x("leads"),
        results: x("results"),
        syncedAt: sql`now()`,
      },
    });
  return values.length;
}
