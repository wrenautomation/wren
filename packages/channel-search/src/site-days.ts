/**
 * `site_days`: the lander's export rolled up per day, first-touch channel and campaign. Every
 * visit, form and booking click counts under the channel its visitor first came from. The
 * whole export is re-read and each day upserted, so a re-read never double counts.
 */
import type { SiteApplication, SiteHit } from "@wren/channel-email";
import { touchChannel } from "@wren/core/clients";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { type SiteChannel, siteDays } from "./schema.js";

export type SiteDayRow = Omit<typeof siteDays.$inferInsert, "syncedAt">;
interface Source {
  channel: SiteChannel;
  campaign: string;
}

const isTouch = (h: SiteHit) => Boolean(h.r || h.utm_source || h.ref);
const sourceOf = (t: Record<string, unknown>): Source => {
  const got = touchChannel(t);
  return got
    ? { channel: got.channel, campaign: (got.campaign ?? "").slice(0, 100) }
    : { channel: "other", campaign: "" };
};
const DIRECT: Source = { channel: "direct", campaign: "" };

/** Day rows from every hit and application the lander holds. */
export function rollupSite(
  hits: readonly SiteHit[],
  applications: readonly SiteApplication[],
): SiteDayRow[] {
  const sorted = [...hits].sort((a, b) => a.id - b.id);
  // A hit without a visitor (no cookie) is its own visitor.
  const who = (h: { id: number; visitor: string | null }, kind: string) =>
    h.visitor ?? `${kind}:${h.id}`;
  const first = new Map<string, Source>();
  const firstDay = new Map<string, string>();
  for (const h of sorted) {
    const v = who(h, "hit");
    if (!firstDay.has(v)) firstDay.set(v, h.ts.slice(0, 10));
    if (!first.has(v) && isTouch(h))
      first.set(v, sourceOf(h as unknown as Record<string, unknown>));
  }
  const rows = new Map<string, SiteDayRow>();
  const row = (day: string, s: Source) => {
    const key = `${day}|${s.channel}|${s.campaign}`;
    let r = rows.get(key);
    if (!r) {
      r = { day, ...s, visits: 0, firstTouches: 0, forms: 0, bookings: 0, watchPlays: 0 };
      rows.set(key, r);
    }
    return r;
  };
  const visited = new Set<string>();
  for (const h of sorted) {
    const v = who(h, "hit");
    const day = h.ts.slice(0, 10);
    const r = row(day, first.get(v) ?? DIRECT);
    if (!visited.has(`${day}|${v}`)) {
      visited.add(`${day}|${v}`);
      r.visits += 1;
      if (firstDay.get(v) === day) r.firstTouches += 1;
    }
    if (h.page.startsWith("/book/")) r.bookings += 1;
    if (h.page.startsWith("/watch/")) r.watchPlays += 1;
  }
  for (const a of applications) {
    let own: Record<string, unknown> | null = null;
    try {
      own = a.first_touch ? (JSON.parse(a.first_touch) as Record<string, unknown>) : null;
    } catch {}
    const s = own ? sourceOf(own) : (first.get(who(a, "app")) ?? DIRECT);
    row(a.ts.slice(0, 10), s).forms += 1;
  }
  return [...rows.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Upsert day rows. Returns rows written. */
export async function upsertSiteDays(db: Queryable, rows: readonly SiteDayRow[]): Promise<number> {
  const x = (c: string) => sql.raw(`excluded.${c}`);
  // ponytail: one statement per 1000 rows; the whole history is a few thousand rows at most.
  for (let i = 0; i < rows.length; i += 1000)
    await db
      .insert(siteDays)
      .values(rows.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: [siteDays.day, siteDays.channel, siteDays.campaign],
        set: {
          visits: x("visits"),
          firstTouches: x("first_touches"),
          forms: x("forms"),
          bookings: x("bookings"),
          watchPlays: x("watch_plays"),
          syncedAt: sql`now()`,
        },
      });
  return rows.length;
}
