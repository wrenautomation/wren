/**
 * The training export (designs/2026-10-07-training-record.md, Export): `draft_events` as one
 * `wren.draft/1` record per draft (item and round), and `wren.pair/1` preference pairs built from
 * them. Other people's names and every email in the words come out as [person] and [email]
 * unless `people` is set; `by` stays (his login or a role).
 * Outcomes and names are read from the `draft_outcomes` and `draft_people` views, which the
 * packages owning those tables define.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import type { DraftEvent, DraftEventRow, DraftRecordKind, DraftVia } from "./schema.js";

export const TRAIN_RECORD = "wren.draft/1";
export const TRAIN_PAIR = "wren.pair/1";

export interface TrainAsk {
  kinds?: readonly DraftRecordKind[];
  /** Drafts started on or after. */
  since?: Date;
  items?: readonly string[];
  /** Keep names and emails; off, they read [person] and [email]. */
  people?: boolean;
}

export interface TrainVersion {
  n: number;
  event: DraftEvent;
  via: DraftVia;
  by: string | null;
  /** What he asked Claude, or the note a redraft was asked with. */
  ask: string | null;
  title: string | null;
  text: string;
  at: string;
  /** For a model's draft or Claude's rewrite: what it was given. */
  llm: Record<string, unknown> | null;
  /** The post fields this step changed (title, thumbnail, tags): `{key: [before, after]}`. */
  fields: Record<string, [unknown, unknown]> | null;
}
export interface TrainDecision {
  event: DraftEvent;
  via: DraftVia;
  by: string | null;
  reason: string | null;
  note: string | null;
  slot: string | null;
  at: string;
}
export interface TrainOutcome {
  measured: string | null;
  views: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  follows: number | null;
  snapshots: number;
  replies: { author: string; text: string; at: string }[];
}
export interface TrainRecord {
  schema: typeof TRAIN_RECORD;
  /** `item#round`. */
  id: string;
  item: string;
  kind: DraftRecordKind;
  platform: string | null;
  round: number;
  /** Drafts written for the same ask: a post's idea and platform, else the item. */
  group: string;
  started: string;
  /** The first version's prompt and settings; null when no model wrote it. */
  input: Record<string, unknown> | null;
  /** The first model draft's surroundings: its idea, playbook, the message it answered. */
  context: Record<string, unknown>;
  versions: TrainVersion[];
  decisions: TrainDecision[];
  /** The words that went out, with the platform's id. */
  final: {
    text: string | null;
    title: string | null;
    at: string;
    external_id: string | null;
    url: string | null;
    /** The post's fields as they went out (YouTube's tags, thumbnail, visibility). */
    fields: Record<string, unknown> | null;
  } | null;
  outcome: TrainOutcome | null;
}

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

/** Every draft's record, oldest first. */
export async function trainRecords(db: Queryable, ask: TrainAsk = {}): Promise<TrainRecord[]> {
  const where = [sql`true`];
  if (ask.kinds?.length)
    where.push(
      sql`e.kind in (${sql.join(
        ask.kinds.map((k) => sql`${k}`),
        sql`, `,
      )})`,
    );
  if (ask.items) {
    if (!ask.items.length) return [];
    where.push(
      sql`e.item in (${sql.join(
        ask.items.map((i) => sql`${i}`),
        sql`, `,
      )})`,
    );
  }
  const raw = await db.execute<Record<string, unknown>>(sql`
    select e.id, e.item, e.round, e.kind, e.platform, e.event, e.via, e.by, e.text, e.title, e.ask,
      e.reason, e.note, e.llm, e.slot, e.external_id, e.url, e.meta, e.run_id, e.at
    from draft_events e where ${sql.join(where, sql` and `)}
    order by e.item, e.round, e.at, e.id`);
  const steps = raw.map(stepOf);
  const groups = new Map<string, DraftEventRow[]>();
  for (const s of steps) {
    const key = `${s.item}#${s.round}`;
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  const items = [...new Set(steps.map((s) => s.item))];
  const outcomes = await outcomesOf(db, items);
  let records = [...groups.values()].map((g) => recordOf(g, outcomes));
  if (ask.since) {
    const since = ask.since.getTime();
    records = records.filter((r) => new Date(r.started).getTime() >= since);
  }
  // A DM's replies belong to the round they answer: after its send, before the next one's.
  for (const r of records) {
    if (!r.outcome || r.kind === "post" || r.kind === "video") continue;
    const next = records.find((o) => o.item === r.item && o.round > r.round && o.final);
    const from = r.final ? new Date(r.final.at).getTime() : Number.POSITIVE_INFINITY;
    const to = next?.final ? new Date(next.final.at).getTime() : Number.POSITIVE_INFINITY;
    r.outcome = {
      ...r.outcome,
      replies: r.outcome.replies.filter((x) => {
        const t = new Date(x.at).getTime();
        return t >= from && t < to;
      }),
    };
  }
  records.sort((a, b) => a.started.localeCompare(b.started) || a.id.localeCompare(b.id));
  if (ask.people) return records;
  const names = await peopleOf(db, items);
  return records.map((r) => redact(r, names.get(r.item) ?? []));
}

function stepOf(r: Record<string, unknown>): DraftEventRow {
  const date = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));
  return {
    id: Number(r.id),
    item: String(r.item),
    round: Number(r.round),
    kind: r.kind as DraftRecordKind,
    platform: (r.platform as string | null) ?? null,
    event: r.event as DraftEvent,
    via: r.via as DraftVia,
    by: (r.by as string | null) ?? null,
    text: (r.text as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    ask: (r.ask as string | null) ?? null,
    reason: (r.reason as DraftEventRow["reason"]) ?? null,
    note: (r.note as string | null) ?? null,
    llm: (r.llm as Record<string, unknown> | null) ?? null,
    slot: date(r.slot),
    externalId: (r.external_id as string | null) ?? null,
    url: (r.url as string | null) ?? null,
    meta: (r.meta as Record<string, unknown>) ?? {},
    runId: (r.run_id as string | null) ?? null,
    ref: null,
    at: date(r.at) ?? new Date(0),
  } as DraftEventRow;
}

const WORDS: ReadonlySet<DraftEvent> = new Set(["generated", "edited", "sent"]);

function recordOf(g: DraftEventRow[], outcomes: Map<string, TrainOutcome>): TrainRecord {
  const first = g[0] as DraftEventRow;
  const versions: TrainVersion[] = [];
  const decisions: TrainDecision[] = [];
  let final: TrainRecord["final"] = null;
  for (const s of g) {
    const prev = versions.at(-1);
    const same = prev && prev.text === s.text && prev.title === s.title;
    if (WORDS.has(s.event) && s.text !== null && !(s.event === "sent" && same))
      versions.push({
        n: versions.length + 1,
        event: s.event,
        via: s.via,
        by: s.by,
        ask: s.ask,
        title: s.title,
        text: s.text,
        at: s.at.toISOString(),
        llm: s.llm,
        fields: (s.meta.fields as Record<string, [unknown, unknown]> | undefined) ?? null,
      });
    if (s.event !== "generated" && s.event !== "edited")
      decisions.push({
        event: s.event,
        via: s.via,
        by: s.by,
        reason: s.reason,
        note: s.note,
        slot: iso(s.slot),
        at: s.at.toISOString(),
      });
    if (s.event === "sent")
      final = {
        text: s.text ?? versions.at(-1)?.text ?? null,
        title: s.title ?? versions.at(-1)?.title ?? null,
        at: s.at.toISOString(),
        external_id: s.externalId,
        url: s.url,
        fields: (s.meta.fields as Record<string, unknown> | undefined) ?? null,
      };
  }
  const made = g.find((s) => s.event === "generated");
  const llm = made?.llm ?? null;
  const idea = made?.meta?.idea;
  return {
    schema: TRAIN_RECORD,
    id: `${first.item}#${first.round}`,
    item: first.item,
    kind: first.kind,
    platform: first.platform,
    round: first.round,
    group:
      first.kind === "post" && typeof idea === "string"
        ? `idea:${idea}/${first.platform}`
        : first.item,
    started: first.at.toISOString(),
    input: llm ? { ...llm, ask: made?.ask ?? null } : null,
    context: made?.meta ?? {},
    versions,
    decisions,
    final,
    outcome: final ? (outcomes.get(first.item) ?? null) : null,
  };
}

async function outcomesOf(db: Queryable, items: string[]): Promise<Map<string, TrainOutcome>> {
  if (!items.length) return new Map();
  const rows = await db.execute<Record<string, unknown>>(sql`
    select * from draft_outcomes where item in (${sql.join(
      items.map((i) => sql`${i}`),
      sql`, `,
    )})`);
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return new Map(
    rows.map((r) => [
      String(r.item),
      {
        measured: iso(r.measured as string | null),
        views: n(r.views),
        reactions: n(r.reactions),
        comments: n(r.comments),
        shares: n(r.shares),
        follows: n(r.follows),
        snapshots: Number(r.snapshots ?? 0),
        replies: ((r.replies as TrainOutcome["replies"]) ?? []).map((x) => ({
          ...x,
          at: iso(x.at) ?? "",
        })),
      },
    ]),
  );
}

async function peopleOf(db: Queryable, items: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!items.length) return out;
  const rows = await db.execute<{ item: string; name: string }>(sql`
    select item, name from draft_people where item in (${sql.join(
      items.map((i) => sql`${i}`),
      sql`, `,
    )})`);
  for (const r of rows) out.set(r.item, [...(out.get(r.item) ?? []), r.name]);
  return out;
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A record with its people's names and every email as placeholders. */
export function redact(r: TrainRecord, names: readonly string[]): TrainRecord {
  // A name reads whole and by each part ("Jane" from "Jane Doe"); a handle with or without @.
  const all = [...names, ...(r.outcome?.replies.map((x) => x.author) ?? [])]
    .map((n) => n.trim().replace(/^@/, ""))
    .flatMap((n) => [n, ...n.split(/\s+/)])
    .filter((n) => n.length > 2)
    .sort((a, b) => b.length - a.length);
  const re = all.length
    ? new RegExp(`(?<![\\w@])@?(?:${[...new Set(all)].map(literal).join("|")})(?![\\w])`, "gi")
    : null;
  const scrub = (v: unknown): unknown => {
    if (typeof v === "string") {
      const s = v.replace(EMAIL, "[email]");
      return re ? s.replace(re, "[person]") : s;
    }
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
    return v;
  };
  const out = scrub(r) as TrainRecord;
  return {
    ...out,
    // Ids and links name no one but may hold a handle: kept as they were.
    id: r.id,
    item: r.item,
    group: r.group,
    final: out.final && r.final ? { ...out.final, url: r.final.url } : out.final,
    // `by` is his login or a role, never a stranger's name.
    versions: out.versions.map((v, i) => ({ ...v, by: r.versions[i]?.by ?? null })),
    decisions: out.decisions.map((d, i) => ({ ...d, by: r.decisions[i]?.by ?? null })),
    outcome: out.outcome
      ? {
          ...out.outcome,
          replies: out.outcome.replies.map((x) => ({ ...x, author: "[person]" })),
        }
      : null,
  };
}

export type PairType = "edit" | "decision" | "engagement";
export interface TrainPair {
  schema: typeof TRAIN_PAIR;
  type: PairType;
  id: string;
  kind: DraftRecordKind;
  platform: string | null;
  /** What both sides answer: the model's input for edit and decision pairs. */
  input: Record<string, unknown> | null;
  chosen: { record: string; title: string | null; text: string };
  rejected: { record: string; title: string | null; text: string };
  /** Why the chosen side won, in his words or the numbers. */
  why: Record<string, unknown>;
}

const last = (r: TrainRecord) => r.versions.at(-1);
const kept = (r: TrainRecord) =>
  !!r.final || r.decisions.some((d) => d.event === "approved" || d.event === "scheduled");
const dropped = (r: TrainRecord) => !kept(r) && r.decisions.some((d) => d.event === "rejected");
const sideOf = (r: TrainRecord, v: TrainVersion) => ({
  record: r.id,
  title: v.title,
  text: v.text,
});
/** Reactions, comments, shares and follows: what a post earned past being seen. */
export const engagedOf = (o: TrainOutcome | null) =>
  o ? (o.reactions ?? 0) + (o.comments ?? 0) + (o.shares ?? 0) + (o.follows ?? 0) : null;

/** Sent posts this far apart are compared; further, the audience moved. */
const ENGAGEMENT_DAYS = 30;
/** The chosen post earned at least this many times the other's, and at least `ENGAGED_MIN`. */
const ENGAGEMENT_RATIO = 2;
const ENGAGED_MIN = 3;
/** Each post wins at most this many engagement pairs, against the posts nearest in time. */
const ENGAGEMENT_PER = 3;

/**
 * Preference pairs: `edit` (the model's first words lose to what he kept), `decision` (a draft he
 * turned down loses to one kept for the same ask), `engagement` (a post loses to one on the same
 * platform, near in time, that earned twice the engagement).
 */
export function trainPairs(records: readonly TrainRecord[]): TrainPair[] {
  const pairs: TrainPair[] = [];
  for (const r of records) {
    const first = r.versions[0];
    const end = r.final ? { title: r.final.title, text: r.final.text ?? "" } : (last(r) ?? null);
    if (first?.via !== "model" || !end || !kept(r)) continue;
    if (end.text === first.text && end.title === first.title) continue;
    pairs.push({
      schema: TRAIN_PAIR,
      type: "edit",
      id: `edit:${r.id}`,
      kind: r.kind,
      platform: r.platform,
      input: r.input,
      chosen: { record: r.id, title: end.title, text: end.text },
      rejected: sideOf(r, first),
      why: {
        asks: r.versions.map((v) => v.ask).filter(Boolean),
        by: r.versions.slice(1).map((v) => v.via),
      },
    });
  }
  const byGroup = new Map<string, TrainRecord[]>();
  for (const r of records) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
  for (const g of byGroup.values()) {
    const good = g.filter(kept);
    for (const bad of g.filter(dropped)) {
      const no = bad.decisions.findLast((d) => d.event === "rejected");
      const lost = last(bad);
      if (!lost) continue;
      for (const won of good) {
        const v = last(won);
        if (!v) continue;
        pairs.push({
          schema: TRAIN_PAIR,
          type: "decision",
          id: `decision:${won.id}>${bad.id}`,
          kind: won.kind,
          platform: won.platform,
          input: won.input ?? bad.input,
          chosen: won.final
            ? { record: won.id, title: won.final.title, text: won.final.text ?? v.text }
            : sideOf(won, v),
          rejected: sideOf(bad, lost),
          why: { reason: no?.reason ?? null, note: no?.note ?? null },
        });
      }
    }
  }
  const sent = records
    .filter((r) => r.kind === "post" && r.final && engagedOf(r.outcome) !== null)
    .sort((a, b) => (a.final?.at ?? "").localeCompare(b.final?.at ?? ""));
  const window = ENGAGEMENT_DAYS * 86_400_000;
  for (const won of sent) {
    const score = engagedOf(won.outcome) ?? 0;
    if (score < ENGAGED_MIN) continue;
    const at = new Date(won.final?.at ?? 0).getTime();
    const near = sent
      .filter(
        (o) =>
          o !== won &&
          o.platform === won.platform &&
          Math.abs(new Date(o.final?.at ?? 0).getTime() - at) <= window &&
          (engagedOf(o.outcome) ?? 0) * ENGAGEMENT_RATIO <= score,
      )
      .sort(
        (a, b) =>
          Math.abs(new Date(a.final?.at ?? 0).getTime() - at) -
          Math.abs(new Date(b.final?.at ?? 0).getTime() - at),
      )
      .slice(0, ENGAGEMENT_PER);
    for (const lost of near)
      pairs.push({
        schema: TRAIN_PAIR,
        type: "engagement",
        id: `engagement:${won.id}>${lost.id}`,
        kind: "post",
        platform: won.platform,
        input: null,
        chosen: { record: won.id, title: won.final?.title ?? null, text: won.final?.text ?? "" },
        rejected: {
          record: lost.id,
          title: lost.final?.title ?? null,
          text: lost.final?.text ?? "",
        },
        why: {
          chosen: { engaged: score, views: won.outcome?.views ?? null },
          rejected: { engaged: engagedOf(lost.outcome), views: lost.outcome?.views ?? null },
        },
      });
  }
  return pairs;
}

/** One JSON object per line. */
export const jsonl = (rows: readonly unknown[]) =>
  rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
