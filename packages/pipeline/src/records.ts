/**
 * The pipeline as records (designs/2026-10-18-journeys.md, "Records, CLI, agent"): offers,
 * funnels, journeys, deals and numbers. One workspace each: the database a type is served from
 * (Wren's, or a client's) holds the rows, so no row carries an owner.
 *
 * Served by `PipelineConsole`. Writes go through its handlers and the `Journeys` service, never
 * through a record edit.
 */

import { profiles } from "@wren/core/profiles-schema";
import {
  actor,
  date,
  defineRecord,
  duration,
  money,
  number,
  percent,
  type RecordType,
  status,
  text,
} from "@wren/core/records";
import { events } from "@wren/core/schema";
import type { Queryable } from "@wren/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { FunnelBody } from "./model.js";
import { subjectOf } from "./moves.js";
import { type NumberRow, numberRows } from "./numbers.js";
import { scheduleOf } from "./schedule.js";
import {
  funnels,
  funnelVersions,
  journeys,
  offerVersions,
  pipelineDeals,
  termsVersions,
} from "./schema.js";

export const OFFER_RECORD = "pipeline.offer";
export const FUNNEL_RECORD = "pipeline.funnel";
export const JOURNEY_RECORD = "pipeline.journey";
export const DEAL_RECORD = "pipeline.deal";
export const NUMBER_RECORD = "pipeline.number";

/** Days an open journey sits in one stage before it reads stale. */
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
const FUNNEL_STATES = {
  live: { label: "Live", tone: "good" },
  off: { label: "Off", tone: "neutral" },
} as const;
const JOURNEY_STATES = {
  open: { label: "Open", tone: "neutral" },
  done: { label: "Done", tone: "good" },
  dropped: { label: "Dropped", tone: "bad" },
} as const;
const JOURNEY_FLAGS = { stale: { label: "Stale", tone: "warn" } } as const;
const DEAL_STATES = {
  open: { label: "Open", tone: "neutral" },
  won: { label: "Won", tone: "good" },
  lost: { label: "Lost", tone: "bad" },
  ended: { label: "Ended", tone: "neutral" },
} as const;
const NUMBER_KINDS = {
  stage: { label: "Stage", tone: "neutral" },
  entry: { label: "Entry", tone: "neutral" },
  offer: { label: "Offer", tone: "neutral" },
} as const;

const labelOf = (body: FunnelBody | undefined, key: string) =>
  body?.stages.find((s) => s.key === key)?.label ?? key;

// --- offers ----------------------------------------------------------------------------------

/** The newest version of each offer, as rows. */
export async function offerRows(db: Queryable) {
  const rows = await db
    .selectDistinctOn([offerVersions.offer])
    .from(offerVersions)
    .orderBy(offerVersions.offer, desc(offerVersions.number))
    .limit(ROWS);
  return rows.map((r) => ({
    id: r.offer,
    name: r.body.name,
    status: r.body.status,
    version: r.number,
    audience: r.body.audience,
    promise: r.body.promise,
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
      hash: text("Hash", { listed: false }),
      syncedAt: date("Synced"),
      syncedBy: actor("Synced by"),
      why: text("Why", { listed: false }),
    },
    views: [
      { id: "live", label: "Live", where: { status: "live" }, sort: "name", at: "syncedAt" },
      { id: "all", label: "All", sort: "name", at: "syncedAt" },
    ],
  });

// --- funnels ---------------------------------------------------------------------------------

/** Each funnel with its newest version and the journeys open on it. */
export async function funnelRows(db: Queryable) {
  const heads = await db.select().from(funnels).limit(ROWS);
  const tops = await db
    .selectDistinctOn([funnelVersions.funnel])
    .from(funnelVersions)
    .orderBy(funnelVersions.funnel, desc(funnelVersions.number));
  const top = new Map(tops.map((t) => [t.funnel, t]));
  const opens = await db
    .select({ funnel: journeys.funnel, n: sql<number>`count(*)::int` })
    .from(journeys)
    .where(eq(journeys.status, "open"))
    .groupBy(journeys.funnel);
  const open = new Map(opens.map((o) => [o.funnel, o.n]));
  return heads.map((f) => {
    const v = top.get(f.id);
    return {
      id: f.id,
      name: f.name,
      status: f.status,
      version: v?.number ?? 0,
      offer: v?.body.offer ?? null,
      stages: v?.body.stages.length ?? 0,
      entries: v?.body.entries.length ?? 0,
      open_journeys: open.get(f.id) ?? 0,
      why: v?.why ?? null,
      changed_at: v?.createdAt ?? f.createdAt,
      changed_by: v?.createdBy ?? null,
      created_at: f.createdAt,
    };
  });
}

export const funnelRecord = (): RecordType =>
  defineRecord({
    id: FUNNEL_RECORD,
    app: "deals",
    channel: null,
    name: { one: "funnel", many: "funnels" },
    rows: (db) => funnelRows(db),
    key: "id",
    title: "name",
    subtitle: "offer",
    fields: {
      name: text("Funnel"),
      status: status(FUNNEL_STATES, "Status"),
      version: number("Version"),
      offer: text("Offer"),
      stages: number("Stages"),
      entries: number("Entries"),
      openJourneys: number("Open journeys"),
      why: text("Last change", { listed: false }),
      changedAt: date("Changed"),
      changedBy: actor("Changed by"),
      createdAt: date("Made"),
    },
    views: [
      { id: "live", label: "Live", where: { status: "live" }, sort: "name", at: "changedAt" },
      { id: "off", label: "Off", where: { status: "off" }, sort: "name", at: "changedAt" },
      { id: "all", label: "All", sort: "name", at: "changedAt" },
    ],
    /** Its newest version's stages and entries. */
    load: async (db, id) => {
      const [v] = await db
        .select()
        .from(funnelVersions)
        .where(eq(funnelVersions.funnel, String(id)))
        .orderBy(desc(funnelVersions.number))
        .limit(1);
      if (!v) return null;
      return {
        stages: v.body.stages.map((s) => ({
          key: s.key,
          label: s.label,
          sale: s.sale === true,
          on: s.on.map((a) => a.trigger),
        })),
        entries: v.body.entries.map((e) => ({
          id: e.id,
          kind: e.kind,
          to: e.to ?? v.body.stages[0]?.key ?? null,
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
        sql`${events.workflow} like 'funnel.%'`,
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
    .where(and(eq(events.subject, subjectOf(id)), sql`${events.workflow} like 'funnel.%'`))
    .orderBy(events.at, events.id);
  return rows.filter((r) => r.node.startsWith("s_") || r.node === "dropped");
}

/** Journeys as rows, newest move first; one journey when `id` is given. */
export async function journeyRows(db: Queryable, o: { id?: string; now?: Date } = {}) {
  const rows = await db
    .select({
      j: journeys,
      person: profiles.name,
      funnelName: funnels.name,
      body: funnelVersions.body,
    })
    .from(journeys)
    .innerJoin(profiles, eq(profiles.id, journeys.profileId))
    .innerJoin(funnels, eq(funnels.id, journeys.funnel))
    .innerJoin(
      funnelVersions,
      and(eq(funnelVersions.funnel, journeys.funnel), eq(funnelVersions.number, journeys.version)),
    )
    .where(o.id ? eq(journeys.id, o.id) : undefined)
    .orderBy(desc(journeys.movedAt))
    .limit(ROWS);
  const owners = await ownersOf(
    db,
    rows.map((r) => r.j.id),
  );
  const now = (o.now ?? new Date()).getTime();
  return rows.map(({ j, person, funnelName, body }) => {
    const days = Math.floor((now - j.movedAt.getTime()) / DAY_MS);
    return {
      id: j.id,
      name: person ?? `Person ${j.profileId}`,
      profile: j.profileId,
      funnel: j.funnel,
      funnel_name: funnelName,
      version: j.version,
      stage: j.stage,
      stage_label: labelOf(body, j.stage),
      status: j.status,
      flag: j.status === "open" && days >= STALE_DAYS ? "stale" : null,
      entry: j.entry,
      owner: owners.get(j.id) ?? null,
      days_in_stage: days,
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
    subtitle: "funnelName",
    fields: {
      name: text("Person"),
      funnelName: text("Funnel"),
      funnel: text("Funnel id", { listed: false }),
      stage: text("Stage key", { listed: false }),
      stageLabel: text("Stage"),
      status: status(JOURNEY_STATES, "Status"),
      flag: status(JOURNEY_FLAGS, "Needs"),
      entry: text("Entry"),
      owner: actor("Moved by hand by"),
      daysInStage: number("Days in stage"),
      version: number("Version", { listed: false }),
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
    quick: ["funnel", "stage", "entry", "status"],
    related: [{ record: DEAL_RECORD, by: "journey" }],
  });

// --- deals -----------------------------------------------------------------------------------

/** Deals as rows, newest first; one deal when `id` is given. The schedule total is the signed terms'. */
export async function dealRows(db: Queryable, o: { id?: string } = {}) {
  const rows = await db
    .select({
      d: pipelineDeals,
      person: profiles.name,
      funnel: journeys.funnel,
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
  return rows.map(({ d, person, funnel, entry, plan, planNumber, terms }) => {
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
      funnel,
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
      funnel: text("Funnel"),
      entry: text("Entry"),
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

// --- numbers ---------------------------------------------------------------------------------

const numberOf = (n: NumberRow) => ({
  id: n.id,
  kind: n.kind,
  funnel: n.funnel,
  label: n.label,
  position: n.position,
  entered: n.entered,
  skipped: n.skipped,
  reached: n.reached,
  advanced: n.advanced,
  conversion: n.conversion,
  median_seconds: n.medianSeconds,
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
    rows: async (db) => (await numberRows(db)).map(numberOf),
    key: "id",
    title: "label",
    subtitle: "funnel",
    fields: {
      label: text("Name"),
      kind: status(NUMBER_KINDS, "Per"),
      funnel: text("Funnel"),
      position: number("Order", { listed: false }),
      entered: number("Entered"),
      skipped: number("Skipped past"),
      reached: number("Reached"),
      advanced: number("Went on"),
      conversion: percent("Conversion"),
      medianSeconds: duration("Median in stage"),
      opened: number("Opened"),
      deals: number("Deals"),
      collected: money("Collected"),
      scheduled: money("Scheduled"),
      cost: number("Cost"),
      last: date("Last day"),
    },
    views: [
      { id: "stage", label: "Per stage", where: { kind: "stage" }, sort: "position", at: "last" },
      { id: "entry", label: "Per entry", where: { kind: "entry" }, sort: "-opened", at: "last" },
      { id: "offer", label: "Per offer", where: { kind: "offer" }, sort: "label", at: "last" },
    ],
  });

/** Every pipeline record type. Each is served from the workspace database the console picks. */
export const PIPELINE_RECORDS: readonly RecordType[] = [
  offerRecord(),
  funnelRecord(),
  journeyRecord(),
  dealRecord(),
  numberRecord(),
];
