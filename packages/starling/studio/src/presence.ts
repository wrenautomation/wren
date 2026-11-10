/**
 * Who is on a video now (designs/2026-11-10-video-editor-pick.md, agent cursor). An agent says
 * where it is before each step (`wren video at`, the edit pass); Finish reads the fresh rows and
 * draws a cursor for each. No shared edit model: writes still go through `expect` and the locks.
 */
import type { Queryable } from "@wren/db";
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { PRESENCE_PARTS, type PresencePart, type VideoPresence, videoPresence } from "./schema.js";

/** A row older than this draws no cursor: the agent stopped, or forgot to leave. */
const PRESENCE_FRESH_S = 120;
const PRESENCE_DOING_MAX = 200;

const presenceInputSchema = z.object({
  start: z.number().nonnegative().nullish(),
  end: z.number().nonnegative().nullish(),
  part: z.enum(PRESENCE_PARTS).nullish(),
  doing: z.string().trim().max(PRESENCE_DOING_MAX).nullish(),
  gone: z.boolean().optional(),
});
export type PresenceInput = z.input<typeof presenceInputSchema>;

/** Someone on a video, as the page reads it. */
export interface Presence {
  who: string;
  start: number | null;
  end: number | null;
  part: PresencePart | null;
  doing: string | null;
  at: string;
}

const presenceRow = (r: VideoPresence): Presence => ({
  who: r.who,
  start: r.anchor?.start ?? null,
  end: r.anchor?.end ?? null,
  part: r.part ?? null,
  doing: r.doing,
  at: r.seenAt.toISOString(),
});

/** `who` is here on video `editId` now, or with `gone`, has left. One row per call. */
export async function sayPresence(
  db: Queryable,
  editId: number,
  who: string,
  input: PresenceInput = {},
): Promise<Presence> {
  const p = presenceInputSchema.parse(input);
  const start = p.start ?? null;
  const end = p.end ?? null;
  if (end !== null && (start === null || end <= start))
    throw new Error("A range needs a start before its end.");
  const [row] = await db
    .insert(videoPresence)
    .values({
      editId,
      who,
      anchor: start === null ? null : { type: "time", start, ...(end !== null ? { end } : {}) },
      part: p.part ?? null,
      doing: p.doing || null,
      gone: p.gone ?? false,
    })
    .returning();
  return presenceRow(row as VideoPresence);
}

/** Who is on video `editId` now: the newest fresh row of each `who`, less those who left. */
export async function presenceOf(
  db: Queryable,
  editId: number,
  now: Date = new Date(),
): Promise<Presence[]> {
  const rows = await db
    .select()
    .from(videoPresence)
    .where(
      and(
        eq(videoPresence.editId, editId),
        gte(videoPresence.seenAt, new Date(now.getTime() - PRESENCE_FRESH_S * 1000)),
      ),
    )
    .orderBy(desc(videoPresence.seenAt), desc(videoPresence.id));
  return newestPerWho(rows).map(presenceRow);
}

/** Rows newest first → the first of each `who`, without those whose first row says `gone`. */
export function newestPerWho<T extends { who: string; gone: boolean }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.who)) continue;
    seen.add(r.who);
    if (!r.gone) out.push(r);
  }
  return out;
}
