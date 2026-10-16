/**
 * His call on a drafted comment, read off the draft record. `recordDraft` writes it as the step
 * lands; the backfill writes history's the same way. Subject: the draft's Inbox id.
 *
 * Sent with the model's words = send; sent after his or Claude's edit = edit; dropped, skipped or
 * passed by him = drop. A send by `wren` (a scheduler, no person) and a guard's reject are not his.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import type { DraftEvent, DraftRecordKind, DraftVia } from "../schema.js";
import { recordCall } from "./calls.js";

/** Draft kinds `comment_quality` judges. */
export const COMMENT_DRAFT_KINDS: ReadonlySet<DraftRecordKind> = new Set([
  "comment",
  "thread",
  "post_comment",
]);

/** The step is his call on a drafted comment. */
export const isCommentCall = (s: {
  kind: DraftRecordKind;
  event: DraftEvent;
  via: DraftVia;
  ref?: string | null;
}): boolean =>
  COMMENT_DRAFT_KINDS.has(s.kind) &&
  !s.ref?.startsWith("bf:") &&
  ((s.event === "sent" && (s.via === "person" || s.via === "claude")) ||
    (s.event === "rejected" && s.via === "person"));

type Row = Record<string, unknown>;

/** `isCommentCall`'s event and via test, on a `draft_events e` row. */
const HIS_STEP = sql`((e.event = 'sent' and e.via in ('person', 'claude')) or (e.event = 'rejected' and e.via = 'person'))`;

/**
 * Keep his call for an item's newest round, as of its newest sent or rejected step. Nothing when
 * the item has neither, or no model draft to judge. The ref is the round's, so a live call and
 * the backfill of the same round are one row.
 */
export async function recordCommentCall(
  db: Queryable,
  item: string,
  o: { backfill?: boolean } = {},
): Promise<boolean> {
  const [r] = (await db.execute(sql`
    with last as (
      select e.round, e.event, e.via, e.by, e.text, e.at, e.id from draft_events e
      where e.item = ${item} and ${HIS_STEP}
      order by e.at desc, e.id desc limit 1
    ), gen as (
      select g.text, g.at, g.id from draft_events g, last
      where g.item = ${item} and g.round = last.round and g.event = 'generated'
        and (g.at, g.id) < (last.at, last.id)
      order by g.at desc, g.id desc limit 1
    )
    select last.round, last.event, last.via, last.by, last.at,
      (last.text is not null and btrim(last.text) is distinct from btrim(gen.text))
        or exists (select 1 from draft_events x where x.item = ${item} and x.round = last.round
          and x.event = 'edited' and x.via in ('person', 'claude') and (x.at, x.id) > (gen.at, gen.id)
          and (x.at, x.id) < (last.at, last.id)) as edited
    from last join gen on true`)) as unknown as Row[];
  if (!r) return false;
  const label = r.event === "rejected" ? "drop" : r.edited ? "edit" : "send";
  await recordCall(db, {
    kind: "comment_quality",
    subject: item,
    label,
    source: `${o.backfill ? "backfill:" : ""}${r.event}`,
    by: (r.by as string | null) ?? null,
    ref: `comment_quality:${item}:r${r.round}`,
    at: r.at instanceof Date ? r.at : new Date(String(r.at)),
  });
  return true;
}

/** History's calls: every drafted comment he sent or dropped, once each round. */
export async function backfillCommentCalls(
  db: Queryable,
): Promise<{ items: number; kept: number }> {
  const rows = (await db.execute(sql`
    select distinct e.item from draft_events e
    where e.kind in ('comment', 'thread', 'post_comment') and ${HIS_STEP}
    order by e.item`)) as unknown as Row[];
  let kept = 0;
  for (const r of rows) if (await recordCommentCall(db, String(r.item), { backfill: true })) kept++;
  return { items: rows.length, kept };
}
