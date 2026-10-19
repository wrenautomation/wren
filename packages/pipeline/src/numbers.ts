/**
 * The numbers (designs/2026-10-19-business-map.md): reads of the views in `views.ts` and of the
 * deals, as the CLI and the `pipeline.number` record show them. Nothing here writes.
 *
 * Per node of the newest shape: arrived, skipped, left, open now, median days there; per edge:
 * crossings; per source node: opened, deals, collected, cost; per plan node: deals, collected and
 * scheduled; per offer: the same by offer. A window cuts the daily views by day: 7, 30, 90 days
 * or all.
 *
 * Cost is Meta's spend on an `ads` source's campaign, in the ad account's currency; the views do
 * not convert, so a source on two currencies would add them. One currency per workspace holds today.
 */
import type { Queryable } from "@wren/db";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { isSource, type ShapeBody } from "./model.js";
import { scheduleOf } from "./schedule.js";
import { journeys, pipelineDeals, termsVersions } from "./schema.js";
import { newestShape } from "./store.js";
import { edgeFlow, nodeCounts, sourceNumbers } from "./views.js";

export type NumberWindow = 7 | 30 | 90 | "all";

export interface NumbersFilter {
  /** Only this offer's deals and plans. */
  offer?: string;
  /** Only this source node's journeys: node and edge rows drop out. */
  source?: string;
  /** The last 7, 30 or 90 days, or all. Left out is all. */
  window?: NumberWindow;
  /** `YYYY-MM-DD`, inclusive. Cut the daily views and the deals' signing day. Win over `window`. */
  from?: string;
  to?: string;
  /** For tests: what "today" is. */
  now?: Date;
}

/** The day range a filter asks for. */
export function rangeOf(f: NumbersFilter): { from?: string; to?: string } {
  let from = f.from;
  if (!from && typeof f.window === "number") {
    const d = new Date((f.now ?? new Date()).getTime() - (f.window - 1) * 86_400_000);
    from = d.toISOString().slice(0, 10);
  }
  return { ...(from ? { from } : {}), ...(f.to ? { to: f.to } : {}) };
}

export async function nodeCountsOf(db: Queryable, f: NumbersFilter = {}) {
  const r = rangeOf(f);
  return db
    .select()
    .from(nodeCounts)
    .where(
      and(
        r.from ? gte(nodeCounts.day, r.from) : undefined,
        r.to ? lte(nodeCounts.day, r.to) : undefined,
      ),
    )
    .orderBy(nodeCounts.version, nodeCounts.day, nodeCounts.node);
}

export async function edgeFlowOf(db: Queryable, f: NumbersFilter = {}) {
  const r = rangeOf(f);
  return db
    .select()
    .from(edgeFlow)
    .where(
      and(
        r.from ? gte(edgeFlow.day, r.from) : undefined,
        r.to ? lte(edgeFlow.day, r.to) : undefined,
      ),
    )
    .orderBy(edgeFlow.version, edgeFlow.day, edgeFlow.edge);
}

export async function sourceNumbersOf(db: Queryable, f: NumbersFilter = {}) {
  const r = rangeOf(f);
  return db
    .select()
    .from(sourceNumbers)
    .where(
      and(
        f.source ? eq(sourceNumbers.source, f.source) : undefined,
        r.from ? gte(sourceNumbers.day, r.from) : undefined,
        r.to ? lte(sourceNumbers.day, r.to) : undefined,
      ),
    )
    .orderBy(sourceNumbers.source, sourceNumbers.day);
}

/** Median days a journey stayed at each node it left or was dropped from, by arrival day. */
export async function medianDaysOf(
  db: Queryable,
  f: NumbersFilter = {},
): Promise<Map<string, number>> {
  const r = rangeOf(f);
  const rows = (await db.execute(sql`
    with steps as (
      select substr(e.node, 3) node, e.subject, e.at, 1 ord
      from events e
      where e.workflow ~ '^shape\\.v[0-9]+$' and e.subject like 'journey:%' and left(e.node, 2) = 's_'
        and coalesce(e.data -> 'cause' ->> 'kind', '') <> 'version'
      union all
      select d.data ->> 'node', d.subject, d.at, 2
      from events d
      where d.workflow ~ '^shape\\.v[0-9]+$' and d.node = 'dropped' and d.data ->> 'node' is not null
    ), stays as (
      select node, ord, (at at time zone 'UTC')::date as day,
        extract(epoch from lead(at) over (partition by subject order by at, ord) - at) / 86400 days
      from steps
    )
    select node, percentile_cont(0.5) within group (order by days) median
    from stays
    where ord = 1 and days is not null
      ${r.from ? sql`and day >= ${r.from}::date` : sql``}
      ${r.to ? sql`and day <= ${r.to}::date` : sql``}
    group by node`)) as unknown as { node: string; median: number }[];
  return new Map(rows.map((x) => [x.node, Number(x.median)]));
}

/** Open journeys now, per node. */
export async function openNowOf(db: Queryable): Promise<Map<string, number>> {
  const rows = await db
    .select({ node: journeys.node, n: sql<number>`count(*)::int` })
    .from(journeys)
    .where(eq(journeys.status, "open"))
    .groupBy(journeys.node);
  return new Map(rows.flatMap((x) => (x.node ? [[x.node, x.n] as const] : [])));
}

/** A deal with what the numbers need: where it was made, its terms and the journey's source. */
interface DealRow {
  node: string | null;
  offer: string;
  currency: string;
  signedAt: Date;
  collected: number;
  plan: string | null;
  terms: (typeof termsVersions.$inferSelect)["body"] | null;
}

async function dealRowsOf(db: Queryable, f: NumbersFilter): Promise<DealRow[]> {
  const r = rangeOf(f);
  return db
    .select({
      node: pipelineDeals.node,
      offer: pipelineDeals.offer,
      currency: pipelineDeals.currency,
      signedAt: pipelineDeals.signedAt,
      collected: pipelineDeals.collectedCents,
      plan: termsVersions.plan,
      terms: termsVersions.body,
    })
    .from(pipelineDeals)
    .innerJoin(journeys, eq(journeys.id, pipelineDeals.journey))
    .leftJoin(termsVersions, eq(termsVersions.id, pipelineDeals.termsVersion))
    .where(
      and(
        f.offer ? eq(pipelineDeals.offer, f.offer) : undefined,
        f.source ? eq(journeys.entry, f.source) : undefined,
        r.from ? sql`${pipelineDeals.signedAt} >= ${r.from}::date` : undefined,
        r.to ? sql`${pipelineDeals.signedAt} < (${r.to}::date + 1)` : undefined,
      ),
    );
}

const scheduledOf = (d: DealRow): number =>
  d.terms
    ? scheduleOf(d.terms, d.signedAt)
        .filter((l) => l.kind === "setup" || l.kind === "monthly")
        .reduce((sum, l) => sum + l.cents, 0)
    : 0;

export interface OfferNumber {
  offer: string;
  currency: string;
  deals: number;
  /** Deals with signed terms. */
  signed: number;
  collectedCents: number;
  /** What the signed terms bill over their schedule: setup and monthly lines. */
  scheduledCents: number;
}

/** Per offer and currency: deals, what they collected, and what their signed terms schedule. */
export async function offerNumbersOf(db: Queryable, f: NumbersFilter = {}): Promise<OfferNumber[]> {
  const out = new Map<string, OfferNumber>();
  for (const r of await dealRowsOf(db, f)) {
    const key = `${r.offer}|${r.currency}`;
    const n = out.get(key) ?? {
      offer: r.offer,
      currency: r.currency,
      deals: 0,
      signed: 0,
      collectedCents: 0,
      scheduledCents: 0,
    };
    n.deals += 1;
    n.collectedCents += r.collected;
    if (r.terms) {
      n.signed += 1;
      n.scheduledCents += scheduledOf(r);
    }
    out.set(key, n);
  }
  return [...out.values()].sort((a, b) => a.offer.localeCompare(b.offer));
}

export interface PlanNumber {
  /** The plan node's id. */
  node: string;
  deals: number;
  collectedCents: number;
  scheduledCents: number;
  currency: string | null;
}

/** The offer nodes nearest above a node: the first offer node on each flow path into it. */
function offerNodesAbove(body: ShapeBody, id: string): string[] {
  const out = new Set<string>();
  const seen = new Set([id]);
  let level = [id];
  while (level.length > 0) {
    const next: string[] = [];
    for (const at of level) {
      for (const e of body.edges) {
        if (e.kind !== "flow" || e.to !== at || seen.has(e.from)) continue;
        seen.add(e.from);
        if (body.nodes.find((n) => n.id === e.from)?.kind === "offer") out.add(e.from);
        else next.push(e.from);
      }
    }
    level = next;
  }
  return [...out];
}

/**
 * Per plan node of a shape: the deals made at the offer node above it that signed this plan's
 * terms, what they collected and what their terms schedule.
 */
export async function planNumbersOf(
  db: Queryable,
  body: ShapeBody,
  f: NumbersFilter = {},
): Promise<PlanNumber[]> {
  const deals = await dealRowsOf(db, f);
  const out: PlanNumber[] = [];
  for (const n of body.nodes) {
    if (n.kind !== "plan") continue;
    const above = new Set(offerNodesAbove(body, n.id));
    const mine = deals.filter((d) => d.node && above.has(d.node) && d.plan === n.terms);
    out.push({
      node: n.id,
      deals: mine.length,
      collectedCents: mine.reduce((s, d) => s + d.collected, 0),
      scheduledCents: mine.reduce((s, d) => s + scheduledOf(d), 0),
      currency: mine[0]?.currency ?? null,
    });
  }
  return out;
}

export type NumberKind = "node" | "edge" | "offer";
/** One row of the `pipeline.number` record. */
export interface NumberRow {
  id: string;
  kind: NumberKind;
  /** The node id, the edge id or the offer id. */
  label: string;
  /** The node's name, the edge as `from to`, the offer id. */
  name: string;
  /** Depth in the newest shape (a node, from `depths`); 0 for the rest. */
  position: number;
  /** Node rows: the node's kind. */
  nodeKind: string | null;
  arrived: number | null;
  skipped: number | null;
  left: number | null;
  /** Open journeys at the node now. */
  now: number | null;
  medianDays: number | null;
  /** Edge rows. */
  crossings: number | null;
  from: string | null;
  to: string | null;
  /** Source node rows. */
  opened: number | null;
  /** Source, plan and offer rows. */
  deals: number | null;
  collected: number | null;
  /** Plan and offer rows: what the signed terms bill over their schedule. */
  scheduled: number | null;
  cost: number | null;
  currency: string | null;
  last: string | null;
}

const money = (cents: number) => cents / 100;

const blank = {
  nodeKind: null,
  arrived: null,
  skipped: null,
  left: null,
  now: null,
  medianDays: null,
  crossings: null,
  from: null,
  to: null,
  opened: null,
  deals: null,
  collected: null,
  scheduled: null,
  cost: null,
  currency: null,
  last: null,
} as const;

/** All the numbers as rows: per node and edge of the newest shape, per offer. */
export async function numberRows(db: Queryable, f: NumbersFilter = {}): Promise<NumberRow[]> {
  const newest = await newestShape(db);
  const [counts, flow, sources, offers, medians, now] = await Promise.all([
    nodeCountsOf(db, f),
    edgeFlowOf(db, f),
    sourceNumbersOf(db, f),
    offerNumbersOf(db, f),
    medianDaysOf(db, f),
    openNowOf(db),
  ]);
  const rows: NumberRow[] = [];
  if (newest) {
    const { body, depths } = newest;
    const total = new Map<
      string,
      { arrived: number; skipped: number; left: number; last: string | null }
    >();
    for (const c of counts) {
      const k = c.node ?? "";
      const t = total.get(k) ?? { arrived: 0, skipped: 0, left: 0, last: null };
      t.arrived += c.arrived ?? 0;
      t.skipped += c.skipped ?? 0;
      t.left += c.left ?? 0;
      if (c.day && (!t.last || c.day > t.last)) t.last = c.day;
      total.set(k, t);
    }
    const plans = new Map((await planNumbersOf(db, body, f)).map((p) => [p.node, p] as const));
    const bySource = new Map<
      string,
      { opened: number; deals: number; collected: number; cost: number | null; last: string | null }
    >();
    for (const s of sources) {
      const k = s.source ?? "";
      const r = bySource.get(k) ?? { opened: 0, deals: 0, collected: 0, cost: null, last: null };
      r.opened += s.opened ?? 0;
      r.deals += s.deals ?? 0;
      r.collected += money(s.collectedCents ?? 0);
      if (s.cost !== null) r.cost = (r.cost ?? 0) + s.cost;
      if (s.day && (!r.last || s.day > r.last)) r.last = s.day;
      bySource.set(k, r);
    }
    for (const n of body.nodes) {
      if (f.source && n.id !== f.source) continue;
      const base = {
        ...blank,
        id: `node:${n.id}`,
        kind: "node" as const,
        label: n.id,
        name: n.name,
        position: depths[n.id] ?? 0,
        nodeKind: n.kind,
      };
      if (isSource(n)) {
        const s = bySource.get(n.id);
        rows.push({
          ...base,
          opened: s?.opened ?? 0,
          deals: s?.deals ?? 0,
          collected: s?.collected ?? 0,
          cost: s?.cost ?? null,
          last: s?.last ?? null,
        });
        continue;
      }
      if (f.source) continue;
      const t = total.get(n.id);
      const p = plans.get(n.id);
      rows.push({
        ...base,
        arrived: t?.arrived ?? 0,
        skipped: t?.skipped ?? 0,
        left: t?.left ?? 0,
        now: now.get(n.id) ?? 0,
        medianDays: medians.get(n.id) ?? null,
        last: t?.last ?? null,
        ...(p
          ? {
              deals: p.deals,
              collected: money(p.collectedCents),
              scheduled: money(p.scheduledCents),
              currency: p.currency,
            }
          : {}),
      });
    }
    if (!f.source) {
      const crossed = new Map<string, { n: number; last: string | null }>();
      for (const e of flow) {
        const k = e.edge ?? "";
        const t = crossed.get(k) ?? { n: 0, last: null };
        t.n += e.crossings ?? 0;
        if (e.day && (!t.last || e.day > t.last)) t.last = e.day;
        crossed.set(k, t);
      }
      const names = new Map(body.nodes.map((n) => [n.id, n.name] as const));
      for (const e of body.edges) {
        const t = crossed.get(e.id);
        rows.push({
          ...blank,
          id: `edge:${e.id}`,
          kind: "edge",
          label: e.id,
          name: `${names.get(e.from) ?? e.from} to ${names.get(e.to) ?? e.to}`,
          position: 0,
          crossings: t?.n ?? 0,
          from: e.from,
          to: e.to,
          last: t?.last ?? null,
        });
      }
    }
  }
  for (const o of offers)
    rows.push({
      ...blank,
      id: `offer:${o.offer}:${o.currency}`,
      kind: "offer",
      label: o.offer,
      name: o.offer,
      position: 0,
      deals: o.deals,
      collected: money(o.collectedCents),
      scheduled: money(o.scheduledCents),
      currency: o.currency,
    });
  return rows;
}

/** A deal's dated lines from its signed terms. Null: no such deal, or no terms signed yet. */
export async function dealScheduleOf(db: Queryable, id: string) {
  const [r] = await db
    .select({ signedAt: pipelineDeals.signedAt, terms: termsVersions.body })
    .from(pipelineDeals)
    .leftJoin(termsVersions, eq(termsVersions.id, pipelineDeals.termsVersion))
    .where(eq(pipelineDeals.id, id))
    .limit(1);
  if (!r) return null;
  return { signed: r.terms !== null, lines: r.terms ? scheduleOf(r.terms, r.signedAt) : [] };
}
