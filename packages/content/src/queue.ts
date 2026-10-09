/**
 * The publish queue as rows: approved drafts whose time has come. `claim`
 * moves one to `publishing` in the same statement that selects it, so two
 * passes never publish the same draft; the scheduler is single-writer anyway.
 */
import type { Published } from "@wren/core/content";
import { recordDraft } from "@wren/core/draft-record";
import type { Queryable } from "@wren/db";
import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { keepFirstVariants } from "./analytics/variants.js";
import { type ContentDraft, contentDrafts } from "./schema.js";

const dueAt = (now: Date) =>
  and(
    eq(contentDrafts.status, "approved"),
    or(isNull(contentDrafts.scheduledFor), lte(contentDrafts.scheduledFor, now)),
  );

/** Approved drafts due by `now`, oldest approval first. */
export function dueDrafts(db: Queryable, now: Date, limit = 20): Promise<ContentDraft[]> {
  return db
    .select()
    .from(contentDrafts)
    .where(dueAt(now))
    .orderBy(asc(contentDrafts.approvedAt), asc(contentDrafts.createdAt))
    .limit(limit);
}

/** When the next approved draft is due after `now` (ISO), or null when none is scheduled. Journal-safe: a string. */
export async function nextDue(db: Queryable, now: Date): Promise<string | null> {
  const [row] = await db
    .select({ at: sql<string | null>`min(${contentDrafts.scheduledFor})` })
    .from(contentDrafts)
    .where(and(eq(contentDrafts.status, "approved"), gt(contentDrafts.scheduledFor, now)));
  return row?.at ? new Date(row.at).toISOString() : null;
}

/** approved → publishing; null when someone else got there first or it was rejected meanwhile. */
export async function claim(db: Queryable, id: string): Promise<ContentDraft | null> {
  const [row] = await db
    .update(contentDrafts)
    .set({ status: "publishing", error: null })
    .where(and(eq(contentDrafts.id, id), eq(contentDrafts.status, "approved")))
    .returning();
  return row ?? null;
}

export async function markPublished(
  db: Queryable,
  id: string,
  published: Published,
  /** The funnel link appended to the text, for the record. */
  link?: string | null,
): Promise<void> {
  const [d] = await db
    .update(contentDrafts)
    .set({
      status: "published",
      publishedAt: new Date(published.publishedAt),
      publishedId: published.id,
      url: published.url,
      // What the platform refused after the post went up, where he sees it.
      error: published.notes?.length ? published.notes.join("; ").slice(0, 1000) : null,
    })
    .where(eq(contentDrafts.id, id))
    .returning();
  if (!d) return;
  // Its title, thumbnail and hook as they went out: the first window of each.
  await keepFirstVariants(db, d, new Date(published.publishedAt), published.notes ?? []);
  // The words as they went out, frozen with the platform's id.
  await recordDraft(db, {
    item: `draft:${id}`,
    platform: d.platform,
    event: "sent",
    via: "wren",
    by: "scheduler",
    text: d.text,
    title: d.title,
    externalId: published.id,
    url: published.url,
    // The fields as they went out, and any the platform refused after.
    meta: {
      fields: d.extra,
      ...(link ? { link } : {}),
      ...(published.notes?.length ? { notes: published.notes } : {}),
    },
    // A journaled step that runs again keeps one.
    ref: `sent:draft:${id}`,
  });
}

export async function markFailed(db: Queryable, id: string, error: string): Promise<void> {
  const [d] = await db
    .update(contentDrafts)
    .set({ status: "failed", error: error.slice(0, 1000) })
    .where(eq(contentDrafts.id, id))
    .returning({ platform: contentDrafts.platform });
  if (d)
    await recordDraft(db, {
      item: `draft:${id}`,
      platform: d.platform,
      event: "failed",
      via: "wren",
      by: "scheduler",
      note: error.slice(0, 1000),
    });
}
