/**
 * The review seat: a person reads drafts and approves, rejects or edits them.
 * Nothing here publishes. An edit puts an approved draft back to `draft` so
 * what goes out is always something a person approved as written.
 */
import type { Platform } from "@wren/core/content";
import {
  consented,
  fieldsOf,
  mediaUnfit,
  missingFields,
  patchFields,
} from "@wren/core/content/shapes";
import { carouselUnfit, isCarousel } from "@wren/core/content/slides";
import { isThread, threadPosts, threadUnfit } from "@wren/core/content/thread";
import { type DraftVia, type RejectReason, recordDraft } from "@wren/core/draft-record";
import type { Queryable } from "@wren/db";
import { and, asc, desc, eq, gte, inArray, type SQL } from "drizzle-orm";
import { postedLink, refuseUnlinked } from "./funnel.js";
import { PLATFORM_SPECS, wordsUnfit } from "./platforms.js";
import { type ContentDraft, contentDrafts, type DraftStatus } from "./schema.js";
import { nextSlot, type Slots } from "./slots.js";

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
 * draft takes its platform's next free slot on `zone`'s clock: the planner's
 * (`slots`), else the defaults.
 */
export async function approveDrafts(
  db: Queryable,
  ids: readonly string[],
  o: { now: Date; at?: Date | null; zone?: string; asap?: boolean; slots?: Slots; by?: string },
): Promise<ContentDraft[]> {
  const rows = await approveAll(db, ids, o);
  for (const r of rows)
    await recordDraft(db, {
      item: `draft:${r.id}`,
      platform: r.platform,
      event: "approved",
      via: "person",
      by: o.by ?? null,
      slot: r.scheduledFor,
    });
  return rows;
}

async function approveAll(
  db: Queryable,
  ids: readonly string[],
  o: { now: Date; at?: Date | null; zone?: string; asap?: boolean; slots?: Slots },
): Promise<ContentDraft[]> {
  const base = { status: "approved" as const, approvedAt: o.now, error: null };
  await refuseIncomplete(db, ids);
  if (o.at || o.asap || !o.zone)
    return moveAll(db, ids, APPROVABLE, { ...base, scheduledFor: o.at ?? null }, "approve");
  const zone = o.zone;
  // One read of the drafts and one of each platform's held slots; each
  // approval then holds its slot in memory for the next.
  const drafts = new Map(
    (
      await db
        .select()
        .from(contentDrafts)
        .where(inArray(contentDrafts.id, [...ids]))
    ).map((d) => [d.id, d]),
  );
  const held = new Map<Platform, Date[]>();
  const rows: ContentDraft[] = [];
  for (const id of ids) {
    const draft = drafts.get(id);
    if (!draft) throw new Error(`cannot approve ${id}: no such draft`);
    let slots = held.get(draft.platform);
    if (!slots) {
      slots = await heldSlots(db, draft.platform, o.now);
      held.set(draft.platform, slots);
    }
    // The planner's draft holds its slot: approving schedules it there while it is ahead and free.
    const own = draft.scheduledFor;
    const at =
      own && own > o.now && !slots.some((t) => t.getTime() === own.getTime())
        ? own
        : nextSlot(draft.platform, o.now, zone, o.slots, slots);
    const moved = await moveAll(db, [id], APPROVABLE, { ...base, scheduledFor: at }, "approve");
    for (const m of moved) if (m.scheduledFor) slots.push(m.scheduledFor);
    rows.push(...moved);
  }
  return rows;
}

/** Times already given to approved or publishing drafts on the platform, from `now` on. */
async function heldSlots(db: Queryable, platform: Platform, now: Date): Promise<Date[]> {
  const rows = await db
    .select({ at: contentDrafts.scheduledFor })
    .from(contentDrafts)
    .where(
      and(
        eq(contentDrafts.platform, platform),
        inArray(contentDrafts.status, ["approved", "publishing"]),
        gte(contentDrafts.scheduledFor, now),
      ),
    );
  return rows.flatMap((r) => (r.at ? [r.at] : []));
}

/**
 * A draft is approvable only with its shape whole: every required field set (Reddit's subreddit
 * and title) and every value one its platform takes (designs/2026-10-07-post-shapes.md). A post
 * whose link points at a video needs the video up first (designs/2026-10-07-content-funnel.md).
 */
async function refuseIncomplete(db: Queryable, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db
    .select()
    .from(contentDrafts)
    .where(inArray(contentDrafts.id, [...ids]));
  const lacking = rows.flatMap((r) => {
    try {
      fieldsOf(r.platform, r.extra);
    } catch (err) {
      return [`${r.id}: ${(err as Error).message}`];
    }
    const unfit = isCarousel(r) ? carouselUnfit(r) : null;
    if (unfit) return [`${r.id}: carousel: ${unfit}`];
    const clash = mediaUnfit(r.platform, r.extra, r.media);
    if (clash) return [`${r.id}: ${clash}`];
    const missing = missingFields(r.platform, r.extra, r.title);
    return missing.length > 0 ? [`${r.id} needs ${missing.join(", ")}`] : [];
  });
  // A thread is checked as it goes out: each post inside 280, the last one with its link.
  for (const r of rows.filter(isThread)) {
    const unfit = threadUnfit(threadPosts(r.text), await postedLink(db, r));
    if (unfit) lacking.push(`${r.id}: ${unfit}`);
  }
  if (lacking.length > 0) throw new Error(`cannot approve: ${lacking.join("; ")}`);
  await refuseUnlinked(db, rows);
}

/**
 * Set a draft's fields (its platform's shape; `null` or "" unsets one), checked whole before it
 * is written. A field leaves an approved draft approved: where and how it goes is not what it
 * says. The title is words: changing it puts the draft back to `draft`, like `editDraft`. Each
 * change is an `edited` step in the draft record, `meta.fields` holding before and after.
 */
export async function setFields(
  db: Queryable,
  id: string,
  patch: Readonly<Record<string, unknown>>,
  who?: { by: string; via?: DraftVia },
): Promise<ContentDraft> {
  const current = await getDraft(db, id);
  if (!EDITABLE.includes(current.status))
    throw new Error(`cannot change ${id}: it is ${current.status}`);
  const next = patchFields(current.platform, current.extra, patch);
  const retitled = next.title !== undefined && next.title !== current.title;
  if (retitled && !next.title && PLATFORM_SPECS[current.platform].title)
    throw new Error(`${current.platform} needs a title`);
  const changed = Object.keys(next.changed).length > 0;
  if (!retitled && !changed) return current;
  // The yes covers TikTok's settings: a change waits on another (designs/2026-10-07-client-social.md).
  const reask = retitled || (changed && consented(current.platform));
  const [row] = await db
    .update(contentDrafts)
    .set({
      extra: next.extra,
      ...(retitled ? { title: next.title ?? null, edited: true } : {}),
      ...(reask ? { status: "draft", error: null } : {}),
    })
    .where(eq(contentDrafts.id, id))
    .returning();
  if (!row) throw new Error(`no draft ${id}`);
  if (who)
    await recordDraft(db, {
      item: `draft:${id}`,
      platform: row.platform,
      event: "edited",
      via: who.via ?? "person",
      by: who.by,
      text: row.text,
      title: row.title,
      meta: {
        fields: {
          ...next.changed,
          ...(retitled ? { title: [current.title, row.title] } : {}),
        },
      },
    });
  return row;
}

/** No, with an optional quick pick and note for the draft record. */
export async function rejectDrafts(
  db: Queryable,
  ids: readonly string[],
  o: { by?: string; reason?: RejectReason | null; note?: string | null } = {},
): Promise<ContentDraft[]> {
  const rows = await moveAll(
    db,
    ids,
    REJECTABLE,
    { status: "rejected", scheduledFor: null },
    "reject",
  );
  for (const r of rows)
    await recordDraft(db, {
      item: `draft:${r.id}`,
      platform: r.platform,
      event: "rejected",
      via: "person",
      by: o.by ?? null,
      text: r.text,
      reason: o.reason ?? null,
      note: o.note ?? null,
    });
  return rows;
}

/**
 * Replace the text (and title); the draft goes back to `draft` for a fresh approval. It keeps
 * its `scheduled_for`: on a `draft` row that is only the slot it holds, used again on approve.
 */
export async function editDraft(
  db: Queryable,
  id: string,
  change: { text: string; title?: string | null },
  /** Who, for the draft record; left out when the caller keeps the step itself (`writeDraft`). */
  who?: { by: string; via?: DraftVia },
): Promise<ContentDraft> {
  const current = await getDraft(db, id);
  if (!EDITABLE.includes(current.status))
    throw new Error(`cannot edit ${id}: it is ${current.status}`);
  const spec = PLATFORM_SPECS[current.platform];
  const text = change.text.trim();
  if (text.length === 0) throw new Error("text is empty");
  const unfit = wordsUnfit(current, text);
  if (unfit) throw new Error(unfit);
  const title = change.title === undefined ? current.title : (change.title?.trim() ?? null);
  if (spec.title) {
    if (!title) throw new Error(`${current.platform} needs a title`);
    if (title.length > spec.title.maxChars)
      throw new Error(`title is ${title.length} chars, over ${spec.title.maxChars}`);
  }
  const [row] = await db
    .update(contentDrafts)
    .set({ text, title, edited: true, status: "draft", error: null })
    .where(eq(contentDrafts.id, id))
    .returning();
  if (!row) throw new Error(`no draft ${id}`);
  if (who)
    await recordDraft(db, {
      item: `draft:${id}`,
      platform: row.platform,
      event: "edited",
      via: who.via ?? "person",
      by: who.by,
      text: row.text,
      title: row.title,
    });
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
