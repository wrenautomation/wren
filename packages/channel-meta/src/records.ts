/** Ad set days as a console record for the Marketing app (`marketing_ad_day_records`). */
import { date, defineRecord, money, number, rate, status, text } from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { desc, eq } from "drizzle-orm";
import { adLaunches } from "./schema.js";

/**
 * The ad as the feed shows it: its primary text, cut where Meta's feeds cut it in 2026.
 * ponytail: the headline draws above the text, Meta puts it under the media; split it out
 * when a check needs the media's place.
 */
async function adOf(db: Queryable, campaignId: string) {
  const [launch] = await db
    .select({ spec: adLaunches.spec })
    .from(adLaunches)
    .where(eq(adLaunches.campaignId, campaignId))
    .orderBy(desc(adLaunches.createdAt))
    .limit(1);
  const c = launch?.spec.creative;
  return c
    ? {
        site: "Facebook ad",
        title: c.headline ?? null,
        text: c.message,
        feed: { laptop: 3, phone: 3 },
      }
    : null;
}

export const adDayRecord = defineRecord({
  id: "marketing.ad_day",
  name: { one: "ad set day", many: "ad set days" },
  view: "marketing_ad_day_records",
  key: "id",
  title: "adset",
  subtitle: "campaign",
  fields: {
    adset: text("Ad set"),
    campaign: text(),
    day: date(),
    spend: money(),
    impressions: number(),
    reach: number(),
    clicks: number(),
    ctr: rate("impressions", "CTR", { from: "clicks" }),
    leads: number(),
    costPerLead: number("Cost per lead"),
    state: status(
      {
        active: { label: "Running", tone: "good" },
        paused: { label: "Paused", tone: "neutral" },
        stopped: { label: "Stopped", tone: "neutral" },
      },
      "Launch",
    ),
    age: status(
      {
        week: { label: "Last 7 days", tone: "neutral" },
        month: { label: "Last 30 days", tone: "neutral" },
        earlier: { label: "Earlier", tone: "neutral" },
      },
      "When",
    ),
  },
  views: [
    { id: "week", label: "Last 7 days", where: { age: "week" }, sort: "-day", at: "day" },
    { id: "month", label: "Last 30", where: { age: ["week", "month"] }, sort: "-day", at: "day" },
    { id: "campaign", label: "By campaign", sort: "campaign", at: "day" },
  ],
  actions: ["marketing.pause", "marketing.resume"],
  load: async (db, id) => ({ post: await adOf(db, id.split("/")[0] ?? "") }),
});
