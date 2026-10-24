/** What the portal reads: paperwork, pulses, threads, Home, the timeline, invoices and what was bought (D7). */
import type { Queryable } from "@wren/db";
import { offerFor } from "@wren/offers";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { fileNameOf } from "./files.js";
import { appOf, HALFWAY, LAST_WEEK, momentLabel, nextOffers } from "./moments.js";
import { setupHolds } from "./onboarding.js";
import { mondayOf, ofClient, seenBy, todayUtc } from "./rows.js";
import {
  type AccessRequest,
  type Ask,
  accessRequests,
  agreements,
  asks,
  type Comment,
  comments,
  type Deliverable,
  deliverables,
  type EngagementStatus,
  engagements,
  type Invoice,
  type InvoiceStatus,
  interests,
  invoices,
  type Milestone,
  milestones,
  moments,
  pulses,
  type QuoteConsent,
  results,
  reviews,
  type Update,
  updates,
} from "./schema.js";

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
      .where(and(inArray(invoices.engagementId, ids), setupHolds)),
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
  | "id"
  | "number"
  | "description"
  | "cents"
  | "currency"
  | "issuedOn"
  | "dueOn"
  | "paidOn"
  | "refundedCents"
  | "dispute"
  | "receivedCents"
  | "lines"
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
    refundedCents: i.refundedCents,
    dispute: i.dispute,
    receivedCents: i.receivedCents,
    lines: i.lines,
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
    /** The component offered with it at setup, if any (`Offer.addOn`). */
    addOn: string | null;
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
    addOn: offerFor(e.offerId).addOn ?? null,
    startsOn: e.startsOn,
    status: e.status,
  }));
}
