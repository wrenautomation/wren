import type { Media } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { desc, eq } from "drizzle-orm";
import { type ContentIdea, contentIdeas, type IdeaSource, type IdeaStatus } from "./schema.js";

/** Insert one idea. Blank text is refused so nothing is ever drafted from nothing. */
export async function addIdea(
  db: Queryable,
  text: string,
  source: IdeaSource,
  media: Media | null = null,
): Promise<ContentIdea> {
  const trimmed = text.trim();
  if (trimmed === "") throw new Error("idea text is empty");
  const [row] = await db.insert(contentIdeas).values({ text: trimmed, source, media }).returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

/** The planner's idea, made once per `ref`; null when that ref already has one. */
export async function addIdeaOnce(
  db: Queryable,
  text: string,
  source: IdeaSource,
  ref: string,
): Promise<ContentIdea | null> {
  const [row] = await db
    .insert(contentIdeas)
    .values({ text: text.trim(), source, ref })
    .onConflictDoNothing({ target: contentIdeas.ref })
    .returning();
  return row ?? null;
}

export async function hasIdeaRef(db: Queryable, ref: string): Promise<boolean> {
  const [row] = await db
    .select({ id: contentIdeas.id })
    .from(contentIdeas)
    .where(eq(contentIdeas.ref, ref))
    .limit(1);
  return row !== undefined;
}

export function listIdeas(db: Queryable, status: IdeaStatus, limit = 50): Promise<ContentIdea[]> {
  return db
    .select()
    .from(contentIdeas)
    .where(eq(contentIdeas.status, status))
    .orderBy(desc(contentIdeas.createdAt))
    .limit(limit);
}

export async function getIdea(db: Queryable, id: string): Promise<ContentIdea> {
  const [row] = await db.select().from(contentIdeas).where(eq(contentIdeas.id, id)).limit(1);
  if (!row) throw new Error(`no idea ${id}`);
  return row;
}

export async function archiveIdea(db: Queryable, id: string): Promise<void> {
  const rows = await db
    .update(contentIdeas)
    .set({ status: "archived" })
    .where(eq(contentIdeas.id, id))
    .returning({ id: contentIdeas.id });
  if (rows.length === 0) throw new Error(`no idea ${id}`);
}
