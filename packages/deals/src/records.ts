/**
 * Deals as records (designs/2026-10-09-opportunities.md, "Portal"): an owner's deals with stage,
 * value and contact, and its saved views. Served by DealsConsole on the main database, the rows
 * kept to the owner asked for.
 */
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
import type { Queryable } from "@wren/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { type DealPipeline, dealPipelines, deals } from "./schema.js";
import { dealsById, movesOf } from "./store.js";

export const DEAL_RECORD = "deals.deal";

/** Days in one open stage before a deal reads stale. */
export const STALE_DAYS = 14;
const DAY_MS = 86_400_000;
/** ponytail: rows, not a view: an owner works hundreds of deals, not tens of thousands. */
const ROWS = 2000;

const STATUSES = {
  open: { label: "Open", tone: "neutral" },
  won: { label: "Won", tone: "good" },
  lost: { label: "Lost", tone: "bad" },
} as const;
const FLAGS = {
  due: { label: "Follow up", tone: "warn" },
  stale: { label: "Stale", tone: "warn" },
} as const;
const SOURCES = {
  manual: { label: "Added", tone: "neutral" },
  form: { label: "Form", tone: "neutral" },
  text: { label: "Text", tone: "neutral" },
  booking: { label: "Booking", tone: "neutral" },
  call: { label: "Call", tone: "neutral" },
} as const;

/** "2026-10-09" for a time, in UTC: what `next_on` compares with. */
const dayOf = (at: Date) => at.toISOString().slice(0, 10);

/** One deal as the list and the board show it, `now` deciding its flag. */
export function rowOf(
  d: typeof deals.$inferSelect,
  pipes: ReadonlyMap<string, DealPipeline>,
  now: Date,
) {
  const p = pipes.get(d.pipeline);
  const days = Math.floor((now.getTime() - d.movedAt.getTime()) / DAY_MS);
  const flag =
    d.status !== "open"
      ? null
      : d.nextOn && d.nextOn <= dayOf(now)
        ? "due"
        : days >= STALE_DAYS
          ? "stale"
          : null;
  return {
    id: d.id,
    name: d.name,
    pipeline: d.pipeline,
    pipeline_name: p?.name ?? null,
    stage: d.stage,
    stage_label: p?.stages.find((s) => s.key === d.stage)?.label ?? d.stage,
    status: d.status,
    value: d.valueCents === null ? null : d.valueCents / 100,
    currency: d.currency.toUpperCase(),
    contact_name: d.contactName,
    contact_email: d.contactEmail,
    contact_phone: d.contactPhone,
    owner: d.owner,
    note: d.note,
    next_on: d.nextOn,
    days_in_stage: days,
    flag,
    source: d.source,
    source_ref: d.sourceRef,
    moved_at: d.movedAt,
    closed_at: d.closedAt,
    created_at: d.createdAt,
    created_by: d.createdBy,
  };
}
export type DealRow = ReturnType<typeof rowOf>;

const ownerIs = (owner: string | null) =>
  owner === null ? isNull(deals.client) : eq(deals.client, owner);

/** An owner's deals as rows, newest move first; one pipeline's when named. */
export async function dealRows(
  db: Queryable,
  owner: string | null,
  pipes: readonly DealPipeline[],
  o: { id?: string; pipeline?: string; now?: Date } = {},
): Promise<DealRow[]> {
  const byId = new Map(pipes.map((p) => [p.id, p]));
  const rows = await db
    .select()
    .from(deals)
    .where(
      and(
        ownerIs(owner),
        o.id ? eq(deals.id, o.id) : undefined,
        o.pipeline ? eq(deals.pipeline, o.pipeline) : undefined,
      ),
    )
    .orderBy(desc(deals.movedAt))
    .limit(ROWS);
  const now = o.now ?? new Date();
  return rows.map((d) => rowOf(d, byId, now));
}

/** An owner's pipelines, read only: the record type reads them, it never makes the default. */
export const pipelinesRead = (db: Queryable, owner: string | null) =>
  db
    .select()
    .from(dealPipelines)
    .where(owner === null ? isNull(dealPipelines.client) : eq(dealPipelines.client, owner))
    .orderBy(dealPipelines.createdAt);

/** An owner's deals. Built per request: its rows are that owner's only. */
export function dealRecordFor(owner: string | null): RecordType {
  return defineRecord({
    id: DEAL_RECORD,
    app: "deals",
    channel: null,
    name: { one: "deal", many: "deals" },
    rows: async (db) => dealRows(db, owner, await pipelinesRead(db, owner)),
    key: "id",
    title: "name",
    subtitle: "contactName",
    fields: {
      name: text("Deal"),
      stageLabel: text("Stage"),
      status: status(STATUSES, "Status"),
      value: money("Value"),
      flag: status(FLAGS, "Needs"),
      contactName: text("Contact"),
      contactEmail: text("Email"),
      contactPhone: text("Phone"),
      owner: actor("Works it"),
      nextOn: date("Follow up on"),
      daysInStage: number("Days in stage"),
      pipelineName: text("Pipeline"),
      source: status(SOURCES, "Came from"),
      note: text("Note"),
      movedAt: date("Moved"),
      closedAt: date("Closed"),
      createdAt: date("Added"),
      createdBy: actor("Added by"),
    },
    views: [
      { id: "open", label: "Open", where: { status: "open" }, sort: "-movedAt", at: "createdAt" },
      {
        id: "mine",
        label: "Mine",
        where: { status: "open" },
        mine: "owner",
        sort: "-movedAt",
        at: "createdAt",
      },
      { id: "due", label: "Follow up", where: { flag: "due" }, sort: "nextOn", at: "createdAt" },
      { id: "stale", label: "Stale", where: { flag: "stale" }, sort: "movedAt", at: "movedAt" },
      { id: "won", label: "Won", where: { status: "won" }, sort: "-closedAt", at: "closedAt" },
      { id: "lost", label: "Lost", where: { status: "lost" }, sort: "-closedAt", at: "closedAt" },
      { id: "all", label: "All", sort: "-createdAt", at: "createdAt" },
    ],
    // The owner's custom fields; a value lands only on a deal of theirs.
    custom: {
      owner,
      exists: async (db, id) => (await dealsById(db, [id])).some((d) => d.client === owner),
    },
    actions: [
      "deals.create",
      "deals.won",
      "deals.lost",
      "deals.assign",
      "deals.edit",
      "deals.delete",
    ],
    /** Its moves, oldest first, with each stage's label. */
    load: async (db, id) => {
      const moves = await movesOf(db, String(id));
      if (!moves.length) return null;
      const pipes = await pipelinesRead(db, owner);
      const label = new Map(pipes.flatMap((p) => p.stages.map((s) => [s.key, s.label] as const)));
      const name = (k: string | null) => (k ? (label.get(k) ?? k) : null);
      return {
        steps: moves.map((m) => ({
          step: m.from ? `${name(m.from)} → ${name(m.to)}` : `Added in ${name(m.to)}`,
          at: m.at,
          by: m.by,
        })),
      };
    },
  });
}

/** The type as the portal lists it: the same fields and views, no rows. */
export const DEAL_RECORD_TYPE = dealRecordFor(null);
export const DEALS_RECORDS: readonly RecordType[] = [DEAL_RECORD_TYPE];
