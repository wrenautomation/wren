/**
 * Our posted pieces for learn back (designs/2026-10-25-competitor-analyzer.md, Learn back): the
 * published drafts an SOP's scope covers, each as the Learn kind it is and with its one real
 * number (`MEASURE_OF`). A piece with no number yet waits for its next insights look.
 */
import type { Db, Queryable } from "@wren/db";
import {
  breakdownItem,
  type CheckRow,
  callsOf,
  checksOf,
  type ItemKind,
  type JudgeFor,
  MEASURE_OF,
  type OurPiece,
  ourPatterns,
  readQueued,
  rulesOf,
  type SopScope,
  saveOurs,
  type VideoReader,
  writeChecks,
} from "@wren/learn";
import { sql } from "drizzle-orm";
import { FILM_MAX_S } from "./film-check.js";
import { formatSql } from "./schema.js";

interface Row {
  draft_id: string;
  platform: string;
  format: string;
  url: string;
  title: string;
  text: string;
  hook: number | null;
  avg_view_pct: number | null;
  avg_view_secs: number | null;
  score: number | null;
}

/**
 * A published piece's Learn kind by its format: short videos are reels, a long one a film when it
 * runs 3 minutes or less (its length is average seconds over average share watched), text a post.
 * Stories and carousels have no rubric: null.
 */
export function kindOfPost(
  r: Pick<Row, "format" | "hook" | "avg_view_pct" | "avg_view_secs">,
): ItemKind | null {
  switch (r.format) {
    case "short":
    case "reel":
    case "video":
      return "reel";
    case "long": {
      const length = r.avg_view_pct && r.avg_view_secs ? r.avg_view_secs / r.avg_view_pct : null;
      return length !== null && length <= FILM_MAX_S ? "film" : "video";
    }
    case "post":
    case "thread":
      // A feed post with a skip rate is a video in the feed.
      return r.hook !== null ? "reel" : "post";
    default:
      return null;
  }
}

/** Its real number on the kind's measure, as a share; null until insights give it. */
export function outcomeOf(
  kind: ItemKind,
  r: Pick<Row, "hook" | "avg_view_pct" | "score">,
): number | null {
  const m = MEASURE_OF[kind];
  const v =
    m === "hook"
      ? r.hook
      : m === "watched"
        ? r.avg_view_pct
        : m === "engagement" && r.score !== null
          ? r.score / 100
          : null;
  return v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);
}

/** Our published pieces in `scope` with a real number. */
export async function ourPieces(db: Queryable, scope: SopScope): Promise<OurPiece[]> {
  const rows = (await db.execute(sql`
    select d.id::text draft_id, d.platform::text platform, ${sql.raw(formatSql)} format, d.url::text url,
      coalesce(d.title, left(split_part(d.text, chr(10), 1), 200)) title, d.text,
      r.hook, r.avg_view_pct, r.avg_view_secs, r.score
    from content_drafts d
      join marketing_post_records r on split_part(r.id, '/', 3) = d.id::text
    where d.published_at is not null and d.url is not null`)) as unknown as Row[];
  return rows.flatMap((r) => {
    if (scope.platforms.length && !scope.platforms.includes(r.platform)) return [];
    const kind = kindOfPost(r);
    if (!kind || !scope.kinds.includes(kind)) return [];
    const measure = MEASURE_OF[kind];
    const outcome = outcomeOf(kind, r);
    if (!measure || outcome === null) return [];
    return [
      {
        draftId: r.draft_id,
        kind,
        platform: r.platform,
        url: r.url,
        title: r.title,
        text: r.text,
        outcome,
        measure,
      },
    ];
  });
}

export interface LearnBack {
  /** Our pieces in scope with a real number. */
  pieces: number;
  /** Of them, newly saved as Learn items this run. */
  saved: number;
  /** Broken down, before and this run. */
  broken: number;
  /** Rows of "check this": a kept pattern on one piece he kept it on. */
  checks: CheckRow[];
}

/**
 * One SOP's learn back: our pieces in its scope into Learn, read and broken down like anyone's,
 * then his kept patterns held to their real numbers, kind by kind. The SOP's "check this" rows are
 * written whole. A piece the reader cannot take yet waits for the next run.
 */
export async function learnBack(
  db: Db,
  o: {
    client: string;
    sop: string;
    scope: SopScope;
    read: VideoReader;
    judge: JudgeFor;
    say?: (line: string) => void;
  },
): Promise<LearnBack> {
  const pieces = await ourPieces(db, o.scope);
  const { ids, saved } = await saveOurs(db, o.client, pieces);
  const known = await ourPatterns(db, [...ids.values()]);
  const unread = pieces.filter((p) => p.kind !== "post" && !known.has(ids.get(p.draftId) ?? -1));
  if (unread.length)
    await readQueued(
      db,
      unread.map((p) => ids.get(p.draftId) ?? -1),
      { read: o.read, judge: o.judge },
    );
  for (const p of pieces) {
    const id = ids.get(p.draftId);
    if (id !== undefined && !known.has(id)) await breakdownItem(db, o.judge, id);
  }
  const values = await ourPatterns(db, [...ids.values()]);
  const { patterns } = rulesOf(await callsOf(db, o.scope, o.sop));
  const rows = [...new Set(pieces.map((p) => p.kind))].flatMap((kind) => {
    const ours = pieces.flatMap((p) => {
      const v = values.get(ids.get(p.draftId) ?? -1);
      return p.kind === kind && v ? [{ values: v, outcome: p.outcome }] : [];
    });
    const measure = MEASURE_OF[kind];
    return measure ? checksOf(o.sop, kind, patterns, ours, measure) : [];
  });
  await writeChecks(db, o.sop, rows);
  o.say?.(
    `${o.sop}: ${pieces.length} of ours in scope, ${values.size} broken down, ${rows.length} to check`,
  );
  return { pieces: pieces.length, saved, broken: values.size, checks: rows };
}
