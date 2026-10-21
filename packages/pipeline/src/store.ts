/**
 * The version store (designs/2026-10-19-business-map.md): offers by hash, terms by date, the
 * business shape by number. Every write is a new row; the database refuses an edit. Two writers at once cannot
 * take one number: each write holds a transaction lock on the thing it numbers.
 */
import { createHash } from "node:crypto";
import { imports } from "@wren/core/schema";
import { segments } from "@wren/core/segments-schema";
import { atomic, type Queryable, type Tx } from "@wren/db";
import type { Offer, Terms } from "@wren/offers";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { carryJourneys, type Moves, remapDeals } from "./carry.js";
import { canonicalJson } from "./diff.js";
import { checkShape, depthOf, type ShapeBody, type ShapeCheckContext } from "./model.js";
import { Refused } from "./refused.js";
import {
  type OfferVersion,
  offerVersions,
  type ShapeVersion,
  shapeVersions,
  type TermsVersion,
  termsVersions,
} from "./schema.js";

export { canonicalJson, diffShapes, type ShapeDiff } from "./diff.js";

export { Refused };

const refuse = (...errors: string[]): never => {
  throw new Refused(errors);
};

/** One writer at a time per key, until the transaction ends. */
export const lock = (tx: Tx, key: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);

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

// --- the shape -------------------------------------------------------------------------------

/**
 * What `checkShape` needs, from this workspace: its groups (active segments, by id as text) and
 * its sourced lists (`import:<batch id>`). `triggers` are the trigger component ids that exist.
 */
export async function shapeContext(
  db: Queryable,
  triggers: ReadonlySet<string>,
): Promise<ShapeCheckContext> {
  const groups = new Map(
    (await db.select({ id: segments.id, state: segments.state }).from(segments)).map(
      (g) => [String(g.id), g.state === "active"] as const,
    ),
  );
  const batches = new Set(
    (await db.select({ id: imports.id }).from(imports)).map((r) => `import:${r.id}`),
  );
  return {
    triggers,
    source: (sid) => (batches.has(sid) ? { exists: true } : undefined),
    group(gid) {
      const active = groups.get(gid);
      return active === undefined ? undefined : { active };
    },
  };
}

/** The newest shape version, or null when none is saved. */
export async function newestShape(db: Queryable): Promise<ShapeVersion | null> {
  const [row] = await db.select().from(shapeVersions).orderBy(desc(shapeVersions.number)).limit(1);
  return row ?? null;
}

/** Every shape version, oldest first. */
export async function shapeVersionsOf(db: Queryable): Promise<ShapeVersion[]> {
  return db.select().from(shapeVersions).orderBy(asc(shapeVersions.number));
}

export interface NewShape {
  body: ShapeBody;
  /** Why it changed. Not empty. */
  note: string;
  by: string;
  triggers: ReadonlySet<string>;
  /** Where journeys on a node the new body drops go: `{ oldNode: newNode }`. */
  moves?: Moves;
  /** The draft this version is applied from (`drafts.ts`). */
  draft?: string;
}

/**
 * The next shape version. Refused with every reason `checkShape` finds, with "Nothing changed."
 * when the body equals the newest, and when a `moves` target is no node of the body. Open
 * journeys carry to it, and open deals at a moved node follow, in the same transaction
 * (`carryJourneys`, `remapDeals`).
 */
export async function saveShape(db: Queryable, input: NewShape): Promise<ShapeVersion> {
  if (!input.note.trim()) throw new Refused(["Say why."]);
  return atomic(db, async (tx) => {
    await lock(tx, "shape");
    const last = await newestShape(tx);
    if (last && canonicalJson(last.body) === canonicalJson(input.body))
      return refuse("Nothing changed.");
    const errors = checkShape(input.body, await shapeContext(tx, input.triggers));
    const ids = new Set(input.body.nodes.map((n) => n.id));
    for (const [from, to] of Object.entries(input.moves ?? {})) {
      if (!ids.has(to)) errors.push(`Cannot move ${from} to ${to}: the shape has no node ${to}.`);
    }
    if (errors.length) throw new Refused(errors);
    const [row] = await tx
      .insert(shapeVersions)
      .values({
        number: (last?.number ?? 0) + 1,
        body: input.body,
        depths: depthOf(input.body),
        note: input.note,
        parent: last?.number ?? null,
        createdBy: input.by,
        draft: input.draft ?? null,
      })
      .returning();
    if (!row) throw new Error("shape version insert returned nothing");
    // Open journeys keep their node on the new version (a `version` arrival each).
    await carryJourneys(tx, row.number, input.moves ?? {});
    // Open deals made at a moved node follow it.
    await remapDeals(tx, input.moves ?? {});
    return row;
  });
}
