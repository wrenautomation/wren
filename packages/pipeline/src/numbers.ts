/**
 * The numbers (designs/2026-10-18-journeys.md, "Numbers"): reads of the views in `views.ts` and
 * of the deals, as the CLI and the `pipeline.number` record show them. Nothing here writes.
 *
 * Cost is Meta's spend on an `ads` entry's campaign, in the ad account's currency; the views do
 * not convert, so a funnel on two currencies would add them. One currency per workspace holds today.
 */
import type { Queryable } from "@wren/db";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { scheduleOf } from "./schedule.js";
import { journeys, pipelineDeals, termsVersions } from "./schema.js";
import { funnelVersionsOf } from "./store.js";
import { entryNumbers, stageCounts, stageFlow } from "./views.js";

export interface NumbersFilter {
  funnel?: string;
  entry?: string;
  offer?: string;
  /** `YYYY-MM-DD`, inclusive. Cuts the daily views and the deals' signing day. */
  from?: string;
  to?: string;
}

/** The funnels that sell an offer, by their newest version; all of them when no offer is named. */
async function funnelsFor(db: Queryable, f: NumbersFilter): Promise<string[] | null> {
  if (!f.offer) return null;
  const rows = await funnelVersionsOf(
    db,
    f.funnel ? { funnel: f.funnel, newest: true } : { newest: true },
  );
  return rows.filter((r) => r.body.offer === f.offer).map((r) => r.funnel);
}

export async function stageCountsOf(db: Queryable, f: NumbersFilter = {}) {
  const funnels = await funnelsFor(db, f);
  if (funnels && !funnels.length) return [];
  return db
    .select()
    .from(stageCounts)
    .where(
      and(
        f.funnel ? eq(stageCounts.funnel, f.funnel) : undefined,
        funnels ? inArray(stageCounts.funnel, funnels) : undefined,
        f.from ? gte(stageCounts.day, f.from) : undefined,
        f.to ? lte(stageCounts.day, f.to) : undefined,
      ),
    )
    .orderBy(stageCounts.funnel, stageCounts.version, stageCounts.day, stageCounts.stage);
}

/** Conversion between neighbouring stages. All time: a share and a median do not add by day. */
export async function stageFlowOf(db: Queryable, f: NumbersFilter = {}) {
  const funnels = await funnelsFor(db, f);
  if (funnels && !funnels.length) return [];
  return db
    .select()
    .from(stageFlow)
    .where(
      and(
        f.funnel ? eq(stageFlow.funnel, f.funnel) : undefined,
        funnels ? inArray(stageFlow.funnel, funnels) : undefined,
      ),
    );
}

export async function entryNumbersOf(db: Queryable, f: NumbersFilter = {}) {
  const funnels = await funnelsFor(db, f);
  if (funnels && !funnels.length) return [];
  return db
    .select()
    .from(entryNumbers)
    .where(
      and(
        f.funnel ? eq(entryNumbers.funnel, f.funnel) : undefined,
        f.entry ? eq(entryNumbers.entry, f.entry) : undefined,
        funnels ? inArray(entryNumbers.funnel, funnels) : undefined,
        f.from ? gte(entryNumbers.day, f.from) : undefined,
        f.to ? lte(entryNumbers.day, f.to) : undefined,
      ),
    )
    .orderBy(entryNumbers.funnel, entryNumbers.entry, entryNumbers.day);
}

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
  const rows = await db
    .select({
      offer: pipelineDeals.offer,
      currency: pipelineDeals.currency,
      signedAt: pipelineDeals.signedAt,
      collected: pipelineDeals.collectedCents,
      terms: termsVersions.body,
    })
    .from(pipelineDeals)
    .innerJoin(journeys, eq(journeys.id, pipelineDeals.journey))
    .leftJoin(termsVersions, eq(termsVersions.id, pipelineDeals.termsVersion))
    .where(
      and(
        f.offer ? eq(pipelineDeals.offer, f.offer) : undefined,
        f.funnel ? eq(journeys.funnel, f.funnel) : undefined,
        f.entry ? eq(journeys.entry, f.entry) : undefined,
        f.from ? sql`${pipelineDeals.signedAt} >= ${f.from}::date` : undefined,
        f.to ? sql`${pipelineDeals.signedAt} < (${f.to}::date + 1)` : undefined,
      ),
    );
  const out = new Map<string, OfferNumber>();
  for (const r of rows) {
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
      for (const line of scheduleOf(r.terms, r.signedAt))
        if (line.kind === "setup" || line.kind === "monthly") n.scheduledCents += line.cents;
    }
    out.set(key, n);
  }
  return [...out.values()].sort((a, b) => a.offer.localeCompare(b.offer));
}

export type NumberKind = "stage" | "entry" | "offer";
/** One row of the `pipeline.number` record. */
export interface NumberRow {
  id: string;
  kind: NumberKind;
  funnel: string | null;
  /** The stage, entry or offer this row counts. */
  label: string;
  /** Stage order in the newest version; 0 for the rest. */
  position: number;
  entered: number | null;
  skipped: number | null;
  reached: number | null;
  advanced: number | null;
  conversion: number | null;
  medianSeconds: number | null;
  opened: number | null;
  deals: number | null;
  collected: number | null;
  /** Offer rows: what the signed terms bill over their schedule. */
  scheduled: number | null;
  cost: number | null;
  currency: string | null;
  last: string | null;
}

const money = (cents: number) => cents / 100;

/** All the numbers as rows: per funnel stage, per entry, per offer. All time. */
export async function numberRows(db: Queryable, f: NumbersFilter = {}): Promise<NumberRow[]> {
  const [counts, flow, entries, offers, heads] = await Promise.all([
    stageCountsOf(db, f),
    stageFlowOf(db, f),
    entryNumbersOf(db, f),
    offerNumbersOf(db, f),
    funnelVersionsOf(db, f.funnel ? { funnel: f.funnel, newest: true } : { newest: true }),
  ]);
  const blank = {
    entered: null,
    skipped: null,
    reached: null,
    advanced: null,
    conversion: null,
    medianSeconds: null,
    opened: null,
    deals: null,
    collected: null,
    scheduled: null,
    cost: null,
    currency: null,
    last: null,
  };
  const rows: NumberRow[] = [];
  const total = new Map<string, { entered: number; skipped: number; last: string | null }>();
  for (const c of counts) {
    const k = `${c.funnel}|${c.stage}`;
    const t = total.get(k) ?? { entered: 0, skipped: 0, last: null };
    t.entered += c.entered ?? 0;
    t.skipped += c.skipped ?? 0;
    if (c.day && (!t.last || c.day > t.last)) t.last = c.day;
    total.set(k, t);
  }
  const pair = new Map(flow.map((x) => [`${x.funnel}|${x.stage}`, x]));
  for (const h of heads) {
    // Stages count journeys, not entries: an entry filter leaves them out.
    if (f.entry || (f.offer && h.body.offer !== f.offer)) continue;
    for (const [i, s] of h.body.stages.entries()) {
      const t = total.get(`${h.funnel}|${s.key}`);
      const p = pair.get(`${h.funnel}|${s.key}`);
      rows.push({
        ...blank,
        id: `stage:${h.funnel}:${s.key}`,
        kind: "stage",
        funnel: h.funnel,
        label: s.key,
        position: i + 1,
        entered: t?.entered ?? 0,
        skipped: t?.skipped ?? 0,
        reached: p?.reached ?? null,
        advanced: p?.advanced ?? null,
        conversion: p?.conversion ?? null,
        medianSeconds: p?.medianSeconds ?? null,
        last: t?.last ?? null,
      });
    }
  }
  const byEntry = new Map<string, NumberRow>();
  for (const e of entries) {
    const k = `${e.funnel}|${e.entry}`;
    const r = byEntry.get(k) ?? {
      ...blank,
      id: `entry:${e.funnel}:${e.entry}`,
      kind: "entry" as const,
      funnel: e.funnel,
      label: e.entry ?? "",
      position: 0,
      opened: 0,
      deals: 0,
      collected: 0,
      cost: null,
    };
    r.opened = (r.opened ?? 0) + (e.opened ?? 0);
    r.deals = (r.deals ?? 0) + (e.deals ?? 0);
    r.collected = (r.collected ?? 0) + money(e.collectedCents ?? 0);
    if (e.cost !== null) r.cost = (r.cost ?? 0) + e.cost;
    if (e.day && (!r.last || e.day > r.last)) r.last = e.day;
    byEntry.set(k, r);
  }
  rows.push(...byEntry.values());
  for (const o of offers)
    rows.push({
      ...blank,
      id: `offer:${o.offer}:${o.currency}`,
      kind: "offer",
      funnel: null,
      label: o.offer,
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
