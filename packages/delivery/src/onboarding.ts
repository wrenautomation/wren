/** Onboarding: the contract and its terms, the setup fee, signing, and access to the client's systems. */
import { clients } from "@wren/core/clients";
import type { Queryable } from "@wren/db";
import { OFFER_IDS, type Offer, offerFor } from "@wren/offers";
import { canonicalJson, liveTerms } from "@wren/pipeline/store";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { CONTRACT_VERSION, contractText, sha256 } from "./contract.js";
import {
  bad,
  CURRENCY,
  cents,
  DeliveryRefusal,
  missing,
  ofClient,
  textIn,
  todayUtc,
} from "./rows.js";
import {
  ACCESS_STATUSES,
  type AccessRequest,
  type AccessStatus,
  type Agreement,
  accessRequests,
  agreements,
  asks,
  type Engagement,
  engagements,
  invoices,
  milestones,
  type Terms,
} from "./schema.js";
import { startEngagement } from "./work.js";

/**
 * A setup fee that still holds: paid, and not refunded in full or lost in a dispute. The
 * forward gate (`startIfReady`) starts the plan on it; the reverse (`stopIfReversed`) ends it.
 */
export const setupHolds = and(
  eq(invoices.setup, true),
  eq(invoices.status, "paid"),
  lt(invoices.refundedCents, invoices.cents),
  sql`${invoices.dispute} is distinct from 'lost'`,
);

/**
 * The terms an offer's price implies, in cents, with the operator's changes on
 * top. `flat` takes the offer's all-upfront option: its price as the setup fee,
 * no per-unit fee. Fixed and quoted prices are ranges or nothing: their fees
 * must be given. `live` is a stored terms version's body: it replaces the computed base,
 * and `over` still goes on top.
 */
export function termsFor(
  offer: Offer,
  over: Partial<Terms> = {},
  flat = false,
  live?: Terms,
): Terms {
  const p = offer.price;
  const perf = p.kind === "performance" ? p : null;
  if (!live && flat && perf?.flat == null) throw bad(`${offer.name} has no flat price`);
  const base: Terms = live ?? {
    currency: "USD",
    setupCents: perf ? cents(flat && perf.flat ? perf.flat : perf.upfront) : 0,
    monthlyCents: perf?.monthly ? cents(perf.monthly) : null,
    perUnitCents: perf && !flat ? cents(perf.perUnit) : null,
    unit: perf ? perf.unit : null,
    capCents: perf?.cap && !flat ? cents(perf.cap) : null,
    days: offer.days,
    until: perf?.until ?? null,
    refundIfNone: perf?.refundIfNone ?? null,
    payDays: 7,
  };
  const t = { ...base, ...over };
  t.currency = t.currency.trim().toUpperCase();
  if (!CURRENCY.test(t.currency)) throw bad("the currency is three letters, like USD");
  for (const [k, v] of [
    ["setup", t.setupCents],
    ["monthly", t.monthlyCents],
    ["per unit", t.perUnitCents],
    ["cap", t.capCents],
  ] as const)
    if (v !== null && (!Number.isSafeInteger(v) || v < 0)) throw bad(`the ${k} fee is whole cents`);
  if (!Number.isInteger(t.payDays) || t.payDays < 0 || t.payDays > 90)
    throw bad("invoices are due 0 to 90 days after their date");
  if (t.perUnitCents !== null && !t.unit?.trim()) throw bad("say what a per-unit fee counts");
  if (
    t.until != null &&
    (t.days === null || !Number.isInteger(t.until) || t.until <= 0 || !t.unit?.trim())
  )
    throw bad("carrying on until a count needs days, a count above 0 and what it counts");
  if (
    t.refundIfNone != null &&
    (t.days === null ||
      !t.unit?.trim() ||
      !Number.isInteger(t.refundIfNone.minContacts) ||
      t.refundIfNone.minContacts <= 0)
  )
    throw bad("a refund if none needs days, what it counts and a contact count above 0");
  if ((p.kind === "fixed" || p.kind === "quoted") && !t.setupCents && t.monthlyCents === null)
    throw bad(`${offer.name} is priced per deal: give the setup or monthly fee`);
  return t;
}

/** The plan an onboarding takes its terms from: `flat` for the all-upfront option, else `standard`. */
export const planOf = (flat: boolean | undefined) => (flat ? "flat" : "standard");

/**
 * Sell an offer (onboarding): the engagement waits, the contract is issued with
 * these terms, and the offer's access requests open. Signing it, and paying the
 * setup invoice when there's a fee, starts the plan.
 */
export async function onboard(
  db: Queryable,
  input: {
    clientId: string;
    offerId: string;
    startsOn: string;
    terms?: Partial<Terms>;
    /** The offer's all-upfront option instead of per-unit fees. */
    flat?: boolean;
    by: string;
  },
): Promise<{ engagement: Engagement; agreement: Agreement }> {
  if (!OFFER_IDS.has(input.offerId)) throw missing(`offer '${input.offerId}'`);
  const offer = offerFor(input.offerId);
  // A stored terms version of the plan, live today, wins over the computed price.
  const live = await liveTerms(db, offer.id, planOf(input.flat), new Date());
  const terms = termsFor(offer, input.terms, input.flat, live?.body);
  const [client] = await db
    .select({ name: clients.name })
    .from(clients)
    .where(eq(clients.id, input.clientId));
  if (!client) throw missing(`client '${input.clientId}'`);
  const engagement = await startEngagement(db, { ...input, status: "onboarding" });
  const body = contractText({ clientName: client.name, offer, terms });
  const [agreement] = await db
    .insert(agreements)
    .values({
      engagementId: engagement.id,
      version: CONTRACT_VERSION,
      terms,
      // Only when the operator changed nothing: then the copy is that version, word for word.
      termsVersion: live && canonicalJson(terms) === canonicalJson(live.body) ? live.id : null,
      body,
      sha256: sha256(body),
      issuedBy: input.by,
    })
    .returning();
  if (!agreement) throw new Error("agreement insert returned nothing");
  for (const a of offer.access ?? []) await requestAccess(db, engagement, { ...a, by: input.by });
  return { engagement, agreement };
}

/** The engagement's contract, or null when it was started without one. */
export async function agreementOf(db: Queryable, e: Engagement): Promise<Agreement | null> {
  const [a] = await db.select().from(agreements).where(eq(agreements.engagementId, e.id));
  return a ?? null;
}

/**
 * The client signs (an owner, in the portal). `sha256` is the fingerprint of
 * the text they were shown: a different one means they saw another text.
 */
export async function signAgreement(
  db: Queryable,
  e: Engagement,
  input: {
    sha256: string;
    name: string;
    title?: string | undefined;
    email: string;
    agreed: boolean;
    ip?: string | undefined;
    agent?: string | undefined;
  },
): Promise<Agreement> {
  if (!input.agreed) throw bad("tick the box to agree");
  const a = await agreementOf(db, e);
  if (!a) throw missing("contract for this engagement");
  if (a.signedAt) throw new DeliveryRefusal("this contract is already signed", 409);
  if (input.sha256 !== a.sha256)
    throw new DeliveryRefusal(
      "the contract changed since you opened it: reload and read it again",
      409,
    );
  const [signed] = await db
    .update(agreements)
    .set({
      signerName: textIn(input.name, "your full name", 200),
      signerTitle: input.title?.trim() ? textIn(input.title, "your title", 200) : null,
      signerEmail: input.email,
      signedAt: new Date(),
      signedIp: input.ip?.slice(0, 64) ?? null,
      signedAgent: input.agent?.slice(0, 500) ?? null,
    })
    .where(and(eq(agreements.id, a.id), isNull(agreements.signedAt)))
    .returning();
  if (!signed) throw new DeliveryRefusal("this contract is already signed", 409);
  await startIfReady(db, e);
  return signed;
}

/**
 * Onboarding ends when the contract is signed and the setup fee, if any, is
 * paid. The plan then starts today (or on its start day, if that's later):
 * every step and open ask moves by the days it waited.
 */
export async function startIfReady(
  db: Queryable,
  e: Engagement,
  today = todayUtc(),
): Promise<boolean> {
  if (e.status !== "onboarding") return false;
  const a = await agreementOf(db, e);
  if (!a?.signedAt) return false;
  if (a.terms.setupCents > 0) {
    const [paid] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.engagementId, e.id), setupHolds));
    if (!paid) return false;
  }
  const startsOn = today > e.startsOn ? today : e.startsOn;
  const by = Math.round((Date.parse(startsOn) - Date.parse(e.startsOn)) / 86_400_000);
  if (by > 0) {
    const moved = (c: AnyPgColumn) => sql`${c} + ${by}::int`;
    await db
      .update(milestones)
      .set({
        plannedFrom: moved(milestones.plannedFrom),
        plannedTo: moved(milestones.plannedTo),
        dueOn: moved(milestones.dueOn),
      })
      .where(and(eq(milestones.engagementId, e.id), isNull(milestones.doneOn)));
    await db
      .update(asks)
      .set({ dueOn: moved(asks.dueOn) })
      .where(and(eq(asks.engagementId, e.id), isNull(asks.answeredAt)));
  }
  await db.update(engagements).set({ status: "active", startsOn }).where(eq(engagements.id, e.id));
  return true;
}

/** Ask, formally, for access to one of the client's systems. */
export async function requestAccess(
  db: Queryable,
  e: Engagement,
  input: { system: string; scope: string; why: string; revoke: string; by: string },
): Promise<AccessRequest> {
  const [r] = await db
    .insert(accessRequests)
    .values({
      engagementId: e.id,
      system: textIn(input.system, "the system", 120),
      scope: textIn(input.scope, "how much access", 500),
      why: textIn(input.why, "why we need it", 1000),
      revoke: textIn(input.revoke, "how to take it back", 500),
      createdBy: input.by,
    })
    .returning();
  if (!r) throw new Error("access request insert returned nothing");
  return r;
}

/** The client grants, declines, or takes back access, with a note (who they added, or why not). */
export async function answerAccess(
  db: Queryable,
  clientId: string,
  input: { id: number; status: string; note?: string | undefined; by: string },
): Promise<AccessRequest> {
  const status = input.status as AccessStatus;
  if (status === "open" || !ACCESS_STATUSES.includes(status))
    throw bad("access is granted, declined or revoked");
  const note = input.note?.trim() ? textIn(input.note, "the note", 2000) : null;
  if (status === "declined" && !note) throw bad("say why, so we can find another way");
  const [r] = await db
    .update(accessRequests)
    .set({ status, note, answeredBy: input.by, answeredAt: new Date() })
    .where(
      and(eq(accessRequests.id, input.id), ofClient(db, accessRequests.engagementId, clientId)),
    )
    .returning();
  if (!r) throw missing("access request");
  return r;
}
