/** The lander's numbers as console records (views in `./schema.ts`). UI off since 11-04. */

import { touchChannel } from "@wren/core/clients";
import {
  cued,
  date,
  defineRecord,
  money,
  number,
  rate,
  type State,
  status,
  text,
} from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { type SiteReplay, siteExport } from "@wren/starling-email";
import { sql } from "drizzle-orm";
import { firstChannels } from "./flag-days.js";
import type { HeatWidth } from "./schema.js";

const neutral = (label: string): State => ({ label, tone: "neutral" });
const SITE_CHANNEL_STATES = cued({
  email: neutral("Email"),
  sms: neutral("Texts"),
  ads: neutral("Ads"),
  content: neutral("Content"),
  search: neutral("Search"),
  reach: neutral("Reach"),
  other: neutral("Other"),
  direct: neutral("Direct"),
});
const siteDayRecord = defineRecord({
  id: "marketing.site_day",
  app: "campaigns",
  channel: null,
  name: { one: "site day", many: "site days" },
  view: "marketing_site_day_records",
  key: "id",
  title: "channel",
  subtitle: "campaign",
  fields: {
    channel: status(SITE_CHANNEL_STATES, "First touch"),
    campaign: text(),
    day: date(),
    visits: number(),
    firstTouches: number("New visitors"),
    forms: number(),
    bookings: number("Booking clicks"),
    watchPlays: number("Video views"),
    calls: number("Calls booked"),
    paid: number(),
    booked: rate("visits", "Visit to booking click", { from: "bookings" }),
    age: status(
      { week: neutral("Last 7 days"), month: neutral("Last 30 days"), earlier: neutral("Earlier") },
      "When",
    ),
  },
  views: [
    { id: "week", label: "Last 7 days", where: { age: "week" }, sort: "-day", at: "day" },
    { id: "month", label: "Last 30", where: { age: ["week", "month"] }, sort: "-day", at: "day" },
    { id: "channel", label: "By channel", sort: "channel", at: "day" },
  ],
});

/** Each channel's funnel by first touch (designs/2026-10-06-signals.md). */
export const funnelRecord = defineRecord({
  id: "marketing.funnel",
  app: "campaigns",
  channel: null,
  name: { one: "funnel", many: "funnels" },
  view: "marketing_funnel_records",
  key: "id",
  title: "channel",
  fields: {
    channel: status(SITE_CHANNEL_STATES, "First touch"),
    window: status(
      { "30d": neutral("Last 30 days"), "90d": neutral("Last 90 days"), all: neutral("All time") },
      "Window",
    ),
    visitors: number("New visitors"),
    forms: number(),
    calls: number("Calls booked"),
    paid: number(),
    toForm: rate("visitors", "Visitor to form", { from: "forms" }),
    toCall: rate("forms", "Form to call", { from: "calls" }),
    toPaid: rate("calls", "Call to paid", { from: "paid" }),
  },
  views: [
    { id: "30d", label: "Last 30 days", where: { window: "30d" }, sort: "-visitors" },
    { id: "90d", label: "Last 90 days", where: { window: "90d" }, sort: "-visitors" },
    { id: "all", label: "All time", where: { window: "all" }, sort: "-visitors" },
  ],
});

/** Each `/go/` link's day: who came by it and what they did after, first and last touch. */
const linkDayRecord = defineRecord({
  id: "marketing.link_day",
  app: "campaigns",
  channel: null,
  name: { one: "link day", many: "link days" },
  view: "marketing_link_day_records",
  key: "id",
  title: "postTitle",
  subtitle: "campaign",
  fields: {
    postTitle: text("Post"),
    source: text("Source"),
    campaign: text(),
    content: text("Link", { listed: false }),
    day: date(),
    clicks: number("Visitors"),
    hops: number("YouTube hops"),
    formsFirst: number("Forms (first touch)"),
    formsLast: number("Forms (last touch)", { listed: false }),
    callsFirst: number("Calls (first touch)"),
    callsLast: number("Calls (last touch)", { listed: false }),
    wonFirst: number("Won (first touch)"),
    wonLast: number("Won (last touch)", { listed: false }),
    revenueFirst: money("Revenue (first touch)"),
    revenueLast: money("Revenue (last touch)"),
    toForm: rate("clicks", "Visitor to form", { from: "forms_first" }),
    post: text("Post id", { listed: false }),
    age: status(
      { week: neutral("Last 7 days"), month: neutral("Last 30 days"), earlier: neutral("Earlier") },
      "When",
      { listed: false },
    ),
  },
  views: [
    { id: "month", label: "Last 30", where: { age: ["week", "month"] }, sort: "-day", at: "day" },
    {
      id: "posts",
      label: "From posts",
      where: { post: { empty: false } },
      sort: "-day",
      at: "day",
    },
    { id: "all", label: "All", sort: "-day", at: "day" },
  ],
});

export const SITE_RECORDS = [siteDayRecord, funnelRecord, linkDayRecord];

/** Where sessions come from: the lander's export, and a short signed GET per chunk. */
interface SessionSource {
  site: Parameters<typeof siteExport>[1];
  signGet: (key: string) => Promise<string>;
}

const chunkKey = (view: string, seq: number) =>
  `site/replays/${view}/${String(seq).padStart(4, "0")}.json`;
const parsed = (json: string | null | undefined): Record<string, unknown> | null => {
  try {
    return json ? (JSON.parse(json) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * Each recorded view on the lander (`marketing.session`), read live from its export and never
 * stored here: the 09-29 rule keeps visitor ids out of wren. Opening one signs its chunks.
 * ponytail: the export is re-read per list; filter it by date once replays pass a few thousand.
 */
export const sessionRecord = (src: SessionSource) =>
  defineRecord({
    id: "marketing.session",
    app: "campaigns",
    channel: null,
    name: { one: "session", many: "sessions" },
    rows: async () => {
      const [replays, apps] = await Promise.all([
        siteExport("replays", src.site),
        siteExport("applications", src.site),
      ]);
      const applied = new Map(apps.filter((a) => a.visitor).map((a) => [a.visitor, a.offer]));
      return replays.map((r) => {
        const first = touchChannel(parsed(r.first_touch) ?? {});
        return {
          id: r.view,
          page: r.page,
          started: r.started,
          secs: Math.max(0, Math.round((Date.parse(r.last) - Date.parse(r.started)) / 1000)),
          device: r.w == null ? null : r.w < 840 ? "phone" : "desktop",
          country: r.country || null,
          channel: first?.channel ?? (r.first_touch ? "other" : "direct"),
          campaign: first?.campaign ?? null,
          applied: (r.visitor && applied.get(r.visitor)) || null,
          chunks: r.chunks,
          kb: Math.round(r.bytes / 1024),
        };
      });
    },
    key: "id",
    title: "page",
    subtitle: "channel",
    fields: {
      page: text(),
      started: date("When"),
      secs: number("Seconds"),
      device: status({ phone: neutral("Phone"), desktop: neutral("Desktop") }),
      country: text(),
      channel: status(SITE_CHANNEL_STATES, "First touch"),
      campaign: text(),
      applied: text("Applied for"),
      chunks: number(),
      kb: number("KB"),
    },
    views: [
      { id: "recent", label: "Recent", sort: "-started", at: "started" },
      { id: "applied", label: "Applied", where: { applied: { empty: false } }, sort: "-started" },
    ],
    load: async (_db, view) => {
      const replay = (await siteExport("replays", src.site)).find(
        (r: SiteReplay) => r.view === view,
      );
      if (!replay) return null;
      const urls = await Promise.all(
        Array.from({ length: replay.chunks }, (_, i) => src.signGet(chunkKey(view, i))),
      );
      return { replay: { urls } };
    },
  });

/**
 * Each answer to a site survey (`marketing.survey_answer`), words and all, read live from the
 * lander's export and never stored here (the 09-29 rule); `survey_days` keeps the counts.
 */
export const surveyAnswerRecord = (site: SessionSource["site"]) =>
  defineRecord({
    id: "marketing.survey_answer",
    app: "campaigns",
    channel: null,
    name: { one: "answer", many: "survey answers" },
    rows: async () => {
      const [answers, hits] = await Promise.all([
        siteExport("answers", site),
        siteExport("hits", site),
      ]);
      const touch = firstChannels(hits);
      return answers.map((a) => ({
        id: String(a.id),
        survey: a.survey,
        value: a.value,
        page: a.page,
        channel: touch.get(a.visitor) ?? "direct",
        at: a.ts,
      }));
    },
    key: "id",
    title: "value",
    subtitle: "survey",
    fields: {
      survey: text("Survey"),
      value: text("Answer"),
      page: text(),
      channel: status(SITE_CHANNEL_STATES, "First touch"),
      at: date("When"),
    },
    views: [{ id: "recent", label: "Newest", sort: "-at", at: "at" }],
  });

/** The lander's width buckets (`src/scripts/hit.ts`), for a replay's recorded width. */
export const widthOf = (w: number): HeatWidth =>
  w < 768 ? "phone" : w < 1024 ? "tablet" : w < 1440 ? "laptop" : "wide";
const WINDOW_DAYS: Record<string, number> = { "7d": 7, "30d": 30 };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** One page's heatmap: clicks per element path and grid cell, views per tenth, a page to draw on. */
export interface Heat {
  cells: { path: string; cell: number; clicks: number; rage: number }[];
  bands: number[];
  /** The newest recorded view of the page at this width: its first chunk, signed. */
  snapshot: { url: string; w: number } | null;
}

async function heatOf(
  db: Queryable,
  id: string,
  src: SessionSource | undefined,
): Promise<{ heat: Heat } | null> {
  const [window = "", width = "", ...rest] = id.split(":");
  const page = rest.join(":");
  const days = WINDOW_DAYS[window];
  // "7d" and "30d" up to today, or one day ("2026-10-08").
  const when = days
    ? sql`day > current_date - ${days}::int`
    : DAY.test(window)
      ? sql`day = ${window}::date`
      : null;
  if (!when || !page) return null;
  const [cells, bands] = await Promise.all([
    db.execute(sql`SELECT path, cell, sum(clicks)::int clicks, sum(rage)::int rage FROM heat_days
      WHERE page = ${page} AND width = ${width} AND ${when}
      GROUP BY path, cell ORDER BY clicks DESC LIMIT 5000`),
    db.execute(sql`SELECT band, sum(views)::int views FROM scroll_days
      WHERE page = ${page} AND width = ${width} AND ${when} GROUP BY band`),
  ]);
  const byBand = Array.from({ length: 10 }, () => 0);
  for (const b of bands as unknown as { band: number; views: number }[]) byBand[b.band] = b.views;
  let snapshot: Heat["snapshot"] = null;
  if (src) {
    const newest = (await siteExport("replays", src.site))
      .filter((r) => r.page === page && r.w != null && widthOf(r.w) === width && r.chunks > 0)
      .sort((a, b) => (a.started < b.started ? 1 : -1))[0];
    if (newest?.w) snapshot = { url: await src.signGet(chunkKey(newest.view, 0)), w: newest.w };
  }
  return { heat: { cells: cells as unknown as Heat["cells"], bands: byBand, snapshot } };
}

/**
 * Each page's heatmap per width (`marketing.heat`). Opening one reads its clicks and scroll
 * bands, and signs the newest replay of that page at that width to draw them on. Without the
 * export or the bucket (`src`), the counts still show.
 */
export const heatRecord = (src?: SessionSource) =>
  defineRecord({
    id: "marketing.heat",
    app: "campaigns",
    channel: null,
    name: { one: "heatmap", many: "heatmaps" },
    view: "marketing_heat_records",
    key: "id",
    title: "page",
    subtitle: "width",
    fields: {
      page: text(),
      width: status(
        {
          phone: neutral("Phone"),
          tablet: neutral("Tablet"),
          laptop: neutral("Laptop"),
          wide: neutral("Wide"),
        },
        "Width",
      ),
      window: status(
        { "1d": neutral("One day"), "7d": neutral("Last 7 days"), "30d": neutral("Last 30 days") },
        "Window",
      ),
      day: date("Day"),
      views: number(),
      clicks: number(),
      rage: number("Rage clicks"),
    },
    views: [
      { id: "7d", label: "Last 7 days", where: { window: "7d" }, sort: "-views" },
      { id: "30d", label: "Last 30 days", where: { window: "30d" }, sort: "-views" },
      // One row per page, width and day: pick a day or a range in the date filter.
      { id: "day", label: "By day", where: { window: "1d" }, sort: "-day", at: "day" },
    ],
    load: (db, id) => heatOf(db, id, src),
  });
