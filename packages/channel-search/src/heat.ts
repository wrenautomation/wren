/**
 * Heatmaps (designs/2026-10-06-flags-experiments-surveys-heatmaps.md): the lander's `click`,
 * `rage` and `scroll` events rolled up per day, page and width into `heat_days` and
 * `scroll_days`. Counts only. The pass reads events after a cursor and recomputes every day it
 * read in full, so a re-read overwrites and never adds.
 */
import type { SiteEvent } from "@wren/channel-email";
import { atomic, type Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { HEAT_WIDTHS, type HeatWidth, heatDays, scrollDays } from "./schema.js";

export type HeatDayRow = Omit<typeof heatDays.$inferSelect, "syncedAt">;
export type ScrollDayRow = Omit<typeof scrollDays.$inferSelect, "syncedAt">;

const WIDTHS = new Set<string>(HEAT_WIDTHS);
const props = (e: SiteEvent): Record<string, unknown> => {
  try {
    const p = JSON.parse(e.props) as unknown;
    return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
/** 0 to 1 into one of 10 steps; anything else is the middle. */
const step = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(9, Math.max(0, Math.floor(n * 10))) : 5;
};

/**
 * Day rows from events. `from` is the id the next pass reads after: just before the newest day
 * seen, whose events may still be arriving. Null when there were none.
 */
export function rollupHeat(events: readonly SiteEvent[]): {
  heat: HeatDayRow[];
  scroll: ScrollDayRow[];
  from: number | null;
} {
  const heat = new Map<string, HeatDayRow>();
  // Each view's deepest point, per day: a view sends `scroll` again when it got further.
  const deepest = new Map<string, { day: string; page: string; width: HeatWidth; pct: number }>();
  let newest = "";
  let newestFirst = 0;
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    const day = e.ts.slice(0, 10);
    if (day > newest) {
      newest = day;
      newestFirst = e.id;
    }
    if (e.name !== "click" && e.name !== "rage" && e.name !== "scroll") continue;
    const p = props(e);
    const width = String(p.b ?? "");
    if (!WIDTHS.has(width)) continue;
    const page = e.page.slice(0, 200);
    if (e.name === "scroll") {
      const pct = Math.min(100, Math.max(0, Number(p.pct) || 0));
      const key = `${day}|${e.view}`;
      const was = deepest.get(key);
      if (!was || pct > was.pct) deepest.set(key, { day, page, width: width as HeatWidth, pct });
      continue;
    }
    const path = typeof p.path === "string" ? p.path.slice(0, 300) : "";
    if (!path) continue;
    const cell = step(p.fy) * 10 + step(p.fx);
    const key = `${day}|${page}|${width}|${path}|${cell}`;
    let r = heat.get(key);
    if (!r) {
      r = { day, page, width: width as HeatWidth, path, cell, clicks: 0, rage: 0 };
      heat.set(key, r);
    }
    if (e.name === "click") r.clicks += 1;
    else r.rage += 1;
  }
  const scroll = new Map<string, ScrollDayRow>();
  for (const v of deepest.values()) {
    // Reaching 35% means the first four tenths were on screen.
    const last = Math.min(9, Math.max(0, Math.ceil(v.pct / 10) - 1));
    for (let band = 0; band <= last; band++) {
      const key = `${v.day}|${v.page}|${v.width}|${band}`;
      const r = scroll.get(key) ?? { day: v.day, page: v.page, width: v.width, band, views: 0 };
      r.views += 1;
      scroll.set(key, r);
    }
  }
  return {
    heat: [...heat.values()],
    scroll: [...scroll.values()],
    from: events.length ? newestFirst - 1 : null,
  };
}

/** Replace the days the rows cover with the rows. Returns rows written. */
export async function writeHeatDays(
  db: Queryable,
  rows: { heat: readonly HeatDayRow[]; scroll: readonly ScrollDayRow[] },
): Promise<number> {
  const days = [...new Set([...rows.heat, ...rows.scroll].map((r) => r.day))];
  if (!days.length) return 0;
  const list = sql.join(
    days.map((d) => sql`${d}::date`),
    sql`, `,
  );
  await atomic(db, async (tx) => {
    // A day re-read in full: a cell or band it no longer has goes too.
    await tx.execute(sql`DELETE FROM heat_days WHERE day IN (${list})`);
    await tx.execute(sql`DELETE FROM scroll_days WHERE day IN (${list})`);
    for (let i = 0; i < rows.heat.length; i += 1000)
      await tx.insert(heatDays).values(rows.heat.slice(i, i + 1000));
    for (let i = 0; i < rows.scroll.length; i += 1000)
      await tx.insert(scrollDays).values(rows.scroll.slice(i, i + 1000));
  });
  return rows.heat.length + rows.scroll.length;
}
