/**
 * Delivery: what we do for each client (D1–D12). An engagement is a bought
 * offer with its plan dated from a start day; the timeline, deliverables, asks
 * and results hang off it. A foundation: products post into it, it never
 * imports one. Every write names the client, and a row of another client's
 * is "not found", so one client can never reach another's by id.
 */
import type { Queryable } from "@wren/db";
import { OFFER_IDS, type Offer, offerFor } from "@wren/offers";
import { and, asc, desc, eq, inArray, isNull, lt, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  type Ask,
  asks,
  type Deliverable,
  type DeliverableKind,
  type DeliverableState,
  deliverables,
  type Engagement,
  type EngagementStatus,
  engagements,
  type Milestone,
  milestones,
  results,
  type Update,
  updates,
} from "./schema.js";

export * from "./schema.js";

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

/** The client's engagement: by id, or the one that's active when there's one. */
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
    .where(and(eq(engagements.clientId, clientId), eq(engagements.status, "active")));
  if (active.length === 0) throw missing("active engagement");
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
  input: { clientId: string; offerId: string; startsOn: string; by: string },
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
        eq(engagements.status, "active"),
      ),
    );
  if (running) throw new DeliveryRefusal(`${offer.name} is already running for this client`, 409);
  const [e] = await db
    .insert(engagements)
    .values({
      clientId: input.clientId,
      offerId: offer.id,
      startsOn: input.startsOn,
      createdBy: input.by,
    })
    .returning();
  if (!e) throw new Error("engagement insert returned nothing");
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
  await db.update(engagements).set({ status }).where(eq(engagements.id, id));
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

/** Hand something over (D4). `replaces` makes it the next version of that one, waiting again. */
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

// --- reads ----------------------------------------------------------------------

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
export type UpdateView = Pick<Update, "id" | "author" | "body" | "internal"> & {
  step: string | null;
  at: string;
  hidden: boolean;
};
export type DeliverableView = Pick<
  Deliverable,
  "id" | "title" | "kind" | "url" | "version" | "status" | "decidedBy" | "decisionNote"
> & { step: string | null; hasFile: boolean; at: string; decidedAt: string | null };
export type AskView = Pick<Ask, "id" | "text" | "dueOn" | "answer" | "answeredBy"> & {
  step: string | null;
  hasFile: boolean;
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
export interface EngagementView {
  id: number;
  offer: { id: string; name: string };
  startsOn: string;
  status: EngagementStatus;
  steps: StepView[];
  updates: UpdateView[];
  deliverables: DeliverableView[];
  asks: AskView[];
  results: ResultView[];
}
export interface DeliveryHome {
  engagements: EngagementView[];
}

const stateOf = (m: Milestone, today: string): MilestoneState =>
  m.doneOn ? "done" : m.dueOn && m.dueOn < today ? "late" : m.plannedFrom <= today ? "now" : "next";

const HOME_UPDATES = 10;

/** Everything Home shows, for each of a client's engagements, newest first (D7). */
export async function deliveryHome(
  db: Queryable,
  clientId: string,
  opts: { operator: boolean; today?: string },
): Promise<DeliveryHome> {
  const today = opts.today ?? todayUtc();
  const es = await db
    .select()
    .from(engagements)
    .where(eq(engagements.clientId, clientId))
    .orderBy(desc(engagements.startsOn), desc(engagements.id));
  if (es.length === 0) return { engagements: [] };
  const ids = es.map((e) => e.id);
  const [ms, ds, as, rs] = await Promise.all([
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
  ]);
  const stepKey = new Map(ms.map((m) => [m.id, m.key]));
  const timelines = await Promise.all(
    es.map((e) =>
      timeline(db, clientId, { operator: opts.operator, engagementId: e.id, limit: HOME_UPDATES }),
    ),
  );
  return {
    engagements: es.map((e, i) => {
      const offer = offerFor(e.offerId);
      return {
        id: e.id,
        offer: { id: offer.id, name: offer.name },
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
            state: stateOf(m, today),
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
            hasFile: d.fileKey !== null,
            at: d.createdAt.toISOString(),
            decidedAt: d.decidedAt?.toISOString() ?? null,
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
            hasFile: a.fileKey !== null,
            answeredAt: a.answeredAt?.toISOString() ?? null,
            overdue: !a.answeredAt && a.dueOn !== null && a.dueOn < today,
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
  return {
    updates: rows.slice(0, limit).map(({ u, step }) => ({
      id: u.id,
      author: u.author,
      body: u.body,
      internal: u.internal,
      step,
      at: u.createdAt.toISOString(),
      hidden: u.hiddenAt !== null,
    })),
    more: rows.length > limit,
  };
}
