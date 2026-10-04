/**
 * Delivery: what we do for each client (D1–D12). An engagement is a bought
 * offer with its plan dated from a start day; the timeline, deliverables, asks
 * and results hang off it. A foundation: products post into it, it never
 * imports one. Every write names the client, and a row of another client's
 * is "not found", so one client can never reach another's by id.
 */
import { CHANNELS, type Channel, clients } from "@wren/core/clients";
import type { Queryable } from "@wren/db";
import { OFFER_IDS, type Offer, offerFor } from "@wren/offers";
import { and, asc, desc, eq, inArray, isNull, lt, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { DELIVERY_COMPONENTS } from "./components.js";
import { CONTRACT_VERSION, contractText, sha256 } from "./contract.js";
import { fileNameOf } from "./files.js";
import {
  ACCESS_STATUSES,
  type AccessRequest,
  type AccessStatus,
  type Agreement,
  type Ask,
  accessRequests,
  agreements,
  asks,
  type Comment,
  comments,
  type Deliverable,
  type DeliverableKind,
  type DeliverableState,
  deliverables,
  type Engagement,
  type EngagementStatus,
  engagements,
  INVOICE_STATUSES,
  type Invoice,
  type InvoiceStatus,
  interests,
  invoices,
  MAIL_LEVELS,
  type MailLevel,
  type Milestone,
  memberMail,
  milestones,
  moments,
  pulses,
  QUOTE_CONSENTS,
  type QuoteConsent,
  results,
  reviews,
  type Terms,
  type Update,
  updates,
} from "./schema.js";

export { amount, CONTRACT_VERSION, contractText, WREN_PARTY } from "./contract.js";
export * from "./schema.js";
export * from "./source.js";

/** Bad input (400), nothing of this client's by that id (404), or a clash with what's there (409). */
export class DeliveryRefusal extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}
const bad = (message: string) => new DeliveryRefusal(message, 400);
const missing = (what: string) => new DeliveryRefusal(`no such ${what}`, 404);

// --- input checks: the portal and the CLI both come through here -------------

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A calendar day, `YYYY-MM-DD`. */
export function dayOf(v: string, what = "date"): string {
  const d = new Date(`${v}T00:00:00Z`);
  if (!DAY.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v)
    throw bad(`${what} must be a day like 2026-10-01`);
  return v;
}
export const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const todayUtc = (): string => new Date().toISOString().slice(0, 10);
/** 0 = Sunday. */
export const weekday = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();
/** The Monday of `day`'s week: a pulse's week. */
export const mondayOf = (day: string): string => addDays(day, -((weekday(day) + 6) % 7));

function textIn(v: string, what: string, max: number): string {
  const t = v.trim();
  if (!t) throw bad(`${what} is empty`);
  if (t.length > max) throw bad(`${what} is over ${max} characters`);
  return t;
}
/** Only https: a stored link becomes an href, and `javascript:` there runs. */
function linkOf(v: string, kind: DeliverableKind): string {
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    throw bad("that link isn't a web address");
  }
  if (u.protocol !== "https:") throw bad("links must start with https://");
  if (kind === "loom" && !/(^|\.)loom\.com$/.test(u.hostname)) throw bad("that isn't a Loom link");
  return u.toString();
}
/** Files live under the client's own folder in the private bucket (D11). */
function fileKeyOf(clientId: string, v: string): string {
  const key = v.trim();
  if (!key.startsWith(`clients/${clientId}/`) || key.split("/").includes(".."))
    throw bad("that file isn't in this client's folder");
  return key;
}

// --- finding a client's rows ---------------------------------------------------

/** Statuses where the work is under way: one per offer per client. */
const RUNNING: EngagementStatus[] = ["onboarding", "active"];

/** The client's engagement: by id, or the one running (onboarding or active) when there's one. */
export async function engagementOf(
  db: Queryable,
  clientId: string,
  id?: number,
): Promise<Engagement> {
  if (id !== undefined) {
    const [e] = await db
      .select()
      .from(engagements)
      .where(and(eq(engagements.id, id), eq(engagements.clientId, clientId)));
    if (!e) throw missing("engagement");
    return e;
  }
  const active = await db
    .select()
    .from(engagements)
    .where(and(eq(engagements.clientId, clientId), inArray(engagements.status, RUNNING)));
  if (active.length === 0) throw missing("running engagement");
  if (active.length > 1) throw bad("this client has more than one engagement running: pick one");
  return active[0] as Engagement;
}

async function milestoneOf(db: Queryable, e: Engagement, key: string): Promise<Milestone> {
  const [m] = await db
    .select()
    .from(milestones)
    .where(and(eq(milestones.engagementId, e.id), eq(milestones.key, key)));
  if (!m) throw missing(`step '${key}' in this plan`);
  return m;
}
const milestoneIdOf = async (db: Queryable, e: Engagement, key?: string) =>
  key === undefined ? null : (await milestoneOf(db, e, key)).id;

/** Rows of this client's engagements only: a row of another client's is "not found". */
const ofClient = (db: Queryable, engagementId: AnyPgColumn, clientId: string) =>
  inArray(
    engagementId,
    db.select({ id: engagements.id }).from(engagements).where(eq(engagements.clientId, clientId)),
  );

// --- writes ---------------------------------------------------------------------

const CLIENT_DELIVERY = DELIVERY_COMPONENTS.filter((c) => c.for === "client");

/** Week n of the plan runs from start + 7(n-1) days to start + 7n - 1. */
export function datedPlan(offer: Offer, startsOn: string) {
  if (!offer.plan) throw bad(`${offer.id} has no plan to start`);
  return offer.plan.map((p, position) => {
    const plannedFrom = addDays(startsOn, (p.from - 1) * 7);
    const plannedTo = p.to === null ? null : addDays(startsOn, p.to * 7 - 1);
    return { phase: p, position, plannedFrom, plannedTo, asksDue: addDays(plannedFrom, 6) };
  });
}

/** Start an offer for a client (D1, D2): the plan's phases become dated milestones, its asks open. */
export async function startEngagement(
  db: Queryable,
  input: {
    clientId: string;
    offerId: string;
    startsOn: string;
    by: string;
    status?: "onboarding" | "active";
  },
): Promise<Engagement> {
  if (!OFFER_IDS.has(input.offerId)) throw missing(`offer '${input.offerId}'`);
  const offer = offerFor(input.offerId);
  const plan = datedPlan(offer, dayOf(input.startsOn, "the start"));
  const [running] = await db
    .select({ id: engagements.id })
    .from(engagements)
    .where(
      and(
        eq(engagements.clientId, input.clientId),
        eq(engagements.offerId, offer.id),
        inArray(engagements.status, RUNNING),
      ),
    );
  if (running) throw new DeliveryRefusal(`${offer.name} is already running for this client`, 409);
  const [e] = await db
    .insert(engagements)
    .values({
      clientId: input.clientId,
      offerId: offer.id,
      startsOn: input.startsOn,
      status: input.status ?? "active",
      createdBy: input.by,
    })
    .returning();
  if (!e) throw new Error("engagement insert returned nothing");
  // A project comes with its portal: the delivery components go on where missing, set blocks stay.
  const on = Object.fromEntries(CLIENT_DELIVERY.map((c) => [c.id, {}]));
  await db
    .update(clients)
    .set({ products: sql`${JSON.stringify(on)}::jsonb || ${clients.products}` })
    .where(eq(clients.id, input.clientId));
  const ms = await db
    .insert(milestones)
    .values(
      plan.map((p) => ({
        engagementId: e.id,
        key: p.phase.id,
        name: p.phase.name,
        position: p.position,
        plannedFrom: p.plannedFrom,
        plannedTo: p.plannedTo,
        dueOn: p.plannedTo,
        promised: [...p.phase.deliverables],
      })),
    )
    .returning({ id: milestones.id, key: milestones.key });
  const idOf = new Map(ms.map((m) => [m.key, m.id]));
  const opening = plan.flatMap((p) =>
    p.phase.asks.map((text) => ({
      engagementId: e.id,
      milestoneId: idOf.get(p.phase.id) ?? null,
      text,
      dueOn: p.asksDue,
      createdBy: input.by,
    })),
  );
  if (opening.length) await db.insert(asks).values(opening);
  return e;
}

export async function setEngagementStatus(
  db: Queryable,
  clientId: string,
  id: number,
  status: EngagementStatus,
): Promise<void> {
  await engagementOf(db, clientId, id);
  // `done` keeps the first day it ended; any other status clears it.
  const endedOn =
    status === "done"
      ? sql`coalesce(${engagements.endedOn}, (now() at time zone 'America/Toronto')::date)`
      : null;
  await db.update(engagements).set({ status, endedOn }).where(eq(engagements.id, id));
}

/** How a client came in, on its engagement: a channel and a campaign, or null for unknown. */
export async function setEngagementSource(
  db: Queryable,
  clientId: string,
  id: number,
  source: { channel: string | null; campaign: string | null },
): Promise<void> {
  await engagementOf(db, clientId, id);
  const channel = source.channel?.trim() || null;
  if (channel !== null && !(CHANNELS as readonly string[]).includes(channel))
    throw bad(`the channel is one of ${CHANNELS.join(", ")}`);
  const campaign = source.campaign?.trim() || null;
  if (campaign !== null && campaign.length > 120)
    throw bad("the campaign is 120 characters at most");
  await db
    .update(engagements)
    .set({ sourceChannel: channel as Channel | null, sourceCampaign: campaign })
    .where(eq(engagements.id, id));
}

/** A line on the timeline (D3). Internal ones are for Wren's team only. */
export async function postUpdate(
  db: Queryable,
  e: Engagement,
  input: {
    body: string;
    author: string;
    milestone?: string | undefined;
    internal?: boolean | undefined;
    /** When it happened, for a product on its own clock; default now. */
    at?: Date | undefined;
  },
): Promise<Update> {
  const [u] = await db
    .insert(updates)
    .values({
      engagementId: e.id,
      milestoneId: await milestoneIdOf(db, e, input.milestone),
      author: input.author,
      body: textIn(input.body, "the update", 10_000),
      internal: input.internal === true,
      ...(input.at ? { createdAt: input.at } : {}),
    })
    .returning();
  if (!u) throw new Error("update insert returned nothing");
  return u;
}

/** Take an update down; it stays on record. */
export async function hideUpdate(db: Queryable, clientId: string, id: number): Promise<void> {
  const hidden = await db
    .update(updates)
    .set({ hiddenAt: new Date() })
    .where(and(eq(updates.id, id), ofClient(db, updates.engagementId, clientId)))
    .returning({ id: updates.id });
  if (hidden.length === 0) throw missing("update");
}

/**
 * Hand something over (D4). `replaces` makes it the next version of that one,
 * waiting again, and moves its comment thread onto the new one.
 */
export async function addDeliverable(
  db: Queryable,
  e: Engagement,
  input: {
    title: string;
    kind: DeliverableKind;
    url?: string | undefined;
    fileKey?: string | undefined;
    milestone?: string | undefined;
    replaces?: number | undefined;
    by: string;
  },
): Promise<Deliverable> {
  const where =
    input.kind === "file"
      ? { fileKey: fileKeyOf(e.clientId, input.fileKey ?? ""), url: null }
      : { url: linkOf(input.url ?? "", input.kind), fileKey: null };
  let prev: Deliverable | null = null;
  if (input.replaces !== undefined) {
    [prev = null] = await db
      .select()
      .from(deliverables)
      .where(and(eq(deliverables.id, input.replaces), eq(deliverables.engagementId, e.id)));
    if (!prev) throw missing("deliverable in this engagement");
  }
  const [d] = await db
    .insert(deliverables)
    .values({
      engagementId: e.id,
      milestoneId: input.milestone
        ? await milestoneIdOf(db, e, input.milestone)
        : (prev?.milestoneId ?? null),
      title: textIn(input.title, "the title", 200),
      kind: input.kind,
      ...where,
      version: prev ? prev.version + 1 : 1,
      previousId: prev?.id ?? null,
      createdBy: input.by,
    })
    .returning();
  if (!d) throw new Error("deliverable insert returned nothing");
  // The thread goes on under the newest version: Home shows only that one.
  if (prev)
    await db
      .update(comments)
      .set({ deliverableId: d.id })
      .where(eq(comments.deliverableId, prev.id));
  return d;
}

/** The client approves, or asks for changes, with a note (D4). */
export async function decideDeliverable(
  db: Queryable,
  clientId: string,
  input: {
    id: number;
    decision: Exclude<DeliverableState, "waiting">;
    note?: string | undefined;
    by: string;
  },
): Promise<Deliverable> {
  if (input.decision === "changes" && !input.note?.trim()) throw bad("say what should change");
  const [d] = await db
    .update(deliverables)
    .set({
      status: input.decision,
      decidedBy: input.by,
      decidedAt: new Date(),
      decisionNote: input.note?.trim() ? textIn(input.note, "the note", 4000) : null,
    })
    .where(and(eq(deliverables.id, input.id), ofClient(db, deliverables.engagementId, clientId)))
    .returning();
  if (!d) throw missing("deliverable");
  return d;
}

/** What a comment hangs under: an update the client can see, or a deliverable. */
export type CommentOn = { updateId: number } | { deliverableId: number };

/**
 * A line in the thread under an update or a deliverable. Internal and hidden
 * updates take none: their thread would reach the client by mail.
 */
export async function addComment(
  db: Queryable,
  clientId: string,
  input: { on: CommentOn; body: string; by: string; fromWren: boolean },
): Promise<Comment> {
  const body = textIn(input.body, "the comment", 4000);
  let target: { engagementId: number } | undefined;
  if ("updateId" in input.on) {
    [target] = await db
      .select({ engagementId: updates.engagementId })
      .from(updates)
      .where(
        and(
          eq(updates.id, input.on.updateId),
          ofClient(db, updates.engagementId, clientId),
          seenBy(false),
        ),
      );
    if (!target) throw missing("update");
  } else {
    [target] = await db
      .select({ engagementId: deliverables.engagementId })
      .from(deliverables)
      .where(
        and(
          eq(deliverables.id, input.on.deliverableId),
          ofClient(db, deliverables.engagementId, clientId),
        ),
      );
    if (!target) throw missing("deliverable");
  }
  const [c] = await db
    .insert(comments)
    .values({
      engagementId: target.engagementId,
      ...input.on,
      author: input.by,
      fromWren: input.fromWren,
      body,
    })
    .returning();
  if (!c) throw new Error("comment insert returned nothing");
  return c;
}

/** Something we need from the client (D5). */
export async function addAsk(
  db: Queryable,
  e: Engagement,
  input: { text: string; dueOn?: string | undefined; milestone?: string | undefined; by: string },
): Promise<Ask> {
  const [a] = await db
    .insert(asks)
    .values({
      engagementId: e.id,
      milestoneId: await milestoneIdOf(db, e, input.milestone),
      text: textIn(input.text, "the ask", 2000),
      dueOn: input.dueOn === undefined ? null : dayOf(input.dueOn, "the due date"),
      createdBy: input.by,
    })
    .returning();
  if (!a) throw new Error("ask insert returned nothing");
  return a;
}

/** The client's answer, in place (D5). A later answer replaces it; the audit log keeps both. */
export async function answerAsk(
  db: Queryable,
  clientId: string,
  input: { id: number; answer?: string | undefined; fileKey?: string | undefined; by: string },
): Promise<Ask> {
  const text = input.answer?.trim() ? textIn(input.answer, "the answer", 10_000) : null;
  const fileKey = input.fileKey ? fileKeyOf(clientId, input.fileKey) : null;
  if (!text && !fileKey) throw bad("the answer is empty");
  const [a] = await db
    .update(asks)
    .set({ answer: text, fileKey, answeredBy: input.by, answeredAt: new Date() })
    .where(and(eq(asks.id, input.id), ofClient(db, asks.engagementId, clientId)))
    .returning();
  if (!a) throw missing("ask");
  return a;
}

/** A step is done (null `on` undoes it). */
export async function markDone(
  db: Queryable,
  e: Engagement,
  input: { milestone: string; on: string | null },
): Promise<Milestone> {
  const m = await milestoneOf(db, e, input.milestone);
  const [out] = await db
    .update(milestones)
    .set({ doneOn: input.on === null ? null : dayOf(input.on, "the done date") })
    .where(eq(milestones.id, m.id))
    .returning();
  return out as Milestone;
}

/** A step moves: it shows as a slip, with the reason (D2). The planned dates stay. */
export async function slipMilestone(
  db: Queryable,
  e: Engagement,
  input: { milestone: string; to: string; reason: string },
): Promise<Milestone> {
  const m = await milestoneOf(db, e, input.milestone);
  const to = dayOf(input.to, "the new date");
  if (to < m.plannedFrom) throw bad("the new date is before the step starts");
  const [out] = await db
    .update(milestones)
    .set({ dueOn: to, slipReason: textIn(input.reason, "the reason", 2000) })
    .where(eq(milestones.id, m.id))
    .returning();
  return out as Milestone;
}

/** One of the offer's measures so far (D6). */
export async function recordResult(
  db: Queryable,
  e: Engagement,
  input: { key: string; value: number; note?: string | undefined; by: string },
): Promise<void> {
  const measures = offerFor(e.offerId).measures;
  if (!measures.some((m) => m.key === input.key))
    throw bad(`${e.offerId} measures ${measures.map((m) => m.key).join(", ")}`);
  if (!Number.isFinite(input.value)) throw bad("the value isn't a number");
  const row = {
    value: input.value,
    note: input.note?.trim() ? textIn(input.note, "the note", 2000) : null,
    updatedBy: input.by,
    updatedAt: new Date(),
  };
  await db
    .insert(results)
    .values({ engagementId: e.id, key: input.key, ...row })
    .onConflictDoUpdate({ target: [results.engagementId, results.key], set: row });
}

/** A client person's one tap for the week (D10); a second tap the same week replaces it. */
export async function recordPulse(
  db: Queryable,
  e: Engagement,
  input: { email: string; score: number; note?: string | undefined; today?: string },
): Promise<void> {
  if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5)
    throw bad("a pulse is 1 to 5");
  const row = {
    score: input.score,
    note: input.note?.trim() ? textIn(input.note, "the note", 2000) : null,
    at: new Date(),
  };
  await db
    .insert(pulses)
    .values({
      engagementId: e.id,
      email: input.email,
      week: mondayOf(input.today ?? todayUtc()),
      ...row,
    })
    .onConflictDoUpdate({ target: [pulses.engagementId, pulses.email, pulses.week], set: row });
}

// --- moments, reviews and what's next (D13) ------------------------------------

/** The generic app: every engagement's plan and paperwork, for offers with no app of their own (D14). */
export const WORK_APP = "work";
/** The portal app an offer runs in; its plan and paperwork live there too. */
export const appOf = (offerId: string): string => offerFor(offerId).app ?? WORK_APP;
/**
 * A portal page for these offers' engagements: their app when they share one, else `work`,
 * which holds them all. Every app names the plan's pages alike ("overview", "needs-you").
 */
export function pagePath(offerIds: readonly string[], page: string): string {
  const apps = new Set(offerIds.map(appOf));
  const [only] = apps;
  return `/${apps.size === 1 && only ? only : WORK_APP}/${page}`;
}

export const HALFWAY = "halfway";
export const LAST_WEEK = "last_week";
const firstOf = (measure: string) => `first:${measure}`;

/** What the client calls a moment, or null for one this offer doesn't have. */
export function momentLabel(offer: Offer, moment: string): string | null {
  if (moment === HALFWAY) return "Halfway there";
  if (moment === LAST_WEEK) return "The final week";
  return offer.reviewAfterFirst?.find((f) => firstOf(f.measure) === moment)?.moment ?? null;
}

/**
 * The moments a running engagement has reached by `today`: each first result the
 * offer names, day `days`/2 and the last 7 days. Onboarding or done reaches none.
 */
export function momentsReached(
  offer: Offer,
  e: Pick<Engagement, "status" | "startsOn">,
  values: ReadonlyMap<string, number | null>,
  today: string,
): string[] {
  if (e.status !== "active" || e.startsOn > today) return [];
  const out = (offer.reviewAfterFirst ?? [])
    .filter((f) => (values.get(f.measure) ?? 0) >= 1)
    .map((f) => firstOf(f.measure));
  if (offer.days !== null) {
    if (addDays(e.startsOn, Math.floor(offer.days / 2)) <= today) out.push(HALFWAY);
    if (addDays(e.startsOn, offer.days - 7) <= today) out.push(LAST_WEEK);
  }
  return out;
}

/** Offers put to a client on this one: live, in its `next`, with an upsell pitch. */
export const nextOffers = (offer: Offer): Offer[] =>
  offer.next.map((id) => offerFor(id)).filter((o) => o.status === "live" && o.upsell);

/** A client person's review at a moment they reached; again replaces it. No score: "not now". */
export async function recordReview(
  db: Queryable,
  e: Engagement,
  input: {
    email: string;
    moment: string;
    score: number | null;
    words?: string | undefined;
    mayQuote?: string | undefined;
  },
): Promise<void> {
  const reached = await db
    .select()
    .from(moments)
    .where(and(eq(moments.engagementId, e.id), eq(moments.moment, input.moment)));
  if (reached.length === 0) throw missing("moment");
  if (
    input.score !== null &&
    (!Number.isInteger(input.score) || input.score < 1 || input.score > 5)
  )
    throw bad("a review is 1 to 5");
  const mayQuote = (input.mayQuote ?? "private") as QuoteConsent;
  if (!QUOTE_CONSENTS.includes(mayQuote)) throw bad(`may quote is ${QUOTE_CONSENTS.join(", ")}`);
  const row = {
    score: input.score,
    words: input.words?.trim() ? textIn(input.words, "the review", 4000) : null,
    mayQuote,
    at: new Date(),
    toldAt: null,
  };
  await db
    .insert(reviews)
    .values({ engagementId: e.id, moment: input.moment, email: input.email, ...row })
    .onConflictDoUpdate({
      target: [reviews.engagementId, reviews.moment, reviews.email],
      set: row,
    });
}

/** A client person wants to hear about a next offer; Wren is pinged once. */
export async function recordInterest(
  db: Queryable,
  e: Engagement,
  input: { email: string; offerId: string },
): Promise<void> {
  if (!nextOffers(offerFor(e.offerId)).some((o) => o.id === input.offerId)) throw missing("offer");
  await db
    .insert(interests)
    .values({ engagementId: e.id, offerId: input.offerId, email: input.email })
    .onConflictDoNothing();
}

/** What mail a person gets about this client (D9). */
export async function setMailLevel(
  db: Queryable,
  clientId: string,
  email: string,
  level: string,
): Promise<MailLevel> {
  if (!MAIL_LEVELS.includes(level as MailLevel))
    throw bad(`mail is one of ${MAIL_LEVELS.join(", ")}`);
  const set = { level: level as MailLevel };
  await db
    .insert(memberMail)
    .values({ clientId, email, ...set })
    .onConflictDoUpdate({ target: [memberMail.clientId, memberMail.email], set });
  return set.level;
}

export async function mailLevelOf(
  db: Queryable,
  clientId: string,
  email: string,
): Promise<MailLevel> {
  const [row] = await db
    .select({ level: memberMail.level })
    .from(memberMail)
    .where(and(eq(memberMail.clientId, clientId), eq(memberMail.email, email)));
  return row?.level ?? "all";
}

// --- billing: invoices we sent through Wise ----------------------------------------

const CURRENCY = /^[A-Z]{3}$/;

/** An invoice we sent through Wise, put on the engagement's record. */
export async function addInvoice(
  db: Queryable,
  e: Engagement,
  input: {
    number: string;
    description: string;
    cents: number;
    currency?: string | undefined;
    issuedOn?: string | undefined;
    dueOn: string;
    link?: string | undefined;
    /** The setup fee: paid with the contract signed, the plan starts. */
    setup?: boolean | undefined;
    /** The month a recurring bill is for, `2026-11`. */
    period?: string | undefined;
    /** Per-unit fees it bills. */
    units?: number | undefined;
    by: string;
  },
): Promise<Invoice> {
  const number = textIn(input.number, "the invoice number", 64);
  if (!Number.isSafeInteger(input.cents) || input.cents <= 0)
    throw bad("the amount must be over 0, in whole cents");
  const currency = (input.currency ?? "USD").trim().toUpperCase();
  if (!CURRENCY.test(currency)) throw bad("the currency is three letters, like USD");
  const issuedOn = dayOf(input.issuedOn ?? todayUtc(), "the issue date");
  const dueOn = dayOf(input.dueOn, "the due date");
  if (dueOn < issuedOn) throw bad("it can't be due before it's issued");
  const [taken] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.number, number));
  if (taken) throw new DeliveryRefusal(`invoice ${number} is already on record`, 409);
  const period = input.period ?? null;
  if (period !== null) {
    if (!PERIOD.test(period)) throw bad("the period is a month, like 2026-11");
    const [billed] = await db
      .select({ number: invoices.number })
      .from(invoices)
      .where(
        and(
          eq(invoices.engagementId, e.id),
          eq(invoices.period, period),
          sql`${invoices.status} <> 'void'`,
        ),
      );
    if (billed)
      throw new DeliveryRefusal(`${period} is billed already, invoice ${billed.number}`, 409);
  }
  if (input.units !== undefined && !(Number.isSafeInteger(input.units) && input.units >= 0))
    throw bad("units is a whole number, 0 or more");
  const [row] = await db
    .insert(invoices)
    .values({
      engagementId: e.id,
      number,
      description: textIn(input.description, "what it's for", 200),
      cents: input.cents,
      currency,
      issuedOn,
      dueOn,
      link: input.link?.trim() ? linkOf(input.link, "link") : null,
      setup: input.setup === true,
      period,
      units: input.units ?? null,
      createdBy: input.by,
    })
    .returning();
  return row as Invoice;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** What to bill one engagement for a month (D15). */
export interface Bill {
  engagementId: number;
  clientId: string;
  /** `2026-11`. */
  period: string;
  monthlyCents: number;
  units: number;
  unitCents: number;
  /** What a unit is, singular: "meeting booked". */
  unit: string | null;
  currency: string;
  payDays: number;
}
export const billCents = (b: Bill): number => b.monthlyCents + b.units * b.unitCents;

/**
 * The month's bills, from each signed contract's terms: the monthly fee while the work runs
 * (from the first month after it started), plus a fee for each unit not billed yet, until the
 * cap. A non-void invoice for the month means it's sent. Nothing owed, no bill. The demo has none.
 */
export async function billsDue(db: Queryable, period: string): Promise<Bill[]> {
  const rows = await db
    .select({ e: engagements, terms: agreements.terms })
    .from(engagements)
    .innerJoin(agreements, eq(agreements.engagementId, engagements.id))
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .where(
      and(
        inArray(engagements.status, ["active", "done"]),
        sql`${agreements.signedAt} is not null`,
        eq(clients.demo, false),
      ),
    );
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.e.id);
  const [billed, counts] = await Promise.all([
    db
      .select({
        engagementId: invoices.engagementId,
        period: invoices.period,
        units: invoices.units,
      })
      .from(invoices)
      .where(and(inArray(invoices.engagementId, ids), sql`${invoices.status} <> 'void'`)),
    db.select().from(results).where(inArray(results.engagementId, ids)),
  ]);
  return rows.flatMap(({ e, terms: t }): Bill[] => {
    const mine = billed.filter((b) => b.engagementId === e.id);
    if (mine.some((b) => b.period === period)) return [];
    const monthlyCents =
      e.status === "active" && t.monthlyCents && e.startsOn < `${period}-01` ? t.monthlyCents : 0;
    let units = 0;
    const measure = offerFor(e.offerId).perUnitMeasure;
    if (t.perUnitCents && measure) {
      const done = mine.reduce((n, b) => n + (b.units ?? 0), 0);
      const count = counts.find((r) => r.engagementId === e.id && r.key === measure)?.value ?? 0;
      const room =
        t.capCents === null
          ? Infinity
          : Math.floor((t.capCents - done * t.perUnitCents) / t.perUnitCents);
      units = Math.max(0, Math.min(Math.floor(count) - done, room));
    }
    const bill: Bill = {
      engagementId: e.id,
      clientId: e.clientId,
      period,
      monthlyCents,
      units,
      unitCents: t.perUnitCents ?? 0,
      unit: t.unit,
      currency: t.currency,
      payDays: t.payDays,
    };
    return billCents(bill) > 0 ? [bill] : [];
  });
}

/** Paid on a day (today by default), void, or open again. A paid setup fee may start the plan. */
export async function markInvoice(
  db: Queryable,
  clientId: string,
  number: string,
  status: string,
  on?: string,
): Promise<Invoice> {
  if (!INVOICE_STATUSES.includes(status as InvoiceStatus))
    throw bad(`an invoice is ${INVOICE_STATUSES.join(", ")}`);
  const [row] = await db
    .update(invoices)
    .set({
      status: status as InvoiceStatus,
      paidOn: status === "paid" ? dayOf(on ?? todayUtc(), "the paid date") : null,
    })
    .where(and(eq(invoices.number, number.trim()), ofClient(db, invoices.engagementId, clientId)))
    .returning();
  if (!row) throw missing(`invoice '${number}'`);
  if (row.status === "paid" && row.setup)
    await startIfReady(db, await engagementOf(db, clientId, row.engagementId));
  return row;
}

// --- onboarding: the contract, the setup fee, access ---------------------------

const cents = (dollars: number) => Math.round(dollars * 100);

/**
 * The terms an offer's price implies, in cents, with the operator's changes on
 * top. `flat` takes the offer's all-upfront option: its price as the setup fee,
 * no per-unit fee. Fixed and quoted prices are ranges or nothing: their fees
 * must be given.
 */
export function termsFor(offer: Offer, over: Partial<Terms> = {}, flat = false): Terms {
  const p = offer.price;
  const perf = p.kind === "performance" ? p : null;
  if (flat && perf?.flat == null) throw bad(`${offer.name} has no flat price`);
  const base: Terms = {
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
  const terms = termsFor(offer, input.terms, input.flat);
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
      .where(
        and(eq(invoices.engagementId, e.id), eq(invoices.setup, true), eq(invoices.status, "paid")),
      );
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

// --- reads ----------------------------------------------------------------------

/** The stored file of one of this client's deliverables or answered asks, or null. */
export async function storedFile(
  db: Queryable,
  clientId: string,
  of: { deliverableId: number } | { askId: number },
): Promise<string | null> {
  const [row] =
    "deliverableId" in of
      ? await db
          .select({ key: deliverables.fileKey })
          .from(deliverables)
          .where(
            and(
              eq(deliverables.id, of.deliverableId),
              ofClient(db, deliverables.engagementId, clientId),
            ),
          )
      : await db
          .select({ key: asks.fileKey })
          .from(asks)
          .where(and(eq(asks.id, of.askId), ofClient(db, asks.engagementId, clientId)));
  return row?.key ?? null;
}

/**
 * What a viewer may see of the timeline: the one place internal and hidden
 * updates are kept from a client (D12). Every read of `updates` goes through it.
 */
const seenBy = (operator: boolean): SQL | undefined =>
  operator ? undefined : and(eq(updates.internal, false), isNull(updates.hiddenAt));

export type MilestoneState = "done" | "late" | "now" | "next";
export interface StepView
  extends Pick<
    Milestone,
    "key" | "name" | "plannedFrom" | "plannedTo" | "dueOn" | "doneOn" | "slipReason" | "promised"
  > {
  state: MilestoneState;
}
export type CommentView = Pick<Comment, "id" | "author" | "fromWren" | "body"> & { at: string };
export type UpdateView = Pick<Update, "id" | "author" | "body" | "internal"> & {
  step: string | null;
  at: string;
  hidden: boolean;
  comments: CommentView[];
};
export type DeliverableView = Pick<
  Deliverable,
  "id" | "title" | "kind" | "url" | "version" | "status" | "decidedBy" | "decisionNote"
> & {
  step: string | null;
  file: string | null;
  at: string;
  decidedAt: string | null;
  comments: CommentView[];
};
export type AskView = Pick<Ask, "id" | "text" | "dueOn" | "answer" | "answeredBy"> & {
  step: string | null;
  /** The uploaded file's name, when the answer carries one. */
  file: string | null;
  answeredAt: string | null;
  overdue: boolean;
};
export interface ResultView {
  key: string;
  label: string;
  unit: string;
  value: number | null;
  note: string | null;
  at: string | null;
}
export type AccessView = Pick<
  AccessRequest,
  "id" | "system" | "scope" | "why" | "revoke" | "status" | "note" | "answeredBy"
> & { answeredAt: string | null };
/** The paperwork around the work: what Home and the welcome guide show of it. */
export interface PaperworkView {
  /** null: started without a contract. Its text and terms are read by owners only. */
  contract: { issuedAt: string; signedBy: string | null; signedAt: string | null } | null;
  /** null: no setup fee. */
  setupPaid: boolean | null;
  access: AccessView[];
}
export interface EngagementView {
  id: number;
  offer: {
    id: string;
    name: string;
    /** The portal app it runs in. */
    app: string;
    promise: string;
    guarantee: string | null;
    youGet: readonly string[];
    youGive: readonly string[];
  };
  paperwork: PaperworkView;
  startsOn: string;
  status: EngagementStatus;
  steps: StepView[];
  updates: UpdateView[];
  deliverables: DeliverableView[];
  asks: AskView[];
  results: ResultView[];
  pulse: PulseView;
  /** Moments reached, newest first, with the viewer's review (D13). */
  moments: MomentView[];
  /** Offers put to them once halfway (D13); empty until any has an upsell. */
  next: NextView[];
}
export interface ReviewView {
  email: string;
  score: number | null;
  words: string | null;
  mayQuote: QuoteConsent;
}
export interface MomentView {
  moment: string;
  label: string;
  reachedOn: string;
  /** The viewer's own review; null when none yet. */
  mine: ReviewView | null;
  /** Everyone's, for Wren's team only. */
  reviews: ReviewView[];
}
export interface NextView {
  id: string;
  name: string;
  promise: string;
  pitch: string;
  /** The viewer asked to hear more. */
  interested: boolean;
}
/** This week's pulse (D10). */
export interface PulseView {
  /** The Monday of this week. */
  week: string;
  /** The viewer's own tap this week; null when none or the viewer isn't the client's. */
  mine: number | null;
  /** Everyone's taps this week, for Wren's team only. */
  scores: number[];
}
export interface DeliveryHome {
  engagements: EngagementView[];
}

const stateOf = (m: Milestone, today: string): MilestoneState =>
  m.doneOn ? "done" : m.dueOn && m.dueOn < today ? "late" : m.plannedFrom <= today ? "now" : "next";

const HOME_UPDATES = 10;

/** The threads under these updates or deliverables, oldest first, by what they hang under. */
async function threads(
  db: Queryable,
  col: typeof comments.updateId | typeof comments.deliverableId,
  ids: number[],
): Promise<Map<number, CommentView[]>> {
  const out = new Map<number, CommentView[]>();
  if (ids.length === 0) return out;
  const rows = await db.select().from(comments).where(inArray(col, ids)).orderBy(asc(comments.id));
  for (const c of rows) {
    const on = (col === comments.updateId ? c.updateId : c.deliverableId) as number;
    const list = out.get(on) ?? [];
    list.push({
      id: c.id,
      author: c.author,
      fromWren: c.fromWren,
      body: c.body,
      at: c.createdAt.toISOString(),
    });
    out.set(on, list);
  }
  return out;
}

/** Everything Home shows, for each of a client's engagements, newest first (D7). */
export async function deliveryHome(
  db: Queryable,
  clientId: string,
  opts: { operator: boolean; today?: string; email?: string | null },
): Promise<DeliveryHome> {
  const today = opts.today ?? todayUtc();
  const week = mondayOf(today);
  const es = await db
    .select()
    .from(engagements)
    .where(eq(engagements.clientId, clientId))
    .orderBy(desc(engagements.startsOn), desc(engagements.id));
  if (es.length === 0) return { engagements: [] };
  const ids = es.map((e) => e.id);
  const [ms, ds, as, rs, ps, ags, acc, setups, mos, rvs, ints] = await Promise.all([
    db
      .select()
      .from(milestones)
      .where(inArray(milestones.engagementId, ids))
      .orderBy(asc(milestones.position)),
    // Latest versions only: an older one is history, reached from its successor.
    db
      .select()
      .from(deliverables)
      .where(
        and(
          inArray(deliverables.engagementId, ids),
          sql`not exists (select 1 from ${deliverables} n where n.previous_id = ${deliverables.id})`,
        ),
      )
      .orderBy(desc(deliverables.createdAt), desc(deliverables.id)),
    db
      .select()
      .from(asks)
      .where(inArray(asks.engagementId, ids))
      .orderBy(asc(asks.dueOn), asc(asks.id)),
    db.select().from(results).where(inArray(results.engagementId, ids)),
    db
      .select()
      .from(pulses)
      .where(and(inArray(pulses.engagementId, ids), eq(pulses.week, week))),
    db.select().from(agreements).where(inArray(agreements.engagementId, ids)),
    db
      .select()
      .from(accessRequests)
      .where(inArray(accessRequests.engagementId, ids))
      .orderBy(asc(accessRequests.id)),
    db
      .select({ id: invoices.engagementId })
      .from(invoices)
      .where(
        and(
          inArray(invoices.engagementId, ids),
          eq(invoices.setup, true),
          eq(invoices.status, "paid"),
        ),
      ),
    db
      .select()
      .from(moments)
      .where(inArray(moments.engagementId, ids))
      .orderBy(desc(moments.reachedOn)),
    db.select().from(reviews).where(inArray(reviews.engagementId, ids)),
    db.select().from(interests).where(inArray(interests.engagementId, ids)),
  ]);
  const reviewOf = (r: (typeof rvs)[number]): ReviewView => ({
    email: r.email,
    score: r.score,
    words: r.words,
    mayQuote: r.mayQuote,
  });
  const stepKey = new Map(ms.map((m) => [m.id, m.key]));
  const talk = await threads(
    db,
    comments.deliverableId,
    ds.map((d) => d.id),
  );
  const timelines = await Promise.all(
    es.map((e) =>
      timeline(db, clientId, { operator: opts.operator, engagementId: e.id, limit: HOME_UPDATES }),
    ),
  );
  return {
    engagements: es.map((e, i) => {
      const offer = offerFor(e.offerId);
      const ag = ags.find((a) => a.engagementId === e.id);
      return {
        id: e.id,
        offer: {
          id: offer.id,
          name: offer.name,
          app: appOf(offer.id),
          promise: offer.promise,
          guarantee: offer.guarantee,
          youGet: offer.youGet,
          youGive: offer.youGive,
        },
        paperwork: {
          contract: ag
            ? {
                issuedAt: ag.issuedAt.toISOString(),
                signedBy: ag.signerName,
                signedAt: ag.signedAt?.toISOString() ?? null,
              }
            : null,
          setupPaid: ag && ag.terms.setupCents > 0 ? setups.some((x) => x.id === e.id) : null,
          access: acc
            .filter((r) => r.engagementId === e.id)
            .map((r) => ({
              id: r.id,
              system: r.system,
              scope: r.scope,
              why: r.why,
              revoke: r.revoke,
              status: r.status,
              note: r.note,
              answeredBy: r.answeredBy,
              answeredAt: r.answeredAt?.toISOString() ?? null,
            })),
        },
        startsOn: e.startsOn,
        status: e.status,
        steps: ms
          .filter((m) => m.engagementId === e.id)
          .map((m) => ({
            key: m.key,
            name: m.name,
            plannedFrom: m.plannedFrom,
            plannedTo: m.plannedTo,
            dueOn: m.dueOn,
            doneOn: m.doneOn,
            slipReason: m.slipReason,
            promised: m.promised,
            state: e.status === "onboarding" ? "next" : stateOf(m, today),
          })),
        updates: timelines[i]?.updates ?? [],
        deliverables: ds
          .filter((d) => d.engagementId === e.id)
          .map((d) => ({
            id: d.id,
            title: d.title,
            kind: d.kind,
            url: d.url,
            version: d.version,
            status: d.status,
            decidedBy: d.decidedBy,
            decisionNote: d.decisionNote,
            step: d.milestoneId === null ? null : (stepKey.get(d.milestoneId) ?? null),
            file: d.fileKey && fileNameOf(d.fileKey),
            at: d.createdAt.toISOString(),
            decidedAt: d.decidedAt?.toISOString() ?? null,
            comments: talk.get(d.id) ?? [],
          })),
        asks: as
          .filter((a) => a.engagementId === e.id)
          .map((a) => ({
            id: a.id,
            text: a.text,
            dueOn: a.dueOn,
            answer: a.answer,
            answeredBy: a.answeredBy,
            step: a.milestoneId === null ? null : (stepKey.get(a.milestoneId) ?? null),
            file: a.fileKey && fileNameOf(a.fileKey),
            answeredAt: a.answeredAt?.toISOString() ?? null,
            overdue:
              e.status !== "onboarding" && !a.answeredAt && a.dueOn !== null && a.dueOn < today,
          })),
        results: offer.measures.map((m) => {
          const r = rs.find((x) => x.engagementId === e.id && x.key === m.key);
          return {
            key: m.key,
            label: m.label,
            unit: m.unit,
            value: r?.value ?? null,
            note: r?.note ?? null,
            at: r?.updatedAt.toISOString() ?? null,
          };
        }),
        pulse: {
          week,
          mine: ps.find((p) => p.engagementId === e.id && p.email === opts.email)?.score ?? null,
          scores: opts.operator
            ? ps.filter((p) => p.engagementId === e.id).map((p) => p.score)
            : [],
        },
        moments: mos
          .filter((m) => m.engagementId === e.id)
          .flatMap((m) => {
            const label = momentLabel(offer, m.moment);
            if (!label) return [];
            const said = rvs.filter((r) => r.engagementId === e.id && r.moment === m.moment);
            const mine = said.find((r) => r.email === opts.email);
            return [
              {
                moment: m.moment,
                label,
                reachedOn: m.reachedOn,
                mine: mine ? reviewOf(mine) : null,
                reviews: opts.operator ? said.map(reviewOf) : [],
              },
            ];
          }),
        next: mos.some(
          (m) => m.engagementId === e.id && (m.moment === HALFWAY || m.moment === LAST_WEEK),
        )
          ? nextOffers(offer).map((o) => ({
              id: o.id,
              name: o.name,
              promise: o.promise,
              pitch: o.upsell?.pitch ?? "",
              interested: ints.some(
                (i) => i.engagementId === e.id && i.offerId === o.id && i.email === opts.email,
              ),
            }))
          : [],
      };
    }),
  };
}

/** The timeline, newest first, a page at a time: `before` is the last id seen. */
export async function timeline(
  db: Queryable,
  clientId: string,
  opts: { operator: boolean; engagementId?: number; before?: number; limit?: number },
): Promise<{ updates: UpdateView[]; more: boolean }> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const rows = await db
    .select({ u: updates, step: milestones.key })
    .from(updates)
    .innerJoin(engagements, eq(engagements.id, updates.engagementId))
    .leftJoin(milestones, eq(milestones.id, updates.milestoneId))
    .where(
      and(
        eq(engagements.clientId, clientId),
        opts.engagementId === undefined ? undefined : eq(updates.engagementId, opts.engagementId),
        opts.before === undefined ? undefined : lt(updates.id, opts.before),
        seenBy(opts.operator),
      ),
    )
    .orderBy(desc(updates.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const talk = await threads(
    db,
    comments.updateId,
    page.map(({ u }) => u.id),
  );
  return {
    updates: page.map(({ u, step }) => ({
      id: u.id,
      author: u.author,
      body: u.body,
      internal: u.internal,
      step,
      at: u.createdAt.toISOString(),
      hidden: u.hiddenAt !== null,
      comments: talk.get(u.id) ?? [],
    })),
    more: rows.length > limit,
  };
}

export type InvoiceView = Pick<
  Invoice,
  "id" | "number" | "description" | "cents" | "currency" | "issuedOn" | "dueOn" | "paidOn" | "link"
> & {
  /** Overdue: open and past its due day. */
  status: InvoiceStatus | "overdue";
  /** The offer it bills for, by name. */
  offer: string;
};

/** The client's invoices, newest first. */
export async function invoicesOf(
  db: Queryable,
  clientId: string,
  today = todayUtc(),
): Promise<InvoiceView[]> {
  const rows = await db
    .select({ i: invoices, offerId: engagements.offerId })
    .from(invoices)
    .innerJoin(engagements, eq(engagements.id, invoices.engagementId))
    .where(eq(engagements.clientId, clientId))
    .orderBy(desc(invoices.issuedOn), desc(invoices.id));
  return rows.map(({ i, offerId }) => ({
    id: i.id,
    number: i.number,
    description: i.description,
    cents: i.cents,
    currency: i.currency,
    issuedOn: i.issuedOn,
    dueOn: i.dueOn,
    paidOn: i.paidOn,
    link: i.link,
    status: i.status === "open" && i.dueOn < today ? "overdue" : i.status,
    offer: offerFor(offerId).name,
  }));
}

/** What the client has bought from us, newest first, for their account page. */
export async function boughtBy(
  db: Queryable,
  clientId: string,
): Promise<
  {
    id: number;
    offerId: string;
    offer: string;
    /** The portal app it runs in. */
    app: string;
    startsOn: string;
    status: EngagementStatus;
  }[]
> {
  const rows = await db
    .select()
    .from(engagements)
    .where(eq(engagements.clientId, clientId))
    .orderBy(desc(engagements.startsOn), desc(engagements.id));
  return rows.map((e) => ({
    id: e.id,
    offerId: e.offerId,
    offer: offerFor(e.offerId).name,
    app: appOf(e.offerId),
    startsOn: e.startsOn,
    status: e.status,
  }));
}
