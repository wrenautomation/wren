/**
 * The review seat: a person reads drafts and approves, rejects or edits them.
 * Nothing here publishes. An edit puts an approved draft back to `draft` so
 * what goes out is always something a person approved as written.
 */
import type { Platform } from "@wren/core/content";
import type { Queryable } from "@wren/db";
import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { missingExtra, PLATFORM_SPECS } from "./platforms.js";
import { type ContentDraft, contentDrafts, type DraftStatus } from "./schema.js";
import { nextSlot } from "./slots.js";

export interface DraftFilter {
  status?: DraftStatus;
  platform?: Platform;
  ideaId?: string;
  limit?: number;
}

export function listDrafts(db: Queryable, f: DraftFilter = {}): Promise<ContentDraft[]> {
  const where: SQL[] = [];
  if (f.status) where.push(eq(contentDrafts.status, f.status));
  if (f.platform) where.push(eq(contentDrafts.platform, f.platform));
  if (f.ideaId) where.push(eq(contentDrafts.ideaId, f.ideaId));
  return db
    .select()
    .from(contentDrafts)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(contentDrafts.createdAt))
    .limit(Math.min(f.limit ?? 50, 500));
}

export async function getDraft(db: Queryable, id: string): Promise<ContentDraft> {
  const [row] = await db.select().from(contentDrafts).where(eq(contentDrafts.id, id)).limit(1);
  if (!row) throw new Error(`no draft ${id}`);
  return row;
}

/** Statuses a person may move from. `failed` re-arms a publish that broke. */
const APPROVABLE: readonly DraftStatus[] = ["draft", "failed"];
const REJECTABLE: readonly DraftStatus[] = ["draft", "approved", "failed"];
const EDITABLE: readonly DraftStatus[] = ["draft", "approved", "failed"];

async function moveAll(
  db: Queryable,
  ids: readonly string[],
  from: readonly DraftStatus[],
  set: Partial<typeof contentDrafts.$inferInsert>,
  verb: string,
): Promise<ContentDraft[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .update(contentDrafts)
    .set(set)
    .where(and(inArray(contentDrafts.id, [...ids]), inArray(contentDrafts.status, [...from])))
    .returning();
  const moved = new Set(rows.map((r) => r.id));
  const missed = ids.filter((id) => !moved.has(id));
  if (missed.length > 0)
    throw new Error(
      `cannot ${verb} ${missed.join(", ")}: not ${from.join("/")} (or no such draft)`,
    );
  return rows;
}

/**
 * Approve. `at` schedules; `now: true` posts on the next pass; otherwise each
 * draft takes its platform's next default slot on `zone`'s clock.
 */
export async function approveDrafts(
  db: Queryable,
  ids: readonly string[],
  o: { now: Date; at?: Date | null; zone?: string; asap?: boolean },
): Promise<ContentDraft[]> {
  const base = { status: "approved" as const, approvedAt: o.now, error: null };
  await refuseMissingExtra(db, ids);
  if (o.at || o.asap || !o.zone)
    return moveAll(db, ids, APPROVABLE, { ...base, scheduledFor: o.at ?? null }, "approve");
  const zone = o.zone;
  const rows: ContentDraft[] = [];
  for (const id of ids) {
    const [draft] = await db.select().from(contentDrafts).where(eq(contentDrafts.id, id));
    if (!draft) throw new Error(`cannot approve ${id}: no such draft`);
    const at = nextSlot(draft.platform, o.now, zone);
    rows.push(...(await moveAll(db, [id], APPROVABLE, { ...base, scheduledFor: at }, "approve")));
  }
  return rows;
}

/** A draft whose platform needs an `extra` key (Reddit's subreddit) is not approvable without it. */
async function refuseMissingExtra(db: Queryable, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: contentDrafts.id, platform: contentDrafts.platform, extra: contentDrafts.extra })
    .from(contentDrafts)
    .where(inArray(contentDrafts.id, [...ids]));
  const lacking = rows
    .map((r) => ({ id: r.id, missing: missingExtra(PLATFORM_SPECS[r.platform], r.extra) }))
    .filter((r) => r.missing.length > 0);
  if (lacking.length > 0)
    throw new Error(
      `cannot approve: ${lacking.map((r) => `${r.id} needs ${r.missing.join(", ")}`).join("; ")} (wren content extra <id> key=value)`,
    );
}

/**
 * Merge keys into a draft's `extra` (a `null` value removes one). The text is
 * untouched, so an approved draft stays approved: where it goes is not what it says.
 */
export async function setExtra(
  db: Queryable,
  id: string,
  patch: Readonly<Record<string, unknown>>,
): Promise<ContentDraft> {
  const current = await getDraft(db, id);
  if (!EDITABLE.includes(current.status))
    throw new Error(`cannot change ${id}: it is ${current.status}`);
  const extra: Record<string, unknown> = { ...current.extra };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete extra[k];
    else extra[k] = v;
  }
  const [row] = await db
    .update(contentDrafts)
    .set({ extra })
    .where(eq(contentDrafts.id, id))
    .returning();
  if (!row) throw new Error(`no draft ${id}`);
  return row;
}

export function rejectDrafts(db: Queryable, ids: readonly string[]): Promise<ContentDraft[]> {
  return moveAll(db, ids, REJECTABLE, { status: "rejected", scheduledFor: null }, "reject");
}

/** Replace the text (and title); the draft goes back to `draft` for a fresh approval. */
export async function editDraft(
  db: Queryable,
  id: string,
  change: { text: string; title?: string | null },
): Promise<ContentDraft> {
  const current = await getDraft(db, id);
  if (!EDITABLE.includes(current.status))
    throw new Error(`cannot edit ${id}: it is ${current.status}`);
  const spec = PLATFORM_SPECS[current.platform];
  const text = change.text.trim();
  if (text.length === 0) throw new Error("text is empty");
  if (text.length > spec.maxChars)
    throw new Error(`text is ${text.length} chars, over ${spec.maxChars} for ${current.platform}`);
  const title = change.title === undefined ? current.title : (change.title?.trim() ?? null);
  if (spec.title) {
    if (!title) throw new Error(`${current.platform} needs a title`);
    if (title.length > spec.title.maxChars)
      throw new Error(`title is ${title.length} chars, over ${spec.title.maxChars}`);
  }
  const [row] = await db
    .update(contentDrafts)
    .set({ text, title, edited: true, status: "draft", scheduledFor: null, error: null })
    .where(eq(contentDrafts.id, id))
    .returning();
  if (!row) throw new Error(`no draft ${id}`);
  return row;
}

/** Drafts of one idea in platform order, for a side-by-side read. */
export function draftsOfIdea(db: Queryable, ideaId: string): Promise<ContentDraft[]> {
  return db
    .select()
    .from(contentDrafts)
    .where(eq(contentDrafts.ideaId, ideaId))
    .orderBy(asc(contentDrafts.platform), desc(contentDrafts.createdAt));
}
