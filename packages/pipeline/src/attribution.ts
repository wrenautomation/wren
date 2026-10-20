/**
 * Where an ad click came from, read off a cause (designs/2026-10-19-business-map.md, sources).
 *
 * A form from the lander carries the visitor's touches: the page they sent it from (`utm_*`, `r`,
 * `ref` at the top) and their first and last touch (`first_touch`, `last_touch`). `touchChannel`
 * reads a touch as a channel and campaign, as the Search app does for its numbers. The rest of
 * this file turns that into the `CauseFacts` a source matches on.
 *
 * The campaign on a paid touch is the `utm_campaign` word the link carried. Meta's insights key a
 * campaign by its numeric id, and `ad_days.campaign_id` holds that id. `adCampaignOf` finds the id
 * by id, by name or by the name as a `/go/` word, so the journey keeps both: `campaign` (the word)
 * and `adCampaign` (the id).
 */
import { touchChannel } from "@wren/core/clients";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import type { CauseFacts } from "./entry.js";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A touch as the facts a source matches on; null when it names no channel. */
export function touchFacts(t: unknown): CauseFacts | null {
  if (!isRecord(t)) return null;
  const got = touchChannel(t);
  if (!got) return null;
  const f: CauseFacts = { channel: got.channel };
  if (got.campaign) f.campaign = got.campaign;
  // The platform the link names (utm_source), when it adds to the channel: meta for an ad.
  const platform = typeof t.utm_source === "string" ? t.utm_source.trim().toLowerCase() : "";
  if (platform && platform !== got.channel) f.platform = platform;
  return f;
}

/** The two readings of a payload: the visit it was sent from, and where the person first came from. */
export interface Attribution {
  /** The page the form was sent from: top-level `utm_*`, `r`, `ref`, else the last touch. */
  cause: CauseFacts;
  /** The first touch. Null when the payload has none that names a channel. */
  first: CauseFacts | null;
}

/** Reads a form's payload. Both parts are empty or null for a payload with no touch fields. */
export function attributionOf(data: Record<string, unknown>): Attribution {
  return {
    cause: touchFacts(data) ?? touchFacts(data.last_touch) ?? {},
    first: touchFacts(data.first_touch),
  };
}

/**
 * The `ad_days.campaign_id` a campaign word names: an id as it is, a campaign's name, or its name
 * as a `/go/` word (lower case, dashes for runs of other characters). The newest day wins when two
 * campaigns share a name. Null when no insight row matches (no ad ran, or none is read yet).
 */
export async function adCampaignOf(db: Queryable, word: string): Promise<string | null> {
  const w = word.trim().toLowerCase();
  if (!w) return null;
  const rows = (await db.execute(sql`
    select campaign_id from ad_days
    where campaign_id = ${w}
       or lower(campaign_name) = ${w}
       or trim(both '-' from regexp_replace(lower(campaign_name), '[^a-z0-9]+', '-', 'g')) = ${w}
    order by day desc limit 1`)) as unknown as { campaign_id: string }[];
  return rows[0]?.campaign_id ?? null;
}

/** Facts with the ad campaign's id added when the campaign word names one. */
export async function withAdCampaign(db: Queryable, f: CauseFacts): Promise<CauseFacts> {
  if (f.channel !== "ads" || !f.campaign) return f;
  const id = await adCampaignOf(db, f.campaign);
  return id ? { ...f, adCampaign: id } : f;
}
