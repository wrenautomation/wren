/**
 * A Studio edit beside the film standard (designs/2026-10-25-competitor-analyzer.md, Use). Code
 * only: the edit holds the exact cut list, so its length, cuts and shot lengths are counted, not
 * guessed. A short edit (3 minutes or less) is checked as a `film`, a longer one as a `video`.
 * The scope is the newest pushed SOP that governs that kind, else the kind on YouTube. None when
 * there is no standard yet, or on a client's database (the standard is Wren's own).
 */

import type { Queryable } from "@wren/db";
import {
  checkPiece,
  kindStandardOf,
  type PieceCheck,
  type SopScope,
  shotStats,
  shotsOf,
} from "@wren/learn";
import { keepSegments } from "@wren/studio/cuts";
import type { VideoEdit } from "@wren/studio/schema";
import { desc, sql } from "drizzle-orm";
import { contentPlaybooks } from "./schema.js";

/** Longest a `film` runs; a longer edit is a `video`. */
export const FILM_MAX_S = 180;

export type FilmCheck = PieceCheck & { sop: string | null };

/** The edit as it plays after its cuts: its length and where each kept span starts. */
export function cutTimeline(e: Pick<VideoEdit, "cuts" | "tracks">): {
  durationS: number;
  cuts: number[];
} {
  const spans = keepSegments(e.cuts, e.tracks.main.durationS);
  const cuts: number[] = [];
  let at = 0;
  for (const s of spans) {
    if (at > 0) cuts.push(at);
    at += s.e - s.s;
  }
  return { durationS: at, cuts };
}

export async function filmCheck(
  db: Queryable,
  e: Pick<VideoEdit, "cuts" | "tracks" | "words">,
): Promise<FilmCheck | null> {
  const { durationS, cuts } = cutTimeline(e);
  if (durationS <= 0) return null;
  const kind = durationS <= FILM_MAX_S ? "film" : "video";
  const [pushed] = await db
    .select({ sop: contentPlaybooks.sop, scope: contentPlaybooks.scope })
    .from(contentPlaybooks)
    .where(sql`${contentPlaybooks.scope}->'kinds' ? ${kind}`)
    .orderBy(desc(contentPlaybooks.createdAt))
    .limit(1);
  const scope: SopScope = pushed?.scope
    ? { ...pushed.scope, kinds: [kind], sop: pushed.sop }
    : { kinds: [kind], platforms: ["youtube"], topic: "", set: [] };
  const standard = await kindStandardOf(db, scope);
  if (!standard) return null;
  const stats = shotStats(shotsOf(cuts, durationS), durationS);
  const check = checkPiece(kind, standard, [], {
    durationS,
    cuts: cuts.length,
    shotMedianS: stats.shot_median_s,
    shotP90S: stats.shot_p90_s,
    vo: e.words.length > 0,
  });
  return { ...check, sop: pushed?.sop ?? null };
}
