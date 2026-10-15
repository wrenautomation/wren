/**
 * The review seat: a person reads drafts and approves, rejects or edits them.
 * Nothing here publishes. An edit puts an approved draft back to `draft` so
 * what goes out is always something a person approved as written.
 */
import { createHash } from "node:crypto";
import { CHECKED, mayHavePosted, type Platform } from "@wren/core/content";
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
import { PortalRefusal } from "@wren/core/refusal";
import type { Queryable } from "@wren/db";
import { and, asc, desc, eq, gte, inArray, type SQL } from "drizzle-orm";
import { postedLink, refuseUnlinked } from "./funnel.js";
import { aboutDraft, GONE, lockedWhy, named, PLATFORM_SPECS, wordsUnfit } from "./platforms.js";
import { type ContentDraft, contentDrafts, type DraftStatus } from "./schema.js";
import { nextSlot, type Slots } from "./slots.js";
import { withSubreddit } from "./subreddit.js";

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
  if (!row) throw new Error(GONE);
  return row;
}

/** Statuses a person may move from. `failed` re-arms a publish that broke. */
const APPROVABLE: readonly DraftStatus[] = ["draft", "failed"];
const REJECTABLE: readonly DraftStatus[] = ["draft", "approved", "failed"];
const EDITABLE: readonly DraftStatus[] = ["draft", "approved", "failed"];

/**
 * Move each draft from one of `from` to `set`. One already where it's going (a second click on
 * Approve, Reject in two tabs) is left as it is, not refused; one past it is refused by name.
 */
async function moveAll(
  db: Queryable,
  ids: readonly string[],
  from: readonly DraftStatus[],
  set: Partial<typeof contentDrafts.$inferInsert>,
  doing: string,
): Promise<ContentDraft[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .update(contentDrafts)
    .set(set)
    .where(and(inArray(contentDrafts.id, [...ids]), inArray(contentDrafts.status, [...from])))
    .returning();
  const moved = new Set(rows.map((r) => r.id));
  const missed = ids.filter((id) => !moved.has(id));
  if (missed.length === 0) return rows;
  const left = await db.select().from(contentDrafts).where(inArray(contentDrafts.id, missed));
  const why = missed.flatMap((id) => {
    const r = left.find((x) => x.id === id);
    if (!r) return [GONE];
    return r.status === set.status ? [] : [lockedWhy(r, doing)];
  });
  if (why.length > 0) throw new Error([...new Set(why)].join(" "));
  return rows;
}

/**
 * A draft's version: its words, hashed (`left(md5(text), 12)` in `marketing_draft_records`). A
 * yes names the one on screen, so words Claude or someone else wrote since are never approved
 * unread.
 */
export const draftVersion = (text: string): string =>
  createHash("md5").update(text).digest("hex").slice(0, 12);

/** The one draft's words moved since the page drew `expect`: a coded conflict, named. */
async function refuseMoved(db: Queryable, ids: readonly string[], expect?: string | null) {
  const [id] = ids;
  if (!expect || ids.length !== 1 || id === undefined) return;
  const [r] = await db.select().from(contentDrafts).where(eq(contentDrafts.id, id)).limit(1);
  if (!r || draftVersion(r.text) === expect) return;
  throw new PortalRefusal(
    `${named(r)} changed since you opened it. Read it again, then approve.`,
    409,
    undefined,
    "conflict",
  );
}

/**
 * Approve. `at` schedules; `now: true` posts on the next pass; otherwise each
 * draft takes its platform's next free slot on `zone`'s clock: the planner's
 * (`slots`), else the defaults. `expect`, for one draft: the version the person saw.
 */
export async function approveDrafts(
  db: Queryable,
  ids: readonly string[],
  o: {
    now: Date;
    at?: Date | null;
    zone?: string;
    asap?: boolean;
    slots?: Slots;
    by?: string;
    expect?: string | null;
  },
): Promise<ContentDraft[]> {
  await refuseMoved(db, ids, o.expect);
  await refuseUnsure(db, ids);
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

/**
 * A failed post that may be live anyway is never sent again on the first yes: the first Approve
 * says to check the platform and marks it checked; the next Approve sends it.
 */
async function refuseUnsure(db: Queryable, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const failed = await db
    .select({ id: contentDrafts.id, platform: contentDrafts.platform, error: contentDrafts.error })
    .from(contentDrafts)
    .where(and(inArray(contentDrafts.id, [...ids]), eq(contentDrafts.status, "failed")));
  const unsure = failed.filter((r) => mayHavePosted(r.error));
  if (unsure.length === 0) return;
  for (const r of unsure)
    await db
      .update(contentDrafts)
      .set({ error: `${CHECKED}${r.error}` })
      .where(and(eq(contentDrafts.id, r.id), eq(contentDrafts.status, "failed")));
  const where = [...new Set(unsure.map((r) => r.platform))].join(", ");
  throw new PortalRefusal(
    `The last try may have posted on ${where}. Check there first. If it isn't up, approve again.`,
  );
}

async function approveAll(
  db: Queryable,
  asked: readonly string[],
  o: { now: Date; at?: Date | null; zone?: string; asap?: boolean; slots?: Slots },
): Promise<ContentDraft[]> {
  const base = { status: "approved" as const, approvedAt: o.now, error: null };
  await pickSubreddits(db, asked, o.now);
  const fanned = await splitSubreddits(db, asked);
  const ids = [...asked, ...fanned.flatMap((f) => f.copies)];
  await refuseIncomplete(db, ids);
  if (o.at || o.asap || !o.zone) {
    // A time he picks, or now, moves an approved one too: a queued post rescheduled.
    const rows = await moveAll(
      db,
      ids,
      o.at || o.asap ? [...APPROVABLE, "approved"] : APPROVABLE,
      { ...base, scheduledFor: o.at ?? null },
      "be approved",
    );
    // Each copy a gap after its original, so one account never posts them all at once.
    const start = o.at ?? o.now;
    for (const f of fanned)
      for (const [i, id] of f.copies.entries()) {
        const at = new Date(start.getTime() + (i + 1) * FAN_GAP_MS);
        await db.update(contentDrafts).set({ scheduledFor: at }).where(eq(contentDrafts.id, id));
        const r = rows.find((x) => x.id === id);
        if (r) r.scheduledFor = at;
      }
    return rows;
  }
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
    if (!draft) throw new Error(GONE);
    // Approved already (a second click): left on its slot.
    if (draft.status === "approved") continue;
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
    const moved = await moveAll(db, [id], APPROVABLE, { ...base, scheduledFor: at }, "be approved");
    for (const m of moved) if (m.scheduledFor) slots.push(m.scheduledFor);
    rows.push(...moved);
  }
  return rows;
}

/**
 * Every approved draft of `platform` again onto its slots from `now`, in the order they were
 * due: after the slots change, a long queue takes the new pace. A draft posting now keeps its
 * time. Each moved draft is a `scheduled` step in its record. Answers the moved drafts.
 */
export async function respreadApproved(
  db: Queryable,
  platform: Platform,
  o: { now: Date; zone: string; slots?: Slots; by?: string },
): Promise<ContentDraft[]> {
  const rows = await db
    .select()
    .from(contentDrafts)
    .where(and(eq(contentDrafts.platform, platform), eq(contentDrafts.status, "approved")))
    .orderBy(asc(contentDrafts.scheduledFor), asc(contentDrafts.createdAt));
  const taken = (
    await db
      .select({ at: contentDrafts.scheduledFor })
      .from(contentDrafts)
      .where(
        and(
          eq(contentDrafts.platform, platform),
          eq(contentDrafts.status, "publishing"),
          gte(contentDrafts.scheduledFor, o.now),
        ),
      )
  ).flatMap((r) => (r.at ? [r.at] : []));
  const moved: ContentDraft[] = [];
  for (const d of rows) {
    const at = nextSlot(platform, o.now, o.zone, o.slots, taken);
    taken.push(at);
    if (d.scheduledFor?.getTime() === at.getTime()) continue;
    const [m] = await db
      .update(contentDrafts)
      .set({ scheduledFor: at })
      .where(and(eq(contentDrafts.id, d.id), eq(contentDrafts.status, "approved")))
      .returning();
    if (!m) continue;
    await recordDraft(db, {
      item: `draft:${m.id}`,
      platform,
      event: "scheduled",
      via: "person",
      by: o.by ?? null,
      slot: at,
    });
    moved.push(m);
  }
  return moved;
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
/** A Reddit draft still without a subreddit takes the best watched place at its yes. */
async function pickSubreddits(db: Queryable, ids: readonly string[], now: Date): Promise<void> {
  const rows = await db
    .select()
    .from(contentDrafts)
    .where(
      and(
        inArray(contentDrafts.id, [...ids]),
        eq(contentDrafts.platform, "reddit"),
        inArray(contentDrafts.status, [...APPROVABLE]),
      ),
    );
  for (const r of rows) {
    const extra = await withSubreddit(db, r.platform, r.extra, now);
    if (extra !== r.extra)
      await db.update(contentDrafts).set({ extra }).where(eq(contentDrafts.id, r.id));
  }
}

/** Between one subreddit's copy of a post and the next: Reddit's own post cap is 3 a day. */
export const FAN_GAP_MS = 4 * 3_600_000;

/**
 * A Reddit draft's "Also post to" made real: one new draft per extra subreddit, same words and
 * idea, each with that one sub and an empty list, so each posts, shows and is checked on its own.
 * The original keeps its own sub. Answers the copies made, per original, in list order.
 */
export async function splitSubreddits(
  db: Queryable,
  ids: readonly string[],
): Promise<{ id: string; copies: string[] }[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(contentDrafts)
    .where(
      and(
        inArray(contentDrafts.id, [...ids]),
        eq(contentDrafts.platform, "reddit"),
        inArray(contentDrafts.status, [...APPROVABLE]),
      ),
    );
  const out: { id: string; copies: string[] }[] = [];
  for (const r of rows) {
    const extra = (r.extra ?? {}) as Record<string, unknown>;
    const own = String(extra.subreddit ?? "")
      .replace(/^r\//i, "")
      .toLowerCase();
    const also = (Array.isArray(extra.alsoTo) ? extra.alsoTo : [])
      .map((v) => String(v).trim().replace(/^r\//i, ""))
      .filter(
        (v, i, all) =>
          v &&
          v.toLowerCase() !== own &&
          all.findIndex((w) => w.toLowerCase() === v.toLowerCase()) === i,
      );
    const { alsoTo: _, ...kept } = extra;
    await db.update(contentDrafts).set({ extra: kept }).where(eq(contentDrafts.id, r.id));
    if (also.length === 0) continue;
    const { id: __, createdAt: ___, ...copy } = r;
    const made = await db
      .insert(contentDrafts)
      .values(
        also.map((sub) => ({
          ...copy,
          extra: { ...kept, subreddit: sub },
          status: "draft" as const,
          scheduledFor: null,
          approvedAt: null,
          publishedAt: null,
          publishedId: null,
          url: null,
          error: null,
          note: `Also to r/${sub}, from ${r.id}`,
        })),
      )
      .returning({ id: contentDrafts.id });
    out.push({ id: r.id, copies: made.map((m) => m.id) });
  }
  return out;
}

/** Why a Reddit post has nowhere to go: no watched place takes posts. */
export const NO_SUBREDDIT =
  "no subreddit we watch takes posts. Type one in its Subreddit field, or watch one under Places";

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
      return [`${named(r)}: ${shapeWhy(err)}; fix it in its fields`];
    }
    const unfit = isCarousel(r) ? carouselUnfit(r) : null;
    if (unfit) return [`${named(r)}: the carousel ${unfit}`];
    const clash = mediaUnfit(r.platform, r.extra, r.media);
    if (clash) return [`${named(r)}: ${clash}`];
    const missing = missingFields(r.platform, r.extra, r.title);
    if (r.platform === "reddit" && missing.includes("Subreddit"))
      return [`${named(r)}: ${NO_SUBREDDIT}`];
    return missing.length > 0
      ? [`${named(r)}: fill in ${missing.join(", ")} in its fields first`]
      : [];
  });
  // A thread is checked as it goes out: each post inside 280, the last one with its link.
  for (const r of rows.filter(isThread)) {
    const unfit = threadUnfit(threadPosts(r.text), await postedLink(db, r));
    if (unfit) lacking.push(`${named(r)}: ${unfit}`);
  }
  if (lacking.length > 0) throw new Error(`Can't approve yet. ${lacking.join(". ")}.`);
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
  if (!EDITABLE.includes(current.status)) throw new Error(lockedWhy(current, "be changed"));
  let next: ReturnType<typeof patchFields>;
  try {
    next = patchFields(current.platform, current.extra, patch);
  } catch (err) {
    throw new Error(aboutDraft(current, shapeWhy(err)));
  }
  const retitled = next.title !== undefined && next.title !== current.title;
  if (retitled && !next.title && PLATFORM_SPECS[current.platform].title)
    throw new Error(aboutDraft(current, "it needs a title. Type one in"));
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
  if (!row) throw new Error(GONE);
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

/** A shape's refusal without the platform's code in front ("reddit: Subreddit ..."). */
const shapeWhy = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^[a-z_]+: /, "");

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
    "be rejected",
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
  if (!EDITABLE.includes(current.status)) throw new Error(lockedWhy(current, "be edited"));
  const spec = PLATFORM_SPECS[current.platform];
  const text = change.text.trim();
  if (text.length === 0)
    throw new Error(aboutDraft(current, "the post can't be empty. Type it in"));
  const unfit = wordsUnfit(current, text);
  if (unfit) throw new Error(aboutDraft(current, unfit));
  const title = change.title === undefined ? current.title : (change.title?.trim() ?? null);
  if (spec.title) {
    if (!title) throw new Error(aboutDraft(current, "it needs a title. Type one in"));
    if (title.length > spec.title.maxChars)
      throw new Error(
        aboutDraft(
          current,
          `its title is ${title.length} characters, over the ${spec.title.maxChars} ${spec.name} takes`,
        ),
      );
  }
  const [row] = await db
    .update(contentDrafts)
    .set({ text, title, edited: true, status: "draft", error: null })
    .where(eq(contentDrafts.id, id))
    .returning();
  if (!row) throw new Error(GONE);
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
