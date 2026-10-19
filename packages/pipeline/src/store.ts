/**
 * The version store (designs/2026-10-18-journeys.md): offers by hash, terms by date, funnels by
 * number. Every write is a new row; the database refuses an edit. Two writers at once cannot
 * take one number: each write holds a transaction lock on the thing it numbers.
 */
import { createHash } from "node:crypto";
import { atomic, type Queryable, type Tx } from "@wren/db";
import type { Offer, Terms } from "@wren/offers";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { carryJourneys } from "./carry.js";
import { checkFunnel, type FunnelBody, type FunnelContext } from "./model.js";
import {
  type Funnel,
  type FunnelStatus,
  type FunnelVersion,
  funnels,
  funnelVersions,
  type OfferVersion,
  offerVersions,
  type TermsVersion,
  termsVersions,
} from "./schema.js";

/** A write the rules refuse. `errors` holds every reason, in plain English. */
export class Refused extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join(" "));
    this.name = "Refused";
  }
}

const refuse = (...errors: string[]): never => {
  throw new Refused(errors);
};

/** One writer at a time per key, until the transaction ends. */
const lock = (tx: Tx, key: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);

/** JSON with sorted keys and no undefined: the same value always gives the same text. */
export function canonicalJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === "object") {
      return Object.fromEntries(
        Object.entries(x as Record<string, unknown>)
          .filter(([, y]) => y !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, y]) => [k, sort(y)]),
      );
    }
    return x;
  };
  return JSON.stringify(sort(v));
}

export const hashOf = (v: unknown): string =>
  createHash("sha256").update(canonicalJson(v)).digest("hex");

// --- offers ----------------------------------------------------------------------------------

export interface OfferSync {
  /** Versions written this run. */
  added: { offer: string; number: number }[];
  /** Registry offers whose newest version already matched. */
  unchanged: number;
}

/** Each registry offer whose hash differs from its newest version becomes the next version. Again changes nothing. */
export async function syncOffers(
  db: Queryable,
  offers: readonly Offer[],
  by: string,
): Promise<OfferSync> {
  const out: OfferSync = { added: [], unchanged: 0 };
  for (const o of offers) {
    const hash = hashOf(o);
    const result = await atomic(db, async (tx) => {
      await lock(tx, `offer_versions:${o.id}`);
      const [last] = await tx
        .select({ number: offerVersions.number, hash: offerVersions.hash })
        .from(offerVersions)
        .where(eq(offerVersions.offer, o.id))
        .orderBy(desc(offerVersions.number))
        .limit(1);
      if (last?.hash === hash) return { kind: "same" } as const;
      const number = (last?.number ?? 0) + 1;
      await tx.insert(offerVersions).values({
        offer: o.id,
        number,
        hash,
        body: JSON.parse(canonicalJson(o)) as Offer,
        why: last ? "registry changed" : "first sync",
        createdBy: by,
      });
      return { kind: "added", number } as const;
    });
    if (result.kind === "same") out.unchanged++;
    else out.added.push({ offer: o.id, number: result.number });
  }
  return out;
}

/** An offer's versions, oldest first. */
export async function offerVersionsOf(db: Queryable, offer: string): Promise<OfferVersion[]> {
  return db
    .select()
    .from(offerVersions)
    .where(eq(offerVersions.offer, offer))
    .orderBy(asc(offerVersions.number));
}

/** The newest version of each offer, by offer id. */
export async function newestOffers(db: Queryable): Promise<OfferVersion[]> {
  return db
    .selectDistinctOn([offerVersions.offer])
    .from(offerVersions)
    .orderBy(offerVersions.offer, desc(offerVersions.number));
}

// --- terms -----------------------------------------------------------------------------------

const PLAN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const dayOf = (at: string | Date): string =>
  typeof at === "string" ? at : at.toISOString().slice(0, 10);

/** What a terms body must hold to be read later. Amounts themselves are the caller's. */
export function termsProblems(t: Terms): string[] {
  const errors: string[] = [];
  if (!/^[A-Z]{3}$/.test(t.currency)) errors.push("The currency is three capital letters.");
  for (const [k, v] of [
    ["setupCents", t.setupCents],
    ["monthlyCents", t.monthlyCents],
    ["perUnitCents", t.perUnitCents],
    ["capCents", t.capCents],
    ["floorCents", t.floorCents ?? null],
  ] as const) {
    if (v !== null && (!Number.isSafeInteger(v) || v < 0)) errors.push(`${k} is whole cents.`);
  }
  if (!Number.isInteger(t.payDays) || t.payDays < 0 || t.payDays > 90)
    errors.push("payDays is 0 to 90.");
  if (t.perUnitCents !== null && !t.unit?.trim())
    errors.push("A per-unit fee needs a unit to count.");
  if (
    t.shareBps != null &&
    (!Number.isInteger(t.shareBps) || t.shareBps <= 0 || t.shareBps > 10_000)
  )
    errors.push("shareBps is 1 to 10000.");
  if (
    t.installments != null &&
    (!Number.isInteger(t.installments.count) ||
      t.installments.count < 2 ||
      !Number.isInteger(t.installments.everyDays) ||
      t.installments.everyDays <= 0)
  )
    errors.push("installments need a count of 2 or more and everyDays above 0.");
  if (t.trialDays != null && (!Number.isInteger(t.trialDays) || t.trialDays < 0))
    errors.push("trialDays is a whole number, 0 or more.");
  return errors;
}

export interface NewTerms {
  offer: string;
  plan: string;
  /** The first day it applies: YYYY-MM-DD. */
  from: string;
  body: Terms;
  why: string;
  by: string;
}

/** The next terms version of a plan. Its date cannot be earlier than the version before it. */
export async function addTerms(db: Queryable, input: NewTerms): Promise<TermsVersion> {
  const errors = termsProblems(input.body);
  if (!PLAN.test(input.plan) || input.plan.length > 40)
    errors.push(
      "A plan is a lowercase slug of 40 characters or fewer, like standard or partner-1.",
    );
  if (!DAY.test(input.from) || Number.isNaN(Date.parse(`${input.from}T00:00:00Z`)))
    errors.push("The date is YYYY-MM-DD.");
  if (!input.why.trim()) errors.push("Say why.");
  if (errors.length) throw new Refused(errors);
  return atomic(db, async (tx) => {
    await lock(tx, `terms_versions:${input.offer}:${input.plan}`);
    const [last] = await tx
      .select()
      .from(termsVersions)
      .where(and(eq(termsVersions.offer, input.offer), eq(termsVersions.plan, input.plan)))
      .orderBy(desc(termsVersions.number))
      .limit(1);
    if (last && input.from < last.effectiveFrom) {
      return refuse(
        `Version ${last.number} of ${input.plan} starts ${last.effectiveFrom}. A new version cannot start earlier.`,
      );
    }
    const [row] = await tx
      .insert(termsVersions)
      .values({
        offer: input.offer,
        plan: input.plan,
        number: (last?.number ?? 0) + 1,
        effectiveFrom: input.from,
        body: input.body,
        why: input.why,
        createdBy: input.by,
      })
      .returning();
    if (!row) throw new Error("terms insert returned nothing");
    return row;
  });
}

/** The plan's live terms on a day: the highest number whose date has come. Null if none. */
export async function liveTerms(
  db: Queryable,
  offer: string,
  plan: string,
  at: string | Date,
): Promise<TermsVersion | null> {
  const [row] = await db
    .select()
    .from(termsVersions)
    .where(
      and(
        eq(termsVersions.offer, offer),
        eq(termsVersions.plan, plan),
        lte(termsVersions.effectiveFrom, dayOf(at)),
      ),
    )
    .orderBy(desc(termsVersions.number))
    .limit(1);
  return row ?? null;
}

/** Every terms version of an offer, plan then number. Narrow to one plan with `plan`. */
export async function termsHistory(
  db: Queryable,
  offer: string,
  plan?: string,
): Promise<TermsVersion[]> {
  return db
    .select()
    .from(termsVersions)
    .where(
      plan
        ? and(eq(termsVersions.offer, offer), eq(termsVersions.plan, plan))
        : eq(termsVersions.offer, offer),
    )
    .orderBy(asc(termsVersions.plan), asc(termsVersions.number));
}

// --- funnels ---------------------------------------------------------------------------------

const FUNNEL_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * What `checkFunnel` needs, from stored funnels: each one's newest stage keys and sale stage, and
 * which funnels each takes entries from. `triggers` are the trigger component ids that exist.
 */
export async function funnelContext(
  db: Queryable,
  id: string,
  triggers: ReadonlySet<string>,
): Promise<FunnelContext> {
  const newest = await db
    .selectDistinctOn([funnelVersions.funnel], {
      funnel: funnelVersions.funnel,
      body: funnelVersions.body,
    })
    .from(funnelVersions)
    .orderBy(funnelVersions.funnel, desc(funnelVersions.number));
  const byId = new Map(newest.map((r) => [r.funnel, r.body] as const));
  const feeds: Record<string, string[]> = {};
  for (const [f, b] of byId) {
    feeds[f] = b.entries.flatMap((e) => (e.funnel ? [e.funnel.id] : []));
  }
  return {
    id,
    triggers,
    funnel(other) {
      const b = byId.get(other);
      if (!b) return undefined;
      return { stages: b.stages.map((s) => s.key), sale: b.stages.find((s) => s.sale)?.key ?? "" };
    },
    feeds,
  };
}

export interface NewFunnel {
  id: string;
  name: string;
  body: FunnelBody;
  why: string;
  by: string;
  triggers: ReadonlySet<string>;
}

/** A new funnel: its head and version 1. Refused with every reason `checkFunnel` finds. */
export async function addFunnel(db: Queryable, input: NewFunnel): Promise<FunnelVersion> {
  if (!FUNNEL_ID.test(input.id) || input.id.length > 40)
    throw new Refused(["A funnel id is a lowercase slug of 40 characters or fewer."]);
  if (!input.why.trim()) throw new Refused(["Say why."]);
  return atomic(db, async (tx) => {
    await lock(tx, `funnel:${input.id}`);
    const [have] = await tx
      .select({ id: funnels.id })
      .from(funnels)
      .where(eq(funnels.id, input.id));
    if (have) return refuse(`Funnel "${input.id}" exists. Append a version to change it.`);
    const errors = checkFunnel(null, input.body, await funnelContext(tx, input.id, input.triggers));
    if (errors.length) throw new Refused(errors);
    await tx.insert(funnels).values({ id: input.id, name: input.name });
    const [row] = await tx
      .insert(funnelVersions)
      .values({
        funnel: input.id,
        number: 1,
        body: input.body,
        why: input.why,
        createdBy: input.by,
      })
      .returning();
    if (!row) throw new Error("funnel version insert returned nothing");
    return row;
  });
}

/**
 * The next version of a funnel, checked against the newest. Open journeys carry to it in the
 * same transaction (`carryJourneys`).
 */
export async function appendFunnel(
  db: Queryable,
  id: string,
  body: FunnelBody,
  why: string,
  by: string,
  triggers: ReadonlySet<string>,
): Promise<FunnelVersion> {
  if (!why.trim()) throw new Refused(["Say why."]);
  return atomic(db, async (tx) => {
    await lock(tx, `funnel:${id}`);
    const [last] = await tx
      .select()
      .from(funnelVersions)
      .where(eq(funnelVersions.funnel, id))
      .orderBy(desc(funnelVersions.number))
      .limit(1);
    if (!last) return refuse(`Funnel "${id}" does not exist. Add it first.`);
    if (canonicalJson(last.body) === canonicalJson(body))
      return refuse(`That is already version ${last.number}.`);
    const errors = checkFunnel(last.body, body, await funnelContext(tx, id, triggers));
    if (errors.length) throw new Refused(errors);
    const [row] = await tx
      .insert(funnelVersions)
      .values({ funnel: id, number: last.number + 1, body, why, createdBy: by })
      .returning();
    if (!row) throw new Error("funnel version insert returned nothing");
    // Open journeys keep their stage on the new version (a `version` event each).
    await carryJourneys(tx, id, row.number);
    return row;
  });
}

/** `off` stops new journeys; open ones still move. */
export async function setFunnelStatus(
  db: Queryable,
  id: string,
  status: FunnelStatus,
): Promise<Funnel> {
  const [row] = await db.update(funnels).set({ status }).where(eq(funnels.id, id)).returning();
  if (!row) throw new Refused([`Funnel "${id}" does not exist.`]);
  return row;
}

export interface FunnelFilter {
  funnel?: string;
  /** Only funnels whose status is `live`. */
  live?: boolean;
  /** Only each funnel's newest version. */
  newest?: boolean;
}

export type FunnelVersionRow = FunnelVersion & { status: FunnelStatus; name: string };

/** Funnel versions, funnel then number. */
export async function funnelVersionsOf(
  db: Queryable,
  filter: FunnelFilter = {},
): Promise<FunnelVersionRow[]> {
  const rows = await db
    .select({
      id: funnelVersions.id,
      funnel: funnelVersions.funnel,
      number: funnelVersions.number,
      body: funnelVersions.body,
      why: funnelVersions.why,
      createdAt: funnelVersions.createdAt,
      createdBy: funnelVersions.createdBy,
      status: funnels.status,
      name: funnels.name,
    })
    .from(funnelVersions)
    .innerJoin(funnels, eq(funnels.id, funnelVersions.funnel))
    .where(
      and(
        filter.funnel ? eq(funnelVersions.funnel, filter.funnel) : undefined,
        filter.live ? eq(funnels.status, "live") : undefined,
      ),
    )
    .orderBy(asc(funnelVersions.funnel), asc(funnelVersions.number));
  if (!filter.newest) return rows;
  const last = new Map<string, FunnelVersionRow>();
  for (const r of rows) last.set(r.funnel, r);
  return [...last.values()];
}
