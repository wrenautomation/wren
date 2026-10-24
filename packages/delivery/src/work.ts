/**
 * The work on an engagement (D1–D10): start an offer, post and take down updates, deliverables
 * and the client's decision on them, comments, asks and answers, milestones done or slipped,
 * results and the weekly pulse.
 */
import { CHANNELS, type Channel, clients } from "@wren/core/clients";
import { staleRefusal } from "@wren/core/refusal";
import type { Queryable } from "@wren/db";
import { OFFER_IDS, type Offer, offerFor } from "@wren/offers";
import { and, eq, inArray, sql } from "drizzle-orm";
import { DELIVERY_COMPONENTS } from "./components.js";
import {
  addDays,
  bad,
  DeliveryRefusal,
  dayOf,
  engagementOf,
  fileKeyOf,
  linkOf,
  milestoneIdOf,
  milestoneOf,
  missing,
  mondayOf,
  ofClient,
  RUNNING,
  seenBy,
  textIn,
  todayUtc,
} from "./rows.js";
import {
  type Ask,
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
  type Milestone,
  milestones,
  pulses,
  results,
  type Update,
  updates,
} from "./schema.js";

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
    // Only a waiting one, or the same answer again (a second press): a decision someone else
    // made meanwhile is never overwritten by a page that didn't see it.
    .where(
      and(
        eq(deliverables.id, input.id),
        ofClient(db, deliverables.engagementId, clientId),
        inArray(deliverables.status, ["waiting", input.decision]),
      ),
    )
    .returning();
  if (d) return d;
  const [was] = await db
    .select({ id: deliverables.id })
    .from(deliverables)
    .where(and(eq(deliverables.id, input.id), ofClient(db, deliverables.engagementId, clientId)));
  if (!was) throw missing("deliverable");
  throw staleRefusal("deliverable");
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
