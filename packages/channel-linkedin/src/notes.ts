import type { Db } from "@wren/db";
import { desc, eq } from "drizzle-orm";
import { type Note, notes } from "./schema.js";

export type NoteSource = "inbox" | "cli";

/** Insert one note. Rejects blank bodies so the pipeline never drafts from nothing. */
export async function addNote(
  db: Db,
  body: string,
  source: NoteSource,
  imagePaths: string[] = [],
): Promise<Note> {
  const trimmed = body.trim();
  if (trimmed === "") throw new Error("note body is empty");
  const [row] = await db.insert(notes).values({ body: trimmed, source, imagePaths }).returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

export function listNotes(db: Db, status: string, limit = 50): Promise<Note[]> {
  return db
    .select()
    .from(notes)
    .where(eq(notes.status, status))
    .orderBy(desc(notes.createdAt))
    .limit(limit);
}
