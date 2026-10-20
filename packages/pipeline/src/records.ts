/**
 * The pipeline as records (designs/2026-10-19-business-map.md): offers, the shape, journeys,
 * deals and numbers. One workspace each: the database a type is served from (Wren's, or a
 * client's) holds the rows, so no row carries an owner.
 *
 * Served by `PipelineConsole`. Writes go through its handlers and the `Journeys` service, never
 * through a record edit.
 */

import { keysOfProfile } from "@wren/core/profiles";
import { profiles } from "@wren/core/profiles-schema";
import {
  actor,
  date,
  defineRecord,
  money,
  number,
  type RecordType,
  status,
  text,
} from "@wren/core/records";
import { events } from "@wren/core/schema";
import type { Queryable } from "@wren/db";
import type { Terms } from "@wren/offers";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { ShapeBody } from "./model.js";
import { subjectOf } from "./moves.js";
import { type NumberRow, numberRows } from "./numbers.js";
import { scheduleOf } from "./schedule.js";
import { journeys, offerVersions, pipelineDeals, shapeVersions, termsVersions } from "./schema.js";

export const OFFER_RECORD = "pipeline.offer";
export const SHAPE_RECORD = "pipeline.shape";
export const JOURNEY_RECORD = "pipeline.journey";
export const DEAL_RECORD = "pipeline.deal";
export const NUMBER_RECORD = "pipeline.number";
export const TERMS_RECORD = "pipeline.terms";
export const ENTRY_RECORD = "pipeline.entry";

/** Days an open journey sits at one node before it reads stale, unless the node sets `idleDays`. */
export const STALE_DAYS = 14;
const DAY_MS = 86_400_000;
/** Rows, not a view: a workspace works hundreds of journeys, not tens of thousands. */
const ROWS = 2000;

const OFFER_STATES = {
  draft: { label: "Draft", tone: "neutral" },
  live: { label: "Live", tone: "good" },
  paused: { label: "Paused", tone: "warn" },
  retired: { label: "Retired", tone: "neutral" },
} as const;
const KIND_STATES = {
  source: { label: "Source", tone: "neutral" },
  step: { label: "Step", tone: "neutral" },
  offer: { label: "Offer", tone: "good" },
  plan: { label: "Plan", tone: "neutral" },
} as const;
const JOURNEY_STATES = {
  open: { label: "Open", tone: "neutral" },
  done: { label: "Done", tone: "good" },
  dropped: { label: "Dropped", tone: "bad" },
} as const;
const JOURNEY_FLAGS = { stale: { label: "Stale", tone: "warn" } } as const;
const PARKED_STATES = { parked: { label: "Parked", tone: "neutral" } } as const;
/** A ghost sits on a node its version has and the newest shape lacks. */
const GHOST_STATES = { ghost: { label: "Ghost", tone: "warn" } } as const;
const DEAL_STATES = {
  open: { label: "Open", tone: "neutral" },
  won: { label: "Won", tone: "good" },
  lost: { label: "Lost", tone: "bad" },
  ended: { label: "Ended", tone: "neutral" },
} as const;
const TERMS_STATES = {
  live: { label: "Live", tone: "good" },
  upcoming: { label: "Upcoming", tone: "warn" },
  older: { label: "Older", tone: "neutral" },
} as const;
const NUMBER_KINDS = {
  node: { label: "Node", tone: "neutral" },
  edge: { label: "Edge", tone: "neutral" },
  offer: { label: "Offer", tone: "neutral" },
} as const;

const nameOf = (body: ShapeBody | undefined, id: string) =>
  body?.nodes.find((n) => n.id === id)?.name ?? id;

// --- offers ----------------------------------------------------------------------------------

/** The newest version of each offer, as rows, with its live plans and open journeys. */
export async function offerRows(db: Queryable, o: { now?: Date } = {}) {
  const rows = await db
    .selectDistinctOn([offerVersions.offer])
    .from(offerVersions)
    .orderBy(offerVersions.offer, desc(offerVersions.number))
    .limit(ROWS);
  // A plan is live when some version of it has started: count the plans, per offer.
  const today = (o.now ?? new Date()).toISOString().slice(0, 10);
  const started = await db
    .selectDistinct({ offer: termsVersions.offer, plan: termsVersions.plan })
    .from(termsVersions)
    .where(lte(termsVersions.effectiveFrom, today));
  const plans = new Map<string, number>();
  for (const p of started) plans.set(p.offer, (plans.get(p.offer) ?? 0) + 1);
  // An open journey sits on a node of its shape version. The offer it works toward is the
  // nearest offer node at or above it: the node's own, else the one it passed on its trail.
  const open = new Map<string, number>();
  const heads = await db
    .select({ node: journeys.node, trail: journeys.trail, body: shapeVersions.body })
    .from(journeys)
    .innerJoin(shapeVersions, eq(shapeVersions.number, journeys.version))
    .where(eq(journeys.status, "open"))
    .limit(ROWS);
  for (const h of heads) {
    const at = h.body.nodes.find((n) => n.id === h.node);
    const seen = [h.node, ...h.trail.map((c) => c.to).reverse()];
    const offer = seen
      .map((id) => h.body.nodes.find((n) => n.id === id))
      .find((n) => n?.kind === "offer");
    const id = at?.kind === "offer" ? at.offer : offer?.kind === "offer" ? offer.offer : null;
    if (id) open.set(id, (open.get(id) ?? 0) + 1);
  }
  return rows.map((r) => ({
    id: r.offer,
    name: r.body.name,
    status: r.body.status,
    version: r.number,
    audience: r.body.audience,
    promise: r.body.promise,
    live_plans: plans.get(r.offer) ?? 0,
    open_journeys: open.get(r.offer) ?? 0,
    hash: r.hash.slice(0, 12),
    synced_at: r.createdAt,
    synced_by: r.createdBy,
    why: r.why,
  }));
}

export const offerRecord = (): RecordType =>
  defineRecord({
    id: OFFER_RECORD,
    app: "deals",
    channel: null,
    name: { one: "offer", many: "offers" },
    rows: (db) => offerRows(db),
    key: "id",
    title: "name",
    subtitle: "audience",
    fields: {
      name: text("Offer"),
      status: status(OFFER_STATES, "Status"),
      version: number("Version"),
      audience: text("For"),
      promise: text("Promise", { listed: false }),
      livePlans: number("Live plans"),
      openJourneys: number("Open journeys"),
      hash: text("Hash", { listed: false }),
      syncedAt: date("Synced"),
      syncedBy: actor("Synced by"),
      why: text("Why", { listed: false }),
    },
    views: [
      { id: "live", label: "Live", where: { status: "live" }, sort: "name", at: "syncedAt" },
      { id: "all", label: "All", sort: "name", at: "syncedAt" },
    ],
    related: [{ record: TERMS_RECORD, by: "offer" }],
    /** Every version, newest first: what changed and why. */
    load: async (db, id) => ({
      versions: (
        await db
          .select()
          .from(offerVersions)
          .where(eq(offerVersions.offer, String(id)))
          .orderBy(desc(offerVersions.number))
      ).map((v) => ({
        number: v.number,
        hash: v.hash.slice(0, 12),
        why: v.why,
        at: v.createdAt,
        by: v.createdBy,
      })),
    }),
  });

// --- terms -----------------------------------------------------------------------------------

const money2 = (cents: number) => (cents / 100).toFixed(2);

/**
 * The parts of a terms body a person reads, as one line: what is charged, how long, when due.
 * A field the body does not set is left out.
 */
export function readTerms(t: Terms): string {
  const cur = t.currency.toUpperCase();
  const parts: string[] = [];
  if (t.setupCents) parts.push(`setup ${money2(t.setupCents)} ${cur}`);
  if (t.monthlyCents) parts.push(`${money2(t.monthlyCents)} ${cur} a month`);
  if (t.perUnitCents)
    parts.push(
      `${money2(t.perUnitCents)} ${cur} per ${t.unit ?? "unit"}${
        t.capCents ? `, up to ${money2(t.capCents)}` : ""
      }`,
    );
  if (t.shareBps)
    parts.push(
      `${t.shareBps / 100}% share${t.floorCents ? `, least ${money2(t.floorCents)}` : ""}`,
    );
  if (t.installments)
    parts.push(`setup in ${t.installments.count} parts, every ${t.installments.everyDays} days`);
  if (t.trialDays) parts.push(`${t.trialDays} days trial`);
  if (t.days) parts.push(`${t.days} days`);
  parts.push(`due in ${t.payDays} days`);
  return parts.join(", ");
}

/** Every terms version as a row; its state against `now`: live, upcoming or older. */
export async function termsRows(db: Queryable, o: { now?: Date } = {}) {
  const today = (o.now ?? new Date()).toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(termsVersions)
    .orderBy(termsVersions.offer, termsVersions.plan, desc(termsVersions.number))
    .limit(ROWS);
  // Newest first within a plan, and a version never starts before the one before it: the first
  // one that has started is live, those above it are upcoming, those below it are older.
  const seen = new Set<string>();
  return rows.map((r) => {
    const plan = `${r.offer}/${r.plan}`;
    const started = r.effectiveFrom <= today;
    const state = started ? (seen.has(plan) ? "older" : "live") : "upcoming";
    if (started) seen.add(plan);
    return {
      id: r.id,
      offer: r.offer,
      plan: r.plan,
      number: r.number,
      effective_from: r.effectiveFrom,
      state,
      terms: readTerms(r.body),
      why: r.why,
      created_at: r.createdAt,
      created_by: r.createdBy,
    };
  });
}

export const termsRecord = (): RecordType =>
  defineRecord({
    id: TERMS_RECORD,
    app: "deals",
    channel: null,
    name: { one: "terms version", many: "terms versions" },
    rows: (db) => termsRows(db),
    key: "id",
    title: "plan",
    subtitle: "offer",
    fields: {
      offer: text("Offer"),
      plan: text("Plan"),
      number: number("Version"),
      effectiveFrom: date("From"),
      state: status(TERMS_STATES, "State"),
      terms: text("Terms"),
      why: text("Why"),
      createdAt: date("Added"),
      createdBy: actor("Added by"),
    },
    views: [
      {
        id: "live",
        label: "Live",
        where: { state: "live" },
        sort: "offer",
        at: "effectiveFrom",
      },
      { id: "all", label: "All", sort: "-effectiveFrom", at: "effectiveFrom" },
    ],
    quick: ["offer", "plan", "state"],
    actions: ["pipeline.termsAdd"],
    /** The whole body, as stored: every field the plan sets. */
    load: async (db, id) => {
      const [v] = await db
        .select({ body: termsVersions.body })
        .from(termsVersions)
        .where(eq(termsVersions.id, Number(id)))
        .limit(1);
      return v ? { body: v.body } : null;
    },
  });

// --- shape -----------------------------------------------------------------------------------

/**
 * The shape: one row, the newest version's body with the depths and the version list. The row's
 * id is the version number, so a reader sees which version it holds.
 */
export async function shapeRows(db: Queryable) {
  const [top] = await db.select().from(shapeVersions).orderBy(desc(shapeVersions.number)).limit(1);
  if (!top) return [];
  const opens = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(journeys)
    .where(eq(journeys.status, "open"));
  return [
    {
      id: "shape",
      name: top.body.name,
      version: top.number,
      nodes: top.body.nodes.length,
      edges: top.body.edges.length,
      open_journeys: opens[0]?.n ?? 0,
      why: top.note,
      changed_at: top.createdAt,
      changed_by: top.createdBy,
    },
  ];
}

export const shapeRecord = (): RecordType =>
  defineRecord({
    id: SHAPE_RECORD,
    app: "deals",
    channel: null,
    name: { one: "shape", many: "shapes" },
    rows: (db) => shapeRows(db),
    key: "id",
    title: "name",
    subtitle: "why",
    fields: {
      name: text("Shape"),
      version: number("Version"),
      nodes: number("Nodes"),
      edges: number("Edges"),
      openJourneys: number("Open journeys"),
      why: text("Last change", { listed: false }),
      changedAt: date("Changed"),
      changedBy: actor("Changed by"),
    },
    views: [{ id: "all", label: "All", sort: "name", at: "changedAt" }],
    actions: [
      "pipeline.shapeVersion",
      "pipeline.shapeDiff",
      "pipeline.shapeImport",
      "pipeline.shapeStart",
    ],
    /** The newest body with each node's depth, and every version: what changed and why. */
    load: async (db) => {
      const versions = await db.select().from(shapeVersions).orderBy(desc(shapeVersions.number));
      const top = versions[0];
      if (!top) return null;
      return {
        body: top.body,
        depths: top.depths,
        versions: versions.map((v) => ({
          number: v.number,
          parent: v.parent,
          note: v.note,
          at: v.createdAt,
          by: v.createdBy,
          nodes: v.body.nodes.length,
          edges: v.body.edges.length,
        })),
      };
    },
  });

// --- journeys --------------------------------------------------------------------------------

/**
 * The operator behind each journey's newest hand move or hand open: the cause's `ref` on a
 * `manual` arrival. Null where the spine moved it alone. The only owner a journey has.
 */
async function ownersOf(db: Queryable, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db
    .selectDistinctOn([events.subject], {
      subject: events.subject,
      ref: sql<string | null>`${events.data} -> 'cause' ->> 'ref'`,
    })
    .from(events)
    .where(
      and(
        inArray(events.subject, ids.map(subjectOf)),
        sql`${events.workflow} like 'shape.%'`,
        sql`left(${events.node}, 2) = 's_'`,
        sql`${events.data} -> 'cause' ->> 'kind' = 'manual'`,
      ),
    )
    .orderBy(events.subject, desc(events.at));
  return new Map(rows.flatMap((r) => (r.ref ? [[r.subject.slice("journey:".length), r.ref]] : [])));
}

/** A journey's arrivals and its drop, oldest first: what the spine saw. */
export async function trailOf(db: Queryable, id: string) {
  const rows = await db
    .select({
      at: events.at,
      workflow: events.workflow,
      node: events.node,
      cause: sql<string | null>`${events.data} -> 'cause' ->> 'kind'`,
      ref: sql<string | null>`${events.data} -> 'cause' ->> 'ref'`,
    })
    .from(events)
    .where(and(eq(events.subject, subjectOf(id)), sql`${events.workflow} like 'shape.%'`))
    .orderBy(events.at, events.id);
  return rows.filter((r) => r.node.startsWith("s_") || r.node === "dropped");
}

/** Journeys as rows, newest move first; one journey when `id` is given. */
export async function journeyRows(db: Queryable, o: { id?: string; now?: Date } = {}) {
  const rows = await db
    .select({
      j: journeys,
      person: profiles.name,
      body: shapeVersions.body,
    })
    .from(journeys)
    .innerJoin(profiles, eq(profiles.id, journeys.profileId))
    .leftJoin(shapeVersions, eq(shapeVersions.number, journeys.version))
    .where(o.id ? eq(journeys.id, o.id) : undefined)
    .orderBy(desc(journeys.movedAt))
    .limit(ROWS);
  const [top] = await db
    .select({ number: shapeVersions.number, body: shapeVersions.body })
    .from(shapeVersions)
    .orderBy(desc(shapeVersions.number))
    .limit(1);
  const owners = await ownersOf(
    db,
    rows.map((r) => r.j.id),
  );
  // Each person's addresses, so a row from another record (a reply, a call) finds their journey.
  const emails = new Map<number, string[]>();
  for (const k of await keysOfProfile(db, [...new Set(rows.map((r) => r.j.profileId))]))
    if (k.kind === "email") emails.set(k.profileId, [...(emails.get(k.profileId) ?? []), k.value]);
  const now = (o.now ?? new Date()).getTime();
  return rows.map(({ j, person, body }) => {
    const days = Math.floor((now - j.movedAt.getTime()) / DAY_MS);
    const node = j.node;
    const at = body?.nodes.find((n) => n.id === node);
    const idle = (at && "idleDays" in at ? at.idleDays : undefined) ?? STALE_DAYS;
    // A ghost: its version is not the newest and the newest shape has no such node.
    const ghost =
      j.status === "open" &&
      !!top &&
      j.version < top.number &&
      !top.body.nodes.some((n) => n.id === node);
    return {
      id: j.id,
      name: person ?? `Person ${j.profileId}`,
      profile: j.profileId,
      email: (emails.get(j.profileId) ?? []).join(" "),
      version: j.version,
      node,
      node_name: nameOf(body ?? undefined, node),
      trail: j.trail.map((c) => nameOf(body ?? undefined, c.to)).join(" > "),
      status: j.status,
      flag: j.status === "open" && days >= idle ? "stale" : null,
      ghost: ghost ? "ghost" : null,
      entry: j.entry,
      owner: owners.get(j.id) ?? null,
      days_at_node: days,
      reason: j.dropReason,
      opened_at: j.openedAt,
      moved_at: j.movedAt,
      closed_at: j.closedAt,
    };
  });
}

export const journeyRecord = (): RecordType =>
  defineRecord({
    id: JOURNEY_RECORD,
    app: "deals",
    channel: null,
    name: { one: "journey", many: "journeys" },
    rows: (db) => journeyRows(db),
    key: "id",
    title: "name",
    subtitle: "nodeName",
    fields: {
      name: text("Person"),
      profile: number("Profile", { listed: false }),
      email: text("Emails", { listed: false }),
      node: text("Node id", { listed: false }),
      nodeName: text("Node"),
      trail: text("Trail", { listed: false }),
      status: status(JOURNEY_STATES, "Status"),
      flag: status(JOURNEY_FLAGS, "Needs"),
      ghost: status(GHOST_STATES, "Ghost"),
      entry: text("Source"),
      owner: actor("Moved by hand by"),
      daysAtNode: number("Days at node"),
      version: number("Shape version", { listed: false }),
      reason: text("Dropped because", { listed: false }),
      openedAt: date("Opened"),
      movedAt: date("Moved"),
      closedAt: date("Closed"),
    },
    views: [
      { id: "open", label: "Open", where: { status: "open" }, sort: "-movedAt", at: "openedAt" },
      {
        id: "mine",
        label: "Mine",
        where: { status: "open" },
        mine: "owner",
        sort: "-movedAt",
        at: "openedAt",
      },
      { id: "stale", label: "Stale", where: { flag: "stale" }, sort: "movedAt", at: "movedAt" },
      { id: "ghost", label: "Ghosts", where: { ghost: "ghost" }, sort: "movedAt", at: "movedAt" },
      { id: "done", label: "Done", where: { status: "done" }, sort: "-closedAt", at: "closedAt" },
      {
        id: "dropped",
        label: "Dropped",
        where: { status: "dropped" },
        sort: "-closedAt",
        at: "closedAt",
      },
      { id: "all", label: "All", sort: "-openedAt", at: "openedAt" },
    ],
    quick: ["node", "entry", "status"],
    related: [{ record: DEAL_RECORD, by: "journey" }],
    /** The edges it crossed, in order, with the node names of its own version. */
    load: async (db, id) => {
      const [r] = await db
        .select({ trail: journeys.trail, body: shapeVersions.body })
        .from(journeys)
        .leftJoin(shapeVersions, eq(shapeVersions.number, journeys.version))
        .where(eq(journeys.id, String(id)))
        .limit(1);
      if (!r) return null;
      return {
        trail: r.trail.map((c) => ({
          edge: c.edge,
          from: c.from,
          from_name: c.from ? nameOf(r.body ?? undefined, c.from) : null,
          to: c.to,
          to_name: nameOf(r.body ?? undefined, c.to),
          at: c.at,
        })),
      };
    },
  });

// --- deals -----------------------------------------------------------------------------------

/** Deals as rows, newest first; one deal when `id` is given. The schedule total is the signed terms'. */
export async function dealRows(db: Queryable, o: { id?: string } = {}) {
  const rows = await db
    .select({
      d: pipelineDeals,
      person: profiles.name,
      entry: journeys.entry,
      plan: termsVersions.plan,
      planNumber: termsVersions.number,
      terms: termsVersions.body,
    })
    .from(pipelineDeals)
    .innerJoin(journeys, eq(journeys.id, pipelineDeals.journey))
    .innerJoin(profiles, eq(profiles.id, pipelineDeals.profileId))
    .leftJoin(termsVersions, eq(termsVersions.id, pipelineDeals.termsVersion))
    .where(o.id ? eq(pipelineDeals.id, o.id) : undefined)
    .orderBy(desc(pipelineDeals.signedAt))
    .limit(ROWS);
  return rows.map(({ d, person, entry, plan, planNumber, terms }) => {
    const scheduled = terms
      ? scheduleOf(terms, d.signedAt).reduce(
          (sum, l) => sum + (l.kind === "setup" || l.kind === "monthly" ? l.cents : 0),
          0,
        )
      : null;
    return {
      id: d.id,
      journey: d.journey,
      name: person ?? `Person ${d.profileId}`,
      profile: d.profileId,
      node: d.node,
      entry,
      offer: d.offer,
      offer_version: d.offerVersion,
      plan,
      terms_number: planNumber,
      status: d.status,
      collected: d.collectedCents / 100,
      scheduled: scheduled === null ? null : scheduled / 100,
      currency: d.currency.toUpperCase(),
      signed_at: d.signedAt,
      ends_at: d.endsAt,
    };
  });
}

export const dealRecord = (): RecordType =>
  defineRecord({
    id: DEAL_RECORD,
    app: "deals",
    channel: null,
    name: { one: "deal", many: "deals" },
    rows: (db) => dealRows(db),
    key: "id",
    title: "name",
    subtitle: "offer",
    fields: {
      name: text("Person"),
      offer: text("Offer"),
      offerVersion: number("Offer version", { listed: false }),
      plan: text("Terms plan"),
      termsNumber: number("Terms version", { listed: false }),
      status: status(DEAL_STATES, "Status"),
      collected: money("Collected"),
      scheduled: money("Scheduled"),
      node: text("Made at"),
      entry: text("Source"),
      journey: text("Journey", { listed: false }),
      signedAt: date("Signed"),
      endsAt: date("Ends"),
    },
    views: [
      { id: "open", label: "Open", where: { status: "open" }, sort: "-signedAt", at: "signedAt" },
      { id: "won", label: "Won", where: { status: "won" }, sort: "-signedAt", at: "signedAt" },
      { id: "lost", label: "Lost", where: { status: "lost" }, sort: "-signedAt", at: "signedAt" },
      { id: "all", label: "All", sort: "-signedAt", at: "signedAt" },
    ],
    /** The dated lines its signed terms imply. None until `deals sign` sets terms. */
    load: async (db, id) => {
      const [row] = await db
        .select({ d: pipelineDeals, terms: termsVersions.body })
        .from(pipelineDeals)
        .leftJoin(termsVersions, eq(termsVersions.id, pipelineDeals.termsVersion))
        .where(eq(pipelineDeals.id, String(id)))
        .limit(1);
      if (!row) return null;
      return { schedule: row.terms ? scheduleOf(row.terms, row.d.signedAt) : [] };
    },
  });

// --- entries ---------------------------------------------------------------------------------

/** The source nodes of the newest shape, with the journeys each opened and the newest arrival. */
export async function entryRows(db: Queryable) {
  const [top] = await db.select().from(shapeVersions).orderBy(desc(shapeVersions.number)).limit(1);
  if (!top) return [];
  const counts = await db
    .select({
      entry: journeys.entry,
      open: sql<number>`(count(*) filter (where ${journeys.status} = 'open'))::int`,
      all: sql<number>`count(*)::int`,
      last: sql<string | null>`max(${journeys.openedAt})`,
    })
    .from(journeys)
    .groupBy(journeys.entry);
  const by = new Map(counts.map((c) => [c.entry, c]));
  return top.body.nodes.flatMap((n) => {
    if (n.kind !== "source") return [];
    const c = by.get(n.id);
    return [
      {
        id: n.id,
        name: n.name,
        via: n.via,
        channel: n.channel ?? null,
        campaign: n.campaign ?? null,
        parked: n.parked === true ? "parked" : null,
        open_journeys: c?.open ?? 0,
        journeys: c?.all ?? 0,
        last_arrival: c?.last ? new Date(c.last) : null,
      },
    ];
  });
}

export const entryRecord = (): RecordType =>
  defineRecord({
    id: ENTRY_RECORD,
    app: "deals",
    channel: null,
    name: { one: "source", many: "sources" },
    rows: (db) => entryRows(db),
    key: "id",
    title: "name",
    subtitle: "via",
    fields: {
      name: text("Source"),
      via: text("Via"),
      channel: text("Channel"),
      campaign: text("Campaign"),
      parked: status(PARKED_STATES, "Parked"),
      openJourneys: number("Open journeys"),
      journeys: number("Journeys"),
      lastArrival: date("Last arrival"),
    },
    views: [{ id: "all", label: "All", sort: "name", at: "lastArrival" }],
    quick: ["via", "channel"],
  });

// --- numbers ---------------------------------------------------------------------------------

/** The windows `pipeline.number` holds a set of rows for. `all` keeps the plain row ids. */
const NUMBER_WINDOWS = ["all", "7", "30", "90"] as const;

const numberOf = (n: NumberRow, window: (typeof NUMBER_WINDOWS)[number] = "all") => ({
  id: window === "all" ? n.id : `${n.id}@${window}`,
  window,
  kind: n.kind,
  label: n.name,
  node: n.label,
  node_kind: n.nodeKind,
  position: n.position,
  arrived: n.arrived,
  skipped: n.skipped,
  left: n.left,
  now: n.now,
  median_days: n.medianDays,
  crossings: n.crossings,
  from: n.from,
  to: n.to,
  opened: n.opened,
  deals: n.deals,
  collected: n.collected,
  scheduled: n.scheduled,
  cost: n.cost,
  currency: n.currency,
  last: n.last,
});

export const numberRecord = (): RecordType =>
  defineRecord({
    id: NUMBER_RECORD,
    app: "deals",
    channel: null,
    name: { one: "number", many: "numbers" },
    // One set of rows per window; the Map page reads the window it shows, the Numbers pages `all`.
    rows: async (db) =>
      (
        await Promise.all(
          NUMBER_WINDOWS.map(async (w) =>
            (
              await numberRows(db, w === "all" ? {} : { window: Number(w) as 7 | 30 | 90 })
            ).map((n) => numberOf(n, w)),
          ),
        )
      ).flat(),
    key: "id",
    title: "label",
    subtitle: "nodeKind",
    fields: {
      label: text("Name"),
      window: text("Window", { listed: false }),
      kind: status(NUMBER_KINDS, "Per"),
      node: text("Id", { listed: false }),
      nodeKind: status(KIND_STATES, "Node kind"),
      position: number("Order", { listed: false }),
      arrived: number("Arrived"),
      skipped: number("Skipped past"),
      left: number("Left"),
      now: number("Open now"),
      medianDays: number("Median days there"),
      crossings: number("Crossings"),
      from: text("From", { listed: false }),
      to: text("To", { listed: false }),
      opened: number("Opened"),
      deals: number("Deals"),
      collected: money("Collected"),
      scheduled: money("Scheduled"),
      cost: number("Cost"),
      last: date("Last day"),
    },
    views: [
      {
        id: "node",
        label: "Per node",
        where: { kind: "node", window: "all" },
        sort: "position",
        at: "last",
      },
      {
        id: "edge",
        label: "Per edge",
        where: { kind: "edge", window: "all" },
        sort: "-crossings",
        at: "last",
      },
      {
        id: "offer",
        label: "Per offer",
        where: { kind: "offer", window: "all" },
        sort: "label",
        at: "last",
      },
    ],
  });

/** Every pipeline record type. Each is served from the workspace database the console picks. */
export const PIPELINE_RECORDS: readonly RecordType[] = [
  offerRecord(),
  shapeRecord(),
  journeyRecord(),
  dealRecord(),
  numberRecord(),
  termsRecord(),
  entryRecord(),
];
