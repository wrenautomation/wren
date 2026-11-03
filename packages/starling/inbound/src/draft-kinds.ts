/**
 * Inbound's draft kind for the draft desk (`@wren/starling-acts` DraftKind): a post of ours
 * (`content_drafts.text`), with its idea and its platform's playbook beside it. The whole desk's
 * kinds (`{...reachDraftKinds(guides), ...contentDraftKinds}`) are each app's to compose.
 */
import { UUID } from "@wren/core/ids";
import { type DraftKinds, factsBlock, siteName } from "@wren/starling-acts";
import {
  isThread,
  THREAD_BREAK,
  THREAD_MAX,
  THREAD_MIN,
  X_POST_MAX,
} from "@wren/starling-core/thread";
import { desc, eq, inArray } from "drizzle-orm";
import { PLATFORM_SPECS } from "./platforms.js";
import { playbookFor } from "./playbook.js";
import { draftVersion, editDraft } from "./review.js";
import { contentDrafts, contentIdeas } from "./schema.js";

const POST_OPEN = ["draft", "failed", "approved"];

export const contentDraftKinds: DraftKinds = {
  draft: {
    type: "post",
    edits: ["draft"],
    version: draftVersion,
    read: async (db, id) => {
      if (!UUID.test(id)) return null;
      const [d] = await db
        .select({
          platform: contentDrafts.platform,
          text: contentDrafts.text,
          title: contentDrafts.title,
          status: contentDrafts.status,
          extra: contentDrafts.extra,
          idea: contentIdeas.text,
        })
        .from(contentDrafts)
        .innerJoin(contentIdeas, eq(contentIdeas.id, contentDrafts.ideaId))
        .where(eq(contentDrafts.id, id));
      if (!d) return null;
      const spec = PLATFORM_SPECS[d.platform];
      // A thread is one text: its posts split by a line of ---, each checked by `editDraft`.
      const thread = isThread(d);
      return {
        what: thread
          ? `thread on X of ${THREAD_MIN} to ${THREAD_MAX} posts. Put a line holding only --- between posts. Each post is at most ${X_POST_MAX} characters, the last one with room for a link added after it. No link in the first post. The whole thread`
          : `${siteName(d.platform)} post`,
        platform: d.platform,
        title: d.title ?? d.idea.slice(0, 80),
        draft: d.text,
        max: thread ? THREAD_MAX * (X_POST_MAX + THREAD_BREAK.length) : spec.maxChars,
        open: POST_OPEN.includes(d.status),
        context: factsBlock([
          ["The idea it was drafted from", d.idea],
          ["Its title (unchanged by a rewrite)", d.title],
        ]),
        guide: (await playbookFor(db, d.platform))?.text ?? "",
      };
    },
    write: async (db, id, text) => {
      if (text === null) throw new Error("The post can't be empty. Type it in, or Reject it.");
      await editDraft(db, id, { text });
    },
    waiting: async (db, limit) =>
      (
        await db
          .select({
            id: contentDrafts.id,
            platform: contentDrafts.platform,
            title: contentDrafts.title,
            text: contentDrafts.text,
            at: contentDrafts.createdAt,
          })
          .from(contentDrafts)
          .where(inArray(contentDrafts.status, ["draft", "failed"]))
          .orderBy(desc(contentDrafts.createdAt))
          .limit(limit)
      ).map((d) => ({
        item: `draft:${d.id}`,
        type: "post" as const,
        title: `${siteName(d.platform)}: ${d.title ?? d.text.slice(0, 60)}`,
        draft: d.text,
        at: d.at,
      })),
  },
};
