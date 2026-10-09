/**
 * The training record (designs/2026-10-07-training-record.md): every draft of every kind keeps one
 * `draft_events` row per step, written where the draft changes hands. Who (the model, William,
 * Claude at his ask), the words, the time; a model's first version keeps what it was asked.
 * Append-only: nothing here updates or deletes a row.
 */
import type { Queryable } from "@wren/db";
import { asc, eq, sql } from "drizzle-orm";
import { REJECT_NOTE_MAX, REJECT_REASONS, type RejectReason } from "./reject-reasons.js";
import {
  DRAFT_RECORD_KINDS,
  type DraftEvent,
  type DraftEventRow,
  type DraftRecordKind,
  type DraftVia,
  draftEvents,
} from "./schema.js";

export {
  REJECT_LABELS,
  REJECT_NOTE_MAX,
  REJECT_REASONS,
  type RejectReason,
} from "./reject-reasons.js";
export {
  DRAFT_EVENTS,
  DRAFT_RECORD_KINDS,
  DRAFT_VIAS,
  type DraftEvent,
  type DraftEventRow,
  type DraftRecordKind,
  type DraftVia,
} from "./schema.js";

/** A reject's reason and note from any input: unknown picks refused, the note cut short. */
export function rejectWhy(input: { reason?: unknown; note?: unknown }): {
  reason: RejectReason | null;
  note: string | null;
} {
  const r = typeof input.reason === "string" ? input.reason.trim() : "";
  if (r && !(REJECT_REASONS as readonly string[]).includes(r))
    throw new Error(`reason must be one of ${REJECT_REASONS.join(", ")}`);
  const n = typeof input.note === "string" ? input.note.trim().slice(0, REJECT_NOTE_MAX) : "";
  return { reason: (r || null) as RejectReason | null, note: n || null };
}

/** Each Inbox prefix's kind: `draft:` is a post. */
const PREFIX_KIND: Readonly<Record<string, DraftRecordKind>> = {
  draft: "post",
  comment: "comment",
  thread: "thread",
  dm: "dm",
  invite: "invite",
  video: "video",
  // A comment on someone else's post, on LinkedIn, X or Instagram (`reach_posts`).
  onpost: "post_comment",
  // A drafted note on a LinkedIn invite: `note:<contact id>`.
  note: "invite_note",
};
export const kindOfItem = (item: string): DraftRecordKind => {
  const k = PREFIX_KIND[item.slice(0, item.indexOf(":"))];
  if (!k) throw new Error(`no draft kind for ${item}`);
  return k;
};
/** Kinds whose item holds one draft after another: a DM contact gets one per reply. */
const ROUNDS: ReadonlySet<DraftRecordKind> = new Set(["dm", "invite"]);

export interface DraftStep {
  item: string;
  kind?: DraftRecordKind;
  platform?: string | null;
  event: DraftEvent;
  via: DraftVia;
  by?: string | null;
  text?: string | null;
  title?: string | null;
  ask?: string | null;
  reason?: RejectReason | null;
  note?: string | null;
  llm?: Record<string, unknown> | null;
  slot?: Date | null;
  externalId?: string | null;
  url?: string | null;
  meta?: Record<string, unknown>;
  runId?: string | null;
  /** The backfill's key; a step already kept under it is skipped. */
  ref?: string | null;
  /** Set by the backfill, which knows the rounds; else counted from the item's last step. */
  round?: number;
  /**
   * Left out, the database's clock as the row is written (`clock_timestamp()`), so one draft's
   * steps sort on one clock and a later step in one transaction sorts after an earlier one.
   * Set only for history the record never saw live: the backfill's, a video's first words.
   * Read order is `(at, id)` everywhere.
   */
  at?: Date;
}

/**
 * Keep one step. The round is the item's last one, or the next for a kind with rounds when this
 * step opens a new draft: a model's draft, or words written after the last was sent or dropped.
 */
export async function recordDraft(db: Queryable, s: DraftStep): Promise<void> {
  // Left out, an item keeps the kind it started as: a video's upload is a `draft:` too.
  const kind = s.kind ?? kindOfItem(s.item);
  const kindSql = s.kind
    ? sql`${s.kind}`
    : sql`coalesce((select k.kind from draft_events k where k.item = ${s.item}
        order by k.at, k.id limit 1), ${kind})`;
  const opens = ROUNDS.has(kind)
    ? s.event === "generated"
      ? sql`true`
      : s.event === "edited"
        ? sql`l.event in ('sent', 'rejected')`
        : sql`false`
    : sql`false`;
  const round =
    s.round !== undefined
      ? sql`${s.round}`
      : sql`coalesce((select case when ${opens} then l.round + 1 else l.round end
          from draft_events l where l.item = ${s.item} order by l.at desc, l.id desc limit 1), 1)`;
  const json = (v: unknown) => (v == null ? null : JSON.stringify(v));
  await db.execute(sql`
    insert into draft_events (item, round, kind, platform, event, via, by, text, title, ask,
      reason, note, llm, slot, external_id, url, meta, run_id, ref, at)
    select ${s.item}, ${round}, ${kindSql}, ${s.platform ?? null}, ${s.event}, ${s.via},
      ${s.by ?? null}, ${s.text ?? null}, ${s.title ?? null}, ${s.ask ?? null}, ${s.reason ?? null},
      ${s.note ?? null}, ${json(s.llm)}::jsonb, ${s.slot ? s.slot.toISOString() : null}::timestamptz,
      ${s.externalId ?? null}, ${s.url ?? null}, ${json(s.meta ?? {})}::jsonb, ${s.runId ?? null}::uuid,
      ${s.ref ?? null}, coalesce(${s.at ? s.at.toISOString() : null}::timestamptz, clock_timestamp())
    on conflict (ref) do nothing`);
}

/** What a model's draft was written from, as a `generated` step's `llm`. */
export interface AskedModel {
  request: { prompt: string; system: string | null; maxTokens: number } | null;
  call: { model: string; provider: string; usage: unknown } | null;
  rawText: string | null;
}
export const llmOf = (o: AskedModel, stage: string, extra: Record<string, unknown> = {}) => ({
  stage,
  model: o.call?.model ?? null,
  provider: o.call?.provider ?? null,
  system: o.request?.system ?? null,
  prompt: o.request?.prompt ?? null,
  max_tokens: o.request?.maxTokens ?? null,
  usage: o.call?.usage ?? null,
  raw_text: o.rawText,
  ...extra,
});

/** One item's steps, oldest first. */
export const draftSteps = (db: Queryable, item: string): Promise<DraftEventRow[]> =>
  db
    .select()
    .from(draftEvents)
    .where(eq(draftEvents.item, item))
    .orderBy(asc(draftEvents.at), asc(draftEvents.id));

export const isDraftKind = (k: string): k is DraftRecordKind =>
  (DRAFT_RECORD_KINDS as readonly string[]).includes(k);

/** One version of a draft's words, as the record page lists them. */
export interface DraftVersion {
  n: number;
  event: DraftEvent;
  via: DraftVia;
  by: string | null;
  ask: string | null;
  text: string;
  title: string | null;
  at: string;
}
/** A draft's newest round: its versions oldest first, and what was decided on it. */
export interface DraftRecordView {
  item: string;
  round: number;
  rounds: number;
  versions: DraftVersion[];
  decisions: {
    event: DraftEvent;
    via: DraftVia;
    by: string | null;
    reason: RejectReason | null;
    note: string | null;
    slot: string | null;
    url: string | null;
    at: string;
  }[];
}

const TEXT_EVENTS: ReadonlySet<DraftEvent> = new Set(["generated", "edited", "sent"]);

/**
 * The record page's view of one draft: of `items` (a DM contact is `dm:` or `invite:`), the one
 * with the newest step, its newest round. A `sent` with the same words as the version before is
 * a decision, not a version. Null when nothing is kept yet.
 */
export async function draftRecordOf(
  db: Queryable,
  items: string | readonly string[],
): Promise<DraftRecordView | null> {
  const all = (await Promise.all([items].flat().map((i) => draftSteps(db, i)))).filter(
    (s) => s.length,
  );
  const newest = (s: DraftEventRow[]) => s.at(-1)?.at.getTime() ?? 0;
  const steps = all.sort((a, b) => newest(b) - newest(a))[0];
  const last = steps?.at(-1);
  if (!steps || !last) return null;
  const round = steps.filter((s) => s.round === last.round);
  const versions: DraftVersion[] = [];
  const decisions: DraftRecordView["decisions"] = [];
  for (const s of round) {
    const prev = versions.at(-1);
    const words = TEXT_EVENTS.has(s.event) && s.text !== null;
    if (words && !(s.event === "sent" && prev?.text === s.text && prev.title === s.title))
      versions.push({
        n: versions.length + 1,
        event: s.event,
        via: s.via,
        by: s.by,
        ask: s.ask,
        text: s.text ?? "",
        title: s.title,
        at: s.at.toISOString(),
      });
    if (!["generated", "edited"].includes(s.event))
      decisions.push({
        event: s.event,
        via: s.via,
        by: s.by,
        reason: s.reason,
        note: s.note,
        slot: s.slot?.toISOString() ?? null,
        url: s.url,
        at: s.at.toISOString(),
      });
  }
  return {
    item: last.item,
    round: last.round,
    rounds: Math.max(...steps.map((s) => s.round)),
    versions,
    decisions,
  };
}

/** The items a page's draft may be kept under: a DM contact's draft is a reply or a first message. */
export const draftItemsOf = (type: string, id: string): string[] =>
  type === "dm" || type === "invite" ? [`dm:${id}`, `invite:${id}`] : [`${type}:${id}`];
/** A record page's draft record, beside its Ask Claude thread. */
export const recordOfPage = (db: Queryable, type: string, id: string) =>
  draftRecordOf(db, draftItemsOf(type, id));
