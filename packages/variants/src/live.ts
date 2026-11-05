/**
 * A subject's live numbers per segment: each sample's rates with a 95% range and P(best) among
 * the samples shipped to the same channel. Rates come from `outcomes` (latest day per ship).
 */
import type { Db } from "@wren/db";
import { pBest, posteriors } from "@wren/experiments";
import { eq, inArray, sql } from "drizzle-orm";
import { POST_MEANS } from "./collect.js";
import { type Channel, outcomes, samples, ships } from "./schema.js";

/** Each channel's rates: wins over shown. The first is the one the page leads with. */
export const RATES: Record<Channel, readonly { name: string; wins: string; of: string }[]> = {
  post: [
    { name: "engaged", wins: "engaged", of: "views" },
    { name: "likes", wins: "likes", of: "views" },
    { name: "comments", wins: "comments", of: "views" },
    { name: "shares", wins: "shares", of: "views" },
    { name: "follows", wins: "follows", of: "views" },
    { name: "clicks", wins: "link_clicks", of: "views" },
  ],
  site: [
    { name: "forms", wins: "form", of: "view" },
    { name: "books", wins: "book", of: "view" },
    { name: "clicks", wins: "cta", of: "view" },
  ],
  email: [
    { name: "replies", wins: "replies", of: "sends" },
    { name: "booked", wins: "booked", of: "sends" },
  ],
};

/** Wilson 95% range: honest at small n, never past 0 or 1. */
export function wilson(k: number, n: number): [number, number] {
  if (n <= 0) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - r) / d), Math.min(1, (c + r) / d)];
}

export interface LiveRate {
  wins: number;
  of: number;
  rate: number | null;
  lo: number;
  hi: number;
  /** Among this channel's samples in this segment; null with one sample. */
  pBest: number | null;
}

export interface LiveRow {
  sample: number;
  channel: Channel;
  segment: string;
  ships: number;
  totals: Record<string, number>;
  /** Post means weighted by views (avg_view_pct, hold_3s, ...). */
  means: Record<string, number>;
  rates: Record<string, LiveRate>;
}

export async function live(db: Db, subjectId: number) {
  const shipRows = await db
    .select({ id: ships.id, sample: ships.sampleId, channel: ships.channel })
    .from(ships)
    .innerJoin(samples, eq(samples.id, ships.sampleId))
    .where(eq(samples.subjectId, subjectId));
  if (!shipRows.length) return { segments: [] as string[], rows: [] as LiveRow[], rates: RATES };
  const byShip = new Map(shipRows.map((s) => [s.id, s]));
  // latest day per ship, segment, metric
  const got = await db
    .selectDistinctOn([outcomes.shipId, outcomes.segment, outcomes.metric], {
      ship: outcomes.shipId,
      segment: outcomes.segment,
      metric: outcomes.metric,
      value: outcomes.value,
    })
    .from(outcomes)
    .where(
      inArray(
        outcomes.shipId,
        shipRows.map((s) => s.id),
      ),
    )
    .orderBy(outcomes.shipId, outcomes.segment, outcomes.metric, sql`${outcomes.day} desc`);

  // sample × channel × segment
  const acc = new Map<string, { row: LiveRow; shipIds: Set<number> }>();
  for (const o of got) {
    const s = byShip.get(o.ship);
    if (!s) continue;
    const key = `${s.sample}|${s.channel}|${o.segment}`;
    let a = acc.get(key);
    if (!a) {
      a = {
        row: {
          sample: s.sample,
          channel: s.channel,
          segment: o.segment,
          ships: 0,
          totals: {},
          means: {},
          rates: {},
        },
        shipIds: new Set(),
      };
      acc.set(key, a);
    }
    a.shipIds.add(o.ship);
    if (!(POST_MEANS as readonly string[]).includes(o.metric))
      a.row.totals[o.metric] = (a.row.totals[o.metric] ?? 0) + o.value;
  }
  // means: weight each ship's value by its views; one pass per ship keeps it exact
  const viewsOf = new Map<string, number>();
  for (const o of got) if (o.metric === "views") viewsOf.set(`${o.ship}|${o.segment}`, o.value);
  for (const a of acc.values()) {
    a.row.ships = a.shipIds.size;
    const sums: Record<string, { w: number; v: number }> = {};
    for (const o of got) {
      const s = byShip.get(o.ship);
      if (!s || !a.shipIds.has(o.ship) || o.segment !== a.row.segment) continue;
      if (!(POST_MEANS as readonly string[]).includes(o.metric)) continue;
      const w = viewsOf.get(`${o.ship}|${o.segment}`) ?? 0;
      const cur = sums[o.metric] ?? { w: 0, v: 0 };
      sums[o.metric] = { w: cur.w + w, v: cur.v + w * o.value };
    }
    for (const [m, x] of Object.entries(sums)) if (x.w > 0) a.row.means[m] = x.v / x.w;
    const t = a.row.totals;
    if (a.row.channel === "post")
      t.engaged = (t.likes ?? 0) + (t.comments ?? 0) + (t.shares ?? 0) + (t.saves ?? 0);
  }

  const rows = [...acc.values()].map((a) => a.row);
  // P(best) per channel × segment × rate
  const groups = new Map<string, LiveRow[]>();
  for (const r of rows) {
    const k = `${r.channel}|${r.segment}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const g of groups.values()) {
    const channel = g[0]?.channel as Channel;
    for (const rate of RATES[channel]) {
      const arms = g.map((r) => {
        const of = r.totals[rate.of] ?? 0;
        return { successes: Math.min(r.totals[rate.wins] ?? 0, of), trials: of };
      });
      const p = g.length > 1 ? pBest(posteriors(arms, 2)) : null;
      g.forEach((r, i) => {
        const { successes: wins, trials: of } = arms[i] as { successes: number; trials: number };
        const [lo, hi] = wilson(wins, of);
        r.rates[rate.name] = {
          wins,
          of,
          rate: of > 0 ? wins / of : null,
          lo,
          hi,
          pBest: p ? (p[i] ?? null) : null,
        };
      });
    }
  }
  const segments = [...new Set(rows.map((r) => r.segment))].sort((a, b) =>
    a === "all" ? -1 : b === "all" ? 1 : a.localeCompare(b),
  );
  return { segments, rows, rates: RATES };
}
