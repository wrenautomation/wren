/** Posts in the person's own words, stored: an idea and a draft per platform (`./write.ts`). */
import { randomBytes } from "node:crypto";
import type { Media, Platform } from "@wren/core/content";
import { missingFields } from "@wren/core/content/shapes";
import { isCarousel } from "@wren/core/content/slides";
import { recordDraft } from "@wren/core/draft-record";
import type { Queryable } from "@wren/db";
import { desc, eq, inArray } from "drizzle-orm";
import type { DraftResult } from "./draft.js";
import { addIdea } from "./ideas.js";
import { PLATFORM_SPECS } from "./platforms.js";
import { type ContentIdea, contentDrafts, contentIdeas, type IdeaSource } from "./schema.js";
import { withSubreddit } from "./subreddit.js";
import { OWN_WORDS, ownDraftOf, ownThreadOf } from "./write.js";

export { splitPosts } from "./write.js";

/** What a post can be written about: a long video (designs/2026-10-14-content-types.md). */
export const FROM = /^video:\d+$/;

/**
 * A new idea's ref under what it's about: `video:<id>/post:<8 chars>`, unique per post, so Pieces
 * nests it under the video. Null without a `from`; a `from` that isn't a video is refused.
 */
export function refFrom(from: string | null | undefined): string | null {
  if (!from) return null;
  if (!FROM.test(from)) throw new Error(`can't write about ${from}: a video:<id> only`);
  return `${from}/post:${randomBytes(4).toString("hex")}`;
}

/** An idea and a draft per platform that takes the words; the rest say why not. */
export async function writeOwn(
  db: Queryable,
  o: {
    text: string;
    title?: string | null;
    platforms: readonly Platform[];
    by: string | null;
    source?: IdeaSource;
    /** What it's about (`video:<id>`): the idea's ref hangs it there. */
    from?: string | null;
    /** The file a platform that needs one posts (TikTok's video): on the idea and each draft. */
    media?: Media | null;
    /** A time to post: approving keeps it while it is ahead and free (else the next slot). */
    at?: Date | null;
    /** The words are one X thread, its posts split by `---`: only X takes it. */
    thread?: boolean;
  },
): Promise<{ idea: ContentIdea; results: DraftResult[] }> {
  const idea = await addIdea(db, o.text, o.source ?? "cli", o.media ?? null, refFrom(o.from));
  const results: DraftResult[] = [];
  for (const platform of o.platforms) {
    const v = o.thread
      ? platform === "x"
        ? ownThreadOf(o.text)
        : { reason: "a thread posts only on X" }
      : ownDraftOf(platform, o.text, o.title, o.media);
    if ("reason" in v) {
      results.push({ platform, ok: false, reason: v.reason });
      continue;
    }
    const [draft] = await db
      .insert(contentDrafts)
      .values({
        ideaId: idea.id,
        platform,
        text: v.text,
        title: v.title,
        ...(o.at ? { scheduledFor: o.at } : {}),
        ...(PLATFORM_SPECS[platform].needsMedia && o.media ? { media: o.media } : {}),
        ...(v.extra || platform === "reddit"
          ? { extra: await withSubreddit(db, platform, v.extra, new Date()) }
          : {}),
        promptVersion: OWN_WORDS,
      })
      .returning();
    if (!draft) throw new Error("insert returned no row");
    await recordDraft(db, {
      item: `draft:${draft.id}`,
      kind: "post",
      platform,
      event: "edited",
      via: "person",
      by: o.by,
      text: draft.text,
      title: draft.title,
    });
    results.push({ platform, ok: true, draft });
  }
  if (results.some((r) => r.ok))
    await db.update(contentIdeas).set({ status: "drafted" }).where(eq(contentIdeas.id, idea.id));
  return { idea, results };
}

/** One idea's waiting drafts, side by side: Write's board. */
export interface WaitingIdea {
  ideaId: string;
  idea: string;
  drafts: {
    id: string;
    platform: Platform;
    text: string;
    title: string | null;
    state: string;
    error: string | null;
    edited: boolean;
    own: boolean;
    /** A story: media only, no words to edit. */
    story: boolean;
    /** A carousel: its slides edit on the draft's page. */
    carousel: boolean;
    /** An X thread: its posts split on lines of `---`. */
    thread: boolean;
    /** The required fields still unset, by label: Approve refuses until each is set. */
    missing: string[];
  }[];
}

/** The drafts that wait on a yes, newest idea first, grouped by idea. */
export async function waitingIdeas(db: Queryable, limit = 120): Promise<WaitingIdea[]> {
  const rows = await db
    .select({ d: contentDrafts, idea: contentIdeas.text })
    .from(contentDrafts)
    .innerJoin(contentIdeas, eq(contentIdeas.id, contentDrafts.ideaId))
    .where(inArray(contentDrafts.status, ["draft", "failed"]))
    .orderBy(desc(contentDrafts.createdAt))
    .limit(limit);
  const out = new Map<string, WaitingIdea>();
  for (const { d, idea } of rows) {
    const at = out.get(d.ideaId) ?? { ideaId: d.ideaId, idea, drafts: [] };
    at.drafts.push({
      id: d.id,
      platform: d.platform,
      text: d.text,
      title: d.title,
      state: d.status,
      error: d.error,
      edited: d.edited,
      own: d.promptVersion === OWN_WORDS,
      story: d.extra?.kind === "story",
      carousel: isCarousel(d),
      thread: d.extra?.kind === "thread",
      missing: missingFields(d.platform, d.extra, d.title),
    });
    out.set(d.ideaId, at);
  }
  return [...out.values()];
}
