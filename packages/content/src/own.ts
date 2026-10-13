/** Posts in the person's own words, stored: an idea and a draft per platform (`./write.ts`). */
import type { Platform } from "@wren/core/content";
import { recordDraft } from "@wren/core/draft-record";
import type { Queryable } from "@wren/db";
import { desc, eq, inArray } from "drizzle-orm";
import type { DraftResult } from "./draft.js";
import { addIdea } from "./ideas.js";
import { type ContentIdea, contentDrafts, contentIdeas, type IdeaSource } from "./schema.js";
import { OWN_WORDS, ownDraftOf } from "./write.js";

export { splitPosts } from "./write.js";

/** An idea and a draft per platform that takes the words; the rest say why not. */
export async function writeOwn(
  db: Queryable,
  o: {
    text: string;
    title?: string | null;
    platforms: readonly Platform[];
    by: string | null;
    source?: IdeaSource;
  },
): Promise<{ idea: ContentIdea; results: DraftResult[] }> {
  const idea = await addIdea(db, o.text, o.source ?? "cli");
  const results: DraftResult[] = [];
  for (const platform of o.platforms) {
    const v = ownDraftOf(platform, o.text, o.title);
    if ("reason" in v) {
      results.push({ platform, ok: false, reason: v.reason });
      continue;
    }
    const [draft] = await db
      .insert(contentDrafts)
      .values({ ideaId: idea.id, platform, text: v.text, title: v.title, promptVersion: OWN_WORDS })
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
    });
    out.set(d.ideaId, at);
  }
  return [...out.values()];
}
