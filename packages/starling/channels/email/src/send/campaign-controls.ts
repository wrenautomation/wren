/**
 * The console's per-campaign overrides of the send policy (`campaign_controls`): read once per
 * tick and merged by `SendPolicy.withCampaigns`, written by EmailConsole. A value equal to the env
 * default is stored as null, so an override always differs from env, and a toggle's undo lands
 * back where it started.
 */
import type { Queryable } from "@wren/db";
import { eq, sql } from "drizzle-orm";
import { type CampaignControlRow, campaignControls } from "../schema.js";
import type { SendPolicy } from "./policy.js";

export const loadCampaignControls = (db: Queryable): Promise<CampaignControlRow[]> =>
  db.select().from(campaignControls);

/** `policy` as the console has it now: env, then each campaign's overrides. */
export const campaignPolicy = async (db: Queryable, policy: SendPolicy): Promise<SendPolicy> =>
  policy.withCampaigns(await loadCampaignControls(db));

export interface CampaignChange {
  campaign: string;
  /** Absent = as it is; null = back to the env default. */
  killSwitch?: boolean | null | undefined;
  openersPerDay?: number | null | undefined;
}

/** Write one campaign's overrides over the env policy `base`; returns the stored row. */
export async function setCampaignControl(
  db: Queryable,
  base: SendPolicy,
  change: CampaignChange,
  by: string,
): Promise<CampaignControlRow> {
  const { campaign } = change;
  const [current] = await db
    .select()
    .from(campaignControls)
    .where(eq(campaignControls.campaign, campaign));
  const pick = <T>(next: T | null | undefined, now: T | null, env: T | null): T | null =>
    next === undefined ? now : next === env ? null : next;
  const values = {
    killSwitch: pick(change.killSwitch, current?.killSwitch ?? null, base.killSwitchOn(campaign)),
    openersPerDay: pick(
      change.openersPerDay,
      current?.openersPerDay ?? null,
      base.nicheOpenerCap(campaign),
    ),
    updatedAt: sql`now()`,
    updatedBy: by,
  };
  const [row] = await db
    .insert(campaignControls)
    .values({ campaign, ...values })
    .onConflictDoUpdate({ target: campaignControls.campaign, set: values })
    .returning();
  if (!row) throw new Error(`campaign ${campaign}: upsert returned nothing`);
  return row;
}
