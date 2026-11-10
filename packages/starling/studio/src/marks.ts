/**
 * Marks on a video (designs/2026-11-10-video-editor-pick.md): a note pinned to a moment, a range
 * or a part of the picture. The person adds them in Finish or says them; the agent reads the open
 * ones (`wren video marks`, the pass's prompt) and closes each with what it did.
 */
import type { Queryable } from "@wren/db";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { FORMATS, MARK_TONES, type VideoMark, videoEdits, videoMarks } from "./schema.js";

export const MARK_TEXT_MAX = 2000;
export const MARK_WHY_MAX = 600;
/** Open marks handed to one agent pass; the rest wait for the next. */
export const MARKS_PER_PASS = 30;

const frac = z.number().min(0).max(1);
export const markBoxSchema = z
  .object({ x: frac, y: frac, w: frac.positive(), h: frac.positive() })
  .refine((b) => b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001, "the box leaves the frame");
export const markInputSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative().nullish(),
  box: markBoxSchema.nullish(),
  format: z.enum(FORMATS).default("long"),
  tone: z.enum(MARK_TONES).nullish(),
  text: z.string().trim().min(1, "A mark needs words.").max(MARK_TEXT_MAX),
});
export type MarkInput = z.input<typeof markInputSchema>;

/** A mark as the page and the agent read it. */
export interface Mark {
  id: number;
  start: number;
  end: number | null;
  box: { x: number; y: number; w: number; h: number } | null;
  format: string;
  tone: "good" | "bad" | null;
  text: string;
  by: string;
  at: string;
  done: { at: string; by: string | null; why: string | null } | null;
}

export const markOf = (m: VideoMark): Mark => ({
  id: m.id,
  start: m.anchor.start,
  end: m.anchor.end ?? null,
  box: m.anchor.box ?? null,
  format: m.format,
  tone: m.tone ?? null,
  text: m.text,
  by: m.by,
  at: m.createdAt.toISOString(),
  done: m.doneAt ? { at: m.doneAt.toISOString(), by: m.doneBy, why: m.doneWhy } : null,
});

/** A new mark on video `editId`; times are raw seconds and must sit inside the recording. */
export async function addMark(
  db: Queryable,
  editId: number,
  input: MarkInput,
  by: string,
): Promise<Mark> {
  const m = markInputSchema.parse(input);
  const [e] = await db
    .select({ tracks: videoEdits.tracks })
    .from(videoEdits)
    .where(eq(videoEdits.id, editId));
  if (!e) throw new Error("That video isn't here any more. Reload the page to see what's left.");
  const dur = e.tracks.main.durationS;
  const end = m.end ?? null;
  if (m.start > dur || (end !== null && (end > dur + 0.001 || end <= m.start)))
    throw new Error(
      `A mark sits inside the recording (0 to ${dur.toFixed(2)} s), start before end.`,
    );
  const [row] = await db
    .insert(videoMarks)
    .values({
      editId,
      anchor: {
        type: "time",
        start: m.start,
        ...(end !== null ? { end } : {}),
        ...(m.box ? { box: m.box } : {}),
      },
      format: m.format,
      tone: m.tone ?? null,
      text: m.text,
      by,
    })
    .returning();
  return markOf(row as VideoMark);
}

/** Video `editId`'s marks in time order; `open`: only those not closed. */
export async function marksOf(
  db: Queryable,
  editId: number,
  o: { open?: boolean } = {},
): Promise<Mark[]> {
  const rows = await db
    .select()
    .from(videoMarks)
    .where(
      and(
        eq(videoMarks.editId, editId),
        isNull(videoMarks.removedAt),
        o.open ? isNull(videoMarks.doneAt) : undefined,
      ),
    )
    .orderBy(asc(videoMarks.createdAt), asc(videoMarks.id));
  return rows.map(markOf).sort((a, b) => a.start - b.start || a.id - b.id);
}

/**
 * Close marks on video `editId` with what was done (`why`). A mark of another video, or one closed
 * already, is skipped and named in `skipped`.
 */
export async function closeMarks(
  db: Queryable,
  editId: number,
  done: readonly { id: number; why: string }[],
  o: { by: string; run?: string | null },
): Promise<{ closed: number[]; skipped: number[] }> {
  if (!done.length) return { closed: [], skipped: [] };
  const open = await db
    .select({ id: videoMarks.id })
    .from(videoMarks)
    .where(
      and(
        eq(videoMarks.editId, editId),
        isNull(videoMarks.doneAt),
        isNull(videoMarks.removedAt),
        inArray(
          videoMarks.id,
          done.map((d) => d.id),
        ),
      ),
    );
  const ids = new Set(open.map((r) => r.id));
  const closed: number[] = [];
  const skipped: number[] = [];
  for (const d of done) {
    if (!ids.has(d.id)) {
      skipped.push(d.id);
      continue;
    }
    ids.delete(d.id);
    await db
      .update(videoMarks)
      .set({
        doneAt: new Date(),
        doneBy: o.by,
        doneWhy: d.why.trim().slice(0, MARK_WHY_MAX) || null,
        doneRun: o.run ?? null,
      })
      .where(eq(videoMarks.id, d.id));
    closed.push(d.id);
  }
  return { closed, skipped };
}

/** Take a mark back, open or closed: out of every list, the row kept so `restoreMark` undoes it. */
export async function dropMark(
  db: Queryable,
  editId: number,
  markId: number,
  by: string,
): Promise<boolean> {
  const gone = await db
    .update(videoMarks)
    .set({ removedAt: new Date(), removedBy: by })
    .where(
      and(eq(videoMarks.id, markId), eq(videoMarks.editId, editId), isNull(videoMarks.removedAt)),
    )
    .returning({ id: videoMarks.id });
  return gone.length > 0;
}

/** Undo `dropMark`: the mark back as it was, open or closed. */
export async function restoreMark(db: Queryable, editId: number, markId: number): Promise<boolean> {
  const back = await db
    .update(videoMarks)
    .set({ removedAt: null, removedBy: null })
    .where(
      and(
        eq(videoMarks.id, markId),
        eq(videoMarks.editId, editId),
        isNotNull(videoMarks.removedAt),
      ),
    )
    .returning({ id: videoMarks.id });
  return back.length > 0;
}

/** Open marks as the agent's prompt carries them: times in raw seconds, a box as fractions. */
export const marksForAgent = (marks: readonly Mark[]) =>
  marks.slice(0, MARKS_PER_PASS).map((m) => ({
    id: m.id,
    at: m.end === null ? m.start : [m.start, m.end],
    ...(m.box ? { box: m.box, on: m.format } : {}),
    ...(m.tone ? { tone: m.tone } : {}),
    says: m.text,
    by: m.by,
  }));
