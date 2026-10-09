/**
 * The numbers a client report carries (designs/2026-10-09-client-reports.md): the Marketing
 * Overview's, read the same way (`recordsStats` on the view its tile links to, else the type's
 * first), so the mail and the Overview agree. No imports: the web reads it too.
 */

export const REPORT_TILES = [
  { id: "views", label: "Content views", record: "marketing.post", sum: "views", view: "all" },
  {
    id: "post_visits",
    label: "Site visitors from posts",
    record: "marketing.link_day",
    sum: "clicks",
    view: "posts",
  },
  {
    id: "ad_impressions",
    label: "Ad impressions",
    record: "marketing.ad_day",
    sum: "impressions",
    view: "campaign",
  },
  {
    id: "search_impressions",
    label: "Search impressions",
    record: "marketing.search_day",
    sum: "impressions",
    view: "all",
  },
  {
    id: "visits",
    label: "Site visits",
    record: "marketing.site_day",
    sum: "visits",
    view: "channel",
  },
  { id: "forms", label: "Forms", record: "marketing.site_day", sum: "forms", view: "channel" },
  {
    id: "bookings",
    label: "Booking clicks",
    record: "marketing.site_day",
    sum: "bookings",
    view: "channel",
  },
  { id: "calls", label: "Calls booked", record: "marketing.site_day", sum: "calls", view: "30d" },
  { id: "paid", label: "Paid", record: "marketing.site_day", sum: "paid", view: "30d" },
  { id: "spend", label: "Ad spend", record: "marketing.ad_day", sum: "spend", view: "campaign" },
] as const;
export type ReportTile = (typeof REPORT_TILES)[number];
export type ReportTileId = ReportTile["id"];
export const REPORT_TILE_IDS = REPORT_TILES.map((t) => t.id) as [ReportTileId, ...ReportTileId[]];

/** Weekly on Monday, or monthly on the 1st. */
export const REPORT_EVERY = ["week", "month"] as const;
export type ReportEvery = (typeof REPORT_EVERY)[number];
export const EVERY_NAMES: Record<ReportEvery, string> = {
  week: "Every Monday, for the week before",
  month: "On the 1st, for the month before",
};

/** The hour a report runs, in its zone. */
export const REPORT_HOUR = 9;
export const MAX_RECIPIENTS = 10;
export const MAX_REPORTS = 20;

/** One number in a run: this period, the one before, and its currency when it is money. */
export interface ReportLine {
  tile: ReportTileId;
  label: string;
  value: number | null;
  prior: number | null;
  currency: string | null;
  /** Why it has no number: the read failed. */
  error?: string;
}

/** "+12%", "-3%", "new" or null when there's nothing to compare. */
export function changeOf(l: Pick<ReportLine, "value" | "prior">): string | null {
  if (l.value === null || l.prior === null) return null;
  if (l.prior === 0) return l.value === 0 ? null : "new";
  const pct = Math.round(((l.value - l.prior) / l.prior) * 100);
  return pct === 0 ? "same" : `${pct > 0 ? "+" : ""}${pct}%`;
}

/** A line's number as people read it: "1,234", "$560". */
export function shown(l: Pick<ReportLine, "value" | "currency">, locale = "en-US"): string {
  if (l.value === null) return "—";
  if (l.currency)
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: l.currency,
      maximumFractionDigits: 0,
    }).format(l.value);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(l.value);
}
