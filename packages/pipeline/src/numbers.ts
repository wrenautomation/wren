/**
 * The numbers (designs/2026-10-19-business-map.md): reads of the views in `views.ts` and of the
 * deals, as the CLI and the `pipeline.number` record show them. Nothing here writes.
 *
 * Per node of the newest shape: arrived, skipped, left, open now, median days there; per edge:
 * crossings; per source node: opened, deals, collected, cost; per plan node: deals, collected and
 * scheduled; per offer: the same by offer. A window cuts the daily views by day: 7, 30, 90 days
 * or all.
 *
 * A newest version on the metro model answers per line, station and track instead of per node and
 * edge (`metroRowsOf`). The numbers are the graph's numbers under the ids that carry over: a
 * station is its node, a plain or back track is its edge, a hub track is the sum of the source
 * edges its entries name, an out line is its source, an offer line is its offer, one row for each
 * currency (as the graph's offer rows are). The views read the `run` column of a version, the
 * graph the runtime runs, so a metro version has crossings like any other.
 *
 * A graph newest that the map can draw keeps its node and edge rows and adds the metro rows after
 * them, so the Map reads stations and tracks by id whatever the model. The hub has no node: its
 * row counts the leads (`leadsOf`).
 *
 * Each node also has a value from the trail chain (`chain.ts`): its chance to reach the goal and the
 * moves it takes, pooled over the versions in the window, by the default valuer. A move that
 * passed a node is a `skip` row, `from` to `to`; the default skip rule marks it `express`, and a
 * node that many pass `optional`. A filter can name another valuer or skip rule by id.
 *
 * Cost is Meta's spend on an `ads` source's campaign, in the ad account's currency; the views do
 * not convert, so a source on two currencies would add them. One currency per workspace holds today.
 */
import { profiles } from "@wren/core/profiles-schema";
import type { Queryable } from "@wren/db";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { chainOf, type Move } from "./chain.js";
import { type SkipRule, skipRuleOf, valuerOf } from "./chain-methods.js";
import { isMetro, type MetroBody, placesOf } from "./metro.js";
import { DROPPED, edgeIdOf, isSource, type ShapeBody } from "./model.js";
import { scheduleOf } from "./schedule.js";
import { journeys, pipelineDeals, termsVersions } from "./schema.js";
import { newestShape } from "./store.js";
import { drawnOf, runOf } from "./stored.js";
import { edgeFlow, moveFlow, nodeCounts, sourceNumbers } from "./views.js";

export type NumberWindow = 7 | 30 | 90 | "all";

interface NumbersFilter {
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
  /** The node valuer and the skip rule by id (`chain-methods.ts`). Left out: the defaults. */
  valuer?: string;
  skipRule?: string;
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

export async function moveFlowOf(db: Queryable, f: NumbersFilter = {}) {
  const r = rangeOf(f);
  return db
    .select()
    .from(moveFlow)
    .where(
      and(
        r.from ? gte(moveFlow.day, r.from) : undefined,
        r.to ? lte(moveFlow.day, r.to) : undefined,
      ),
    )
    .orderBy(moveFlow.version, moveFlow.day, moveFlow.fromNode, moveFlow.toNode);
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
async function medianDaysOf(db: Queryable, f: NumbersFilter = {}): Promise<Map<string, number>> {
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

/**
 * The people who are leads: profiles that are not merged into another and hold no deal of any
 * status. The hub station shows this count; the hub holds no journey.
 */
export async function leadsOf(db: Queryable): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(profiles)
    .where(
      and(
        isNull(profiles.mergedInto),
        sql`not exists (select 1 from ${pipelineDeals} where ${pipelineDeals.profileId} = ${profiles.id})`,
      ),
    );
  return r?.n ?? 0;
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
async function offerNumbersOf(db: Queryable, f: NumbersFilter = {}): Promise<OfferNumber[]> {
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

interface PlanNumber {
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

/**
 * Node, edge and offer rows for a graph; line, station, track and offer rows for a metro body.
 * Skip rows for both.
 */
type NumberKind = "node" | "edge" | "offer" | "station" | "track" | "line" | "skip";
/** One row of the `pipeline.number` record. */
export interface NumberRow {
  id: string;
  kind: NumberKind;
  /** The node, station, edge, track, line or offer id. */
  label: string;
  /** The node's or station's name, the edge or track as `from to`, the line's label, the offer id. */
  name: string;
  /** Position in the newest shape (a node or station, from `depths`); 0 for the rest. */
  position: number;
  /** Node and station rows: the kind of node it is (a station: the node it lowers to). */
  nodeKind: string | null;
  arrived: number | null;
  skipped: number | null;
  left: number | null;
  /** Open journeys at the node now. */
  now: number | null;
  medianDays: number | null;
  /** Node and station rows: the chance to reach the goal from here, 0 to 1 (1 at the goal). */
  reach: number | null;
  /** Node and station rows: the moves to the goal of the people who reach it. */
  steps: number | null;
  /** `optional` on a node or station many pass; `express` on a skip many make. */
  mark: "optional" | "express" | null;
  /** Edge and track rows; a skip row: the people who made the skip. */
  crossings: number | null;
  from: string | null;
  to: string | null;
  /** Source node and out line rows. */
  opened: number | null;
  /** Source, plan, offer and line rows. */
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
  reach: null,
  steps: null,
  mark: null,
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

/**
 * The rows of a metro newest version, from the rows of the graph it lowers to: lines first, then
 * stations, then tracks. Pure. The ids carry over (see the header), so every number is read, none
 * is worked out again. A track into the hub reads every source edge of its out line. With a
 * `source` filter only that out line, its station and the offer lines stay, as for a graph.
 * The hub has no node: its row carries `leads` as `now` (null when not counted), and a `source`
 * filter leaves it out.
 */
export function metroRowsOf(
  metro: MetroBody,
  graph: readonly NumberRow[],
  offers: readonly OfferNumber[],
  f: NumbersFilter = {},
  leads: number | null = null,
): NumberRow[] {
  const nodes = new Map(graph.filter((r) => r.kind === "node").map((r) => [r.label, r] as const));
  const edges = graph.filter((r) => r.kind === "edge");
  const edgeBy = new Map(edges.map((r) => [r.label, r] as const));
  const labelOf = new Map(metro.stations.map((s) => [s.id, s.label] as const));
  const hubs = new Set(metro.stations.filter((s) => s.kind === "hub").map((s) => s.id));
  const outIds = metro.lines.filter((l) => l.tier === "out").map((l) => l.id);
  const out: NumberRow[] = [];

  for (const l of metro.lines) {
    const base = { id: `line:${l.id}`, kind: "line" as const, label: l.id, name: l.label };
    if (l.tier === "out") {
      if (f.source && l.id !== f.source) continue;
      out.push({ ...(nodes.get(l.id) ?? blank), ...base, position: 0, nodeKind: null });
      continue;
    }
    // One row for each currency, as the graph's offer rows: two currencies are never added.
    const mine = l.offer === undefined ? [] : offers.filter((o) => o.offer === l.offer);
    if (l.offer === undefined || mine.length === 0) {
      out.push({
        ...blank,
        ...base,
        position: 0,
        ...(l.offer === undefined ? {} : { deals: 0, collected: 0, scheduled: 0 }),
      });
      continue;
    }
    for (const o of mine)
      out.push({
        ...blank,
        ...base,
        id: `line:${l.id}:${o.currency}`,
        position: 0,
        deals: o.deals,
        collected: money(o.collectedCents),
        scheduled: money(o.scheduledCents),
        currency: o.currency,
      });
  }

  for (const s of metro.stations) {
    if (s.kind === "hub") {
      if (!f.source)
        out.push({
          ...blank,
          id: `station:${s.id}`,
          kind: "station",
          label: s.id,
          name: s.label,
          position: 0,
          nodeKind: "hub",
          now: leads,
        });
      continue;
    }
    const node = nodes.get(s.id);
    if (!node) continue;
    out.push({ ...node, id: `station:${s.id}`, kind: "station", label: s.id, name: s.label });
  }

  if (f.source) return out;
  for (const t of metro.tracks) {
    // The graph edges this track stands for.
    const own = hubs.has(t.from)
      ? (t.entries ?? outIds).map((entry) => edgeBy.get(edgeIdOf(entry, t.to)))
      : hubs.has(t.to)
        ? edges.filter((r) => r.from === t.from)
        : [edgeBy.get(t.id)];
    const found = own.filter((r): r is NumberRow => r !== undefined);
    const last = found.reduce<string | null>(
      (m, r) => (r.last && (!m || r.last > m) ? r.last : m),
      null,
    );
    out.push({
      ...blank,
      id: `track:${t.id}`,
      kind: "track",
      label: t.id,
      name: `${labelOf.get(t.from) ?? t.from} to ${labelOf.get(t.to) ?? t.to}`,
      position: 0,
      crossings: found.reduce((n, r) => n + (r.crossings ?? 0), 0),
      from: t.from,
      to: t.to,
      last,
    });
  }
  return out;
}

/** All the numbers as rows: per node and edge of the newest shape (per line, station and track on the metro model), per offer. */
export async function numberRows(db: Queryable, f: NumbersFilter = {}): Promise<NumberRow[]> {
  const newest = await newestShape(db);
  const [counts, flow, moved, sources, offers, medians, now] = await Promise.all([
    nodeCountsOf(db, f),
    edgeFlowOf(db, f),
    moveFlowOf(db, f),
    sourceNumbersOf(db, f),
    offerNumbersOf(db, f),
    medianDaysOf(db, f),
    openNowOf(db),
  ]);
  const rows: NumberRow[] = [];
  if (newest) {
    // The graph the runtime runs; a metro body is lowered. Positions are graph depths for a
    // graph and places (worked out here) for a metro body.
    const depths = isMetro(newest.body) ? placesOf(newest.body) : newest.depths;
    const body = runOf(newest.body);
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
    const trail = trailOf(body, moved, f);
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
      const v = trail.values.get(n.id);
      rows.push({
        ...base,
        reach: v?.reach ?? null,
        steps: v?.steps ?? null,
        mark: trail.rule.ring({ skipped: t?.skipped ?? 0, arrived: t?.arrived ?? 0 })
          ? "optional"
          : null,
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
    // Same numbers, under the metro model's names. A metro newest answers only these rows. A
    // graph newest keeps its node and edge rows and adds these after them when it draws.
    const leads = f.source ? null : await leadsOf(db);
    if (isMetro(newest.body)) {
      const graphRows = rows.splice(0);
      rows.push(...metroRowsOf(newest.body, graphRows, offers, f, leads));
    } else {
      const drawn = drawnOf(newest.body);
      if (drawn.ok) rows.push(...metroRowsOf(drawn.metro, [...rows], offers, f, leads));
    }
    // Node ids are station ids, so a skip row reads the same on either model.
    if (!f.source) rows.push(...skipRowsOf(body, trail.skips, total, trail.rule));
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

/** The trail chain of the moves in the window: each node's value, the skips, the skip rule. */
function trailOf(
  body: ShapeBody,
  moved: readonly (typeof moveFlow.$inferSelect)[],
  f: NumbersFilter,
) {
  const sum = new Map<string, Move & { last: string | null }>();
  for (const m of moved) {
    if (!m.toNode) continue;
    const k = `${m.fromNode ?? ""}>${m.toNode}`;
    const t = sum.get(k) ?? { from: m.fromNode, to: m.toNode, moves: 0, skips: 0, last: null };
    t.moves += m.moves ?? 0;
    t.skips += m.skips ?? 0;
    if (m.day && (!t.last || m.day > t.last)) t.last = m.day;
    sum.set(k, t);
  }
  const moves = [...sum.values()];
  return {
    values: valuerOf(f.valuer).values(chainOf(body, moves)),
    skips: moves.filter((m) => m.from !== null && m.to !== DROPPED && m.skips > 0),
    rule: skipRuleOf(f.skipRule),
  };
}

/** A row per skip made: from a node over one or more to another, with the people who made it. */
function skipRowsOf(
  body: ShapeBody,
  skips: readonly (Move & { last: string | null })[],
  total: ReadonlyMap<string, { left: number }>,
  rule: SkipRule,
): NumberRow[] {
  const names = new Map(body.nodes.map((n) => [n.id, n.name] as const));
  return skips
    .filter((m) => names.has(m.from ?? "") && names.has(m.to))
    .map((m) => {
      const from = m.from ?? "";
      const left = total.get(from)?.left ?? 0;
      return {
        ...blank,
        id: `skip:${edgeIdOf(from, m.to)}`,
        kind: "skip" as const,
        label: edgeIdOf(from, m.to),
        name: `${names.get(from)} over to ${names.get(m.to)}`,
        position: 0,
        mark: rule.arc({ skips: m.skips, left }) ? ("express" as const) : null,
        crossings: m.skips,
        from,
        to: m.to,
        last: m.last,
      };
    });
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
