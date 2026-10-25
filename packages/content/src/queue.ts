/**
 * The publish queue as rows: approved drafts whose time has come. `claim`
 * moves one to `publishing` in the same statement that selects it, so two
 * passes never publish the same draft; the scheduler is single-writer anyway.
 */
import type { Published } from "@wren/core/content";
import { recordDraft } from "@wren/core/draft-record";
import { resolveObjectOrNull } from "@wren/core/objects";
import { atomic, type Queryable } from "@wren/db";
import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { keepFirstVariants } from "./analytics/variants.js";
import { MAY_HAVE_GONE_OUT } from "./platforms.js";
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
  /** Who records it: the scheduler, or a person whose word on an unsure post found it. */
  by = "scheduler",
): Promise<void> {
  await stamp(db, id, {
    at: new Date(published.publishedAt),
    publishedId: published.id,
    url: published.url,
    notes: published.notes ?? [],
    // What the platform refused after the post went up, where he sees it.
    error: published.notes?.length ? published.notes.join("; ").slice(0, 10_000) : null,
    link: link ?? null,
    via: by === "scheduler" ? "wren" : "person",
    by,
  });
}

/**
 * Published on a person's word (designs/2026-10-16-maybe-sent.md): he saw it on the site and no
 * read found it, so it has no platform id and its numbers are not read until one is set.
 */
export async function markPostedBy(
  db: Queryable,
  id: string,
  o: { by: string; at: Date },
): Promise<void> {
  await stamp(db, id, {
    at: o.at,
    publishedId: null,
    url: null,
    notes: [],
    error: `Marked posted by ${o.by}. It has no platform id, so its numbers are not read.`,
    link: null,
    via: "person",
    by: o.by,
  });
}

/** The row stamped published, its first variants kept, its words frozen in the draft record. */
async function stamp(
  db: Queryable,
  id: string,
  p: {
    at: Date;
    publishedId: string | null;
    url: string | null;
    notes: readonly string[];
    error: string | null;
    link: string | null;
    via: "wren" | "person";
    by: string;
  },
): Promise<void> {
  await atomic(db, async (tx) => {
    const [row] = await tx
      .select({ platform: contentDrafts.platform })
      .from(contentDrafts)
      .where(eq(contentDrafts.id, id));
    if (!row) return;
    // The platform's post id is a `platform_objects` row first, in its one spelling. A draft that
    // went out stays published when no rule reads its id: it has none, like a person's word.
    const publishedId = p.publishedId
      ? await resolveObjectOrNull(tx, {
          platform: row.platform,
          kind: "post",
          raw: p.publishedId,
          url: p.url,
          at: p.at,
        })
      : null;
    const unread = `The platform's id "${(p.publishedId ?? "").slice(0, 80)}" is not one we read, so its numbers are not read.`;
    const error =
      p.publishedId && !publishedId
        ? [p.error, unread].filter(Boolean).join("; ").slice(0, 10_000)
        : p.error;
    const [d] = await tx
      .update(contentDrafts)
      .set({
        status: "published",
        publishedAt: p.at,
        publishedId,
        url: p.url,
        error,
      })
      .where(eq(contentDrafts.id, id))
      .returning();
    if (!d) return;
    // Its title, thumbnail and hook as they went out: the first window of each.
    await keepFirstVariants(tx, d, p.at, p.notes);
    // The words as they went out, frozen with the platform's id.
    await recordDraft(tx, {
      item: `draft:${id}`,
      platform: d.platform,
      event: "sent",
      via: p.via,
      by: p.by,
      text: d.text,
      title: d.title,
      externalId: publishedId ?? p.publishedId,
      url: p.url,
      // The fields as they went out, and any the platform refused after.
      meta: {
        fields: d.extra,
        ...(p.link ? { link: p.link } : {}),
        ...(p.notes.length ? { notes: p.notes } : {}),
      },
      // A journaled step that runs again keeps one.
      ref: `sent:draft:${id}`,
    });
  });
}

/** A note on a published draft (its error line, where he sees it), after what's there. */
export async function noteOnDraft(db: Queryable, id: string, note: string): Promise<void> {
  await db
    .update(contentDrafts)
    .set({
      error: sql`left(concat_ws('; ', ${contentDrafts.error}, ${note.slice(0, 5000)}::text), 10000)`,
    })
    .where(eq(contentDrafts.id, id));
}

/** Starts a draft's error while the desk's browser is busy: it stays approved and goes next pass. */
const WAITING_FOR_BROWSER = "Waiting for the browser";

/**
 * publishing → approved: the desk's browser profile was busy and nothing was sent. Its slot
 * stays; the next pass takes it. The error line says why, until a claim clears it.
 */
export async function markWaiting(db: Queryable, id: string, why: string): Promise<void> {
  await db
    .update(contentDrafts)
    .set({ status: "approved", error: `${WAITING_FOR_BROWSER}: ${why}`.slice(0, 10_000) })
    .where(and(eq(contentDrafts.id, id), eq(contentDrafts.status, "publishing")));
}

/**
 * A used daily cap (a 429 that waits hours): back to approved, its slot moved to when the cap
 * resets. Nothing was sent, so it is not a failure.
 */
export async function markCapped(
  db: Queryable,
  id: string,
  until: Date,
  why: string,
): Promise<void> {
  await db
    .update(contentDrafts)
    .set({
      status: "approved",
      scheduledFor: until,
      error: `Waiting out the daily cap until ${until.toISOString()}: ${why}`.slice(0, 10_000),
    })
    .where(and(eq(contentDrafts.id, id), eq(contentDrafts.status, "publishing")));
}

/** A draft held by a busy browser, by its row. */
export const waitingForBrowser = (d: { status: string; error: string | null }): boolean =>
  d.status === "approved" && !!d.error?.startsWith(WAITING_FOR_BROWSER);

export async function markFailed(db: Queryable, id: string, error: string): Promise<void> {
  const [d] = await db
    .update(contentDrafts)
    .set({ status: "failed", error: error.slice(0, 10_000) })
    .where(eq(contentDrafts.id, id))
    .returning({ platform: contentDrafts.platform });
  if (d)
    await recordDraft(db, {
      item: `draft:${id}`,
      platform: d.platform,
      event: "failed",
      via: "wren",
      by: "scheduler",
      note: error.slice(0, 10_000),
    });
}

/**
 * A publish that may have gone out and no read could tell: the draft stays `publishing`, so no
 * pass claims it, and its line says why. Its ledger row (`draft:<id>`) waits in To approve.
 */
export async function markUnsure(db: Queryable, id: string, why: string): Promise<void> {
  await db
    .update(contentDrafts)
    .set({ error: `${MAY_HAVE_GONE_OUT}: ${why}. It waits in To approve.`.slice(0, 10_000) })
    .where(and(eq(contentDrafts.id, id), eq(contentDrafts.status, "publishing")));
}

/**
 * publishing → approved on a person's Send again, after a look did not find it: the next pass
 * posts it. Null when the draft is no longer waiting on that word.
 */
export async function sendAgain(db: Queryable, id: string): Promise<ContentDraft | null> {
  const [row] = await db
    .update(contentDrafts)
    .set({ status: "approved", error: null })
    .where(and(eq(contentDrafts.id, id), eq(contentDrafts.status, "publishing")))
    .returning();
  return row ?? null;
}

/**
 * publishing → rejected on a person's "Not sent, drop": it did not go out and stays out, as if
 * he had rejected it. Its slot goes. Null when the draft is no longer waiting on that word.
 */
export async function dropDraft(
  db: Queryable,
  id: string,
  by: string,
): Promise<ContentDraft | null> {
  const [row] = await db
    .update(contentDrafts)
    .set({ status: "rejected", scheduledFor: null, error: null })
    .where(and(eq(contentDrafts.id, id), eq(contentDrafts.status, "publishing")))
    .returning();
  if (row)
    await recordDraft(db, {
      item: `draft:${id}`,
      platform: row.platform,
      event: "rejected",
      via: "person",
      by,
      text: row.text,
      note: "Dropped in To approve: it was not sent",
    });
  return row ?? null;
}
