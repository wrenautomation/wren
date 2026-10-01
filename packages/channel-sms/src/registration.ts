/**
 * US numbers onto the registered 10DLC campaign, by themselves. Carriers
 * review a campaign for days; until they approve it, no US number may be
 * attached and none texts anyone (`cannotReach`). This pass, run by SmsWatch,
 * reads the campaign, asks to attach each waiting US number once it is
 * approved, and marks a number registered when the attachment lands. The
 * ramp starts that day: the days it sat waiting sent nothing.
 *
 * It never edits or resubmits the campaign: a rejection is the operator's to fix.
 */
import type { Queryable } from "@wren/db";
import { and, eq, isNull, ne } from "drizzle-orm";
import { fleetDay } from "./policy.js";
import type { CampaignState, SmsProvider } from "./provider.js";
import { smsNumbers } from "./schema.js";

export interface RegistrationStats {
  /** Null when nothing waits (no API call made) or there is no campaign to ask about. */
  campaign: CampaignState | null;
  /** Why the pass did nothing, when it did nothing. */
  skipped: string | null;
  registered: string[];
  /** Asked for this pass; the carriers attach within minutes to hours. */
  asked: string[];
  pending: string[];
  failed: string[];
}

export async function watchRegistration(
  db: Queryable,
  provider: SmsProvider,
  campaignId: string | null,
  now: Date,
): Promise<RegistrationStats> {
  const stats: RegistrationStats = {
    campaign: null,
    skipped: null,
    registered: [],
    asked: [],
    pending: [],
    failed: [],
  };
  const waiting = await db
    .select()
    .from(smsNumbers)
    .where(
      and(
        eq(smsNumbers.country, "US"),
        isNull(smsNumbers.registeredAt),
        ne(smsNumbers.state, "retired"),
      ),
    );
  if (waiting.length === 0) return { ...stats, skipped: "no US number waits" };
  const reg = provider.registration;
  if (!reg) return { ...stats, skipped: `provider ${provider.name} has no 10DLC registration` };
  if (!campaignId) return { ...stats, skipped: "no campaign set (WREN_TELNYX_CAMPAIGN_ID)" };
  try {
    stats.campaign = await reg.campaign(campaignId);
  } catch (err) {
    // A provider outage skips this pass; the rest of the watch still runs.
    return {
      ...stats,
      skipped: `campaign read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  for (const n of waiting) {
    try {
      let a = await reg.number(n.e164);
      if (a.status === "none" && stats.campaign.status === "approved") {
        a = await reg.assign(n.e164, campaignId);
        stats.asked.push(n.e164);
      }
      if (a.status === "assigned" && a.campaignId === campaignId) {
        await db
          .update(smsNumbers)
          .set({ registeredAt: now, rampStartedOn: fleetDay(now) })
          .where(eq(smsNumbers.id, n.id));
        stats.registered.push(n.e164);
      } else if (a.status === "assigned") {
        stats.failed.push(`${n.e164}: on another campaign (${a.campaignId})`);
      } else if (a.status === "failed") {
        stats.failed.push(`${n.e164}: ${a.detail ?? "assignment failed"}`);
      } else if (a.status === "pending" && !stats.asked.includes(n.e164)) {
        stats.pending.push(n.e164);
      }
    } catch (err) {
      stats.failed.push(`${n.e164}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return stats;
}
