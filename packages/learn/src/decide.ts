/**
 * Decide's Learn side (designs/2026-10-16-decide.md), Wren's own workspace only. The source: items
 * scored in the last 3 days with no decision yet, shown as their words against `WREN_FOCUS`. The
 * calls: a star, a pin, a save or an SOP add is "worth"; an archive with none of those is "skip".
 * Undoing a mark adds nothing: his last call stands until he makes another. `mark` answers only the
 * ids it changed, so a replayed mark adds no second call.
 */
import { WREN } from "@wren/core/access";
import { type DecideSource, type DecideSubject, picksOf, recordCall } from "@wren/core/decide";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { WREN_FOCUS } from "./score.js";

type Row = Record<string, unknown>;
const rowsOf = async (db: Queryable, q: ReturnType<typeof sql>): Promise<Row[]> =>
  (await db.execute(q)) as unknown as Row[];

/** Words past this are cut: Jev reads 32k tokens a question. */
const WORDS_MAX = 8000;
const FRESH_DAYS = 3;

export const learnSubject = (id: number) => `learn:${id}`;

/** One item as the state Jev reads. No creator: a name never goes in. */
export function learnState(r: Row): Record<string, unknown> {
  const words = String(r.transcript ?? r.text ?? "").trim();
  return {
    focus: WREN_FOCUS,
    item: Object.fromEntries(
      Object.entries({
        kind: r.kind,
        title: r.title,
        seconds: r.duration ?? null,
        words: words.length > WORDS_MAX ? `${words.slice(0, WORDS_MAX)}…` : words,
      }).filter(([, v]) => v != null && v !== ""),
    ),
  };
}

async function learnRows(
  db: Queryable,
  where: ReturnType<typeof sql>,
  order: ReturnType<typeof sql>,
  limit: number,
): Promise<DecideSubject[]> {
  const rows = await rowsOf(
    db,
    sql`
    select i.id, i.kind, i.title, i.duration, i.transcript, i.text
    from learn.items i
    where i.client = ${WREN} and ${where}
    order by ${order}
    limit ${limit}`,
  );
  return rows.map((r) => ({ subject: learnSubject(Number(r.id)), state: learnState(r) }));
}

const UNDECIDED = sql`not exists (select 1 from decisions x where x.kind = 'learn_worth'
  and x.subject = 'learn:' || i.id)`;

/** Items scored in the last 3 days with no decision yet, oldest score first. */
export function learnDue(db: Queryable, now: Date, limit: number): Promise<DecideSubject[]> {
  const since = new Date(now.getTime() - FRESH_DAYS * 86_400_000).toISOString();
  return learnRows(
    db,
    sql`i.scored_at >= ${since}::timestamptz and ${UNDECIDED}`,
    sql`i.scored_at`,
    limit,
  );
}

/** Read items he already called with no decision yet, for a first agreement number. */
export function learnCalled(db: Queryable, limit: number): Promise<DecideSubject[]> {
  return learnRows(
    db,
    sql`(i.transcript is not null or i.text <> '') and ${UNDECIDED}
      and exists (select 1 from decision_calls k where k.kind = 'learn_worth' and k.subject = 'learn:' || i.id)`,
    sql`i.id`,
    limit,
  );
}

export const learnSource: DecideSource = { kind: "learn_worth", due: learnDue };

/** Marks that are his call, and what they say. */
const MARK_CALLS: Readonly<Record<string, "worth" | "skip">> = {
  star: "worth",
  pin: "worth",
  archive: "skip",
};

/**
 * His call for each item a mark changed (`mark` answers only those), in Wren's workspace. An
 * archive counts as skip only on an item he never starred, pinned, saved or added to an SOP.
 */
export async function learnMarkCalls(
  db: Queryable,
  client: string,
  ids: readonly number[],
  m: string,
  by: string | null = null,
): Promise<void> {
  const label = MARK_CALLS[m];
  if (client !== WREN || !label || !ids.length) return;
  const kept =
    label === "skip"
      ? new Set(
          (
            await rowsOf(
              db,
              sql`select i.id from learn.items i where i.id in (${sql.join(
                ids.map((id) => sql`${id}`),
                sql`, `,
              )}) and (i.starred_at is not null or i.pinned_at is not null or i.saved_at is not null
                or exists (select 1 from learn.sop_sources s where s.item_id = i.id))`,
            )
          ).map((r) => Number(r.id)),
        )
      : new Set<number>();
  for (const id of ids)
    if (!kept.has(id))
      await recordCall(db, {
        kind: "learn_worth",
        subject: learnSubject(id),
        label,
        source: m,
        by,
      });
}

/** A save or an SOP add: worth it. */
export async function learnWorthCall(
  db: Queryable,
  client: string,
  id: number,
  source: "save" | "sop",
  by: string | null,
): Promise<void> {
  if (client !== WREN) return;
  await recordCall(db, {
    kind: "learn_worth",
    subject: learnSubject(id),
    label: "worth",
    source,
    by,
    ref: `learn_worth:${id}:${source}`,
  });
}

/**
 * History's calls in Wren's workspace, one per item, at the time he made it: worth for a star,
 * pin, save or SOP add (the first of them); skip for an archive with none.
 */
export async function backfillLearnCalls(db: Queryable): Promise<{ worth: number; skip: number }> {
  const rows = await rowsOf(
    db,
    sql`
    select i.id, i.starred_at, i.pinned_at, i.saved_at, i.saved_by, i.archived_at,
      (select min(s.asked_at) from learn.sop_sources s where s.item_id = i.id) as sop_at,
      (select s.by from learn.sop_sources s where s.item_id = i.id order by s.asked_at limit 1) as sop_by
    from learn.items i
    where i.client = ${WREN} and (i.starred_at is not null or i.pinned_at is not null
      or i.saved_at is not null or i.archived_at is not null
      or exists (select 1 from learn.sop_sources s where s.item_id = i.id))
    order by i.id`,
  );
  const n = { worth: 0, skip: 0 };
  const at = (v: unknown) => (v == null ? null : v instanceof Date ? v : new Date(String(v)));
  for (const r of rows) {
    const marks: { source: string; at: Date; by: string | null }[] = [];
    for (const [source, when, by] of [
      ["star", r.starred_at, null],
      ["pin", r.pinned_at, null],
      ["save", r.saved_at, r.saved_by],
      ["sop", r.sop_at, r.sop_by],
    ] as const) {
      const t = at(when);
      if (t) marks.push({ source, at: t, by: (by as string | null) ?? null });
    }
    const first = marks.sort((a, b) => a.at.getTime() - b.at.getTime())[0];
    const archived = at(r.archived_at);
    const call = first
      ? { label: "worth", ...first }
      : archived
        ? { label: "skip", source: "archive", at: archived, by: null }
        : null;
    if (!call) continue;
    await recordCall(db, {
      kind: "learn_worth",
      subject: learnSubject(Number(r.id)),
      label: call.label,
      source: `backfill:${call.source}`,
      by: call.by,
      ref: `bf:learn_worth:${r.id}`,
      at: call.at,
    });
    n[call.label as "worth" | "skip"]++;
  }
  return n;
}

/** Worth it or Skip, as a card shows it. */
export type LearnPick = "worth" | "skip";

/**
 * Wren's cards with their newest pick, when Learn items show picks (recommend or gate). A client's
 * cards and an item with no decision get none.
 */
export async function withLearnPicks<C extends { id: number }>(
  db: Queryable,
  client: string,
  cards: C[],
): Promise<(C & { pick: LearnPick | null })[]> {
  const picks =
    client === WREN
      ? await picksOf(
          db,
          "learn_worth",
          cards.map((c) => learnSubject(c.id)),
        )
      : new Map();
  return cards.map((c) => ({
    ...c,
    pick: (picks.get(learnSubject(c.id))?.label as LearnPick | undefined) ?? null,
  }));
}
