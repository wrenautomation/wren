/**
 * Conversations' draft kind for the draft desk (`@wren/starling-acts` DraftKind): a comment's
 * answer (`comments.draft`). The comments SOP and the platform's cap are the composer's: the
 * playbooks live with the content channel.
 */
import type { Platform } from "@wren/core/autobrowse";
import type { Queryable } from "@wren/db";
import { type DraftKind, factsBlock, siteName } from "@wren/starling-acts";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { comments } from "./schema.js";

const COMMENT_OPEN = ["new", "waiting"] as const;

export interface CommentDraftDeps {
  /** The comments SOP for the platform; "" = none. */
  guide(db: Queryable, platform: Platform): Promise<string>;
  /** The longest comment the platform takes. */
  max(platform: string): number;
}

export function commentDraftKind(deps: CommentDraftDeps): DraftKind {
  return {
    type: "comment",
    edits: ["comment"],
    read: async (db, id) => {
      if (!/^\d+$/.test(id)) return null;
      const [c] = await db
        .select()
        .from(comments)
        .where(eq(comments.id, Number(id)));
      if (!c) return null;
      return {
        what: `${siteName(c.platform)} comment answer`,
        platform: c.platform,
        title: c.author,
        draft: c.draft,
        max: deps.max(c.platform),
        open: (COMMENT_OPEN as readonly string[]).includes(c.state),
        context: factsBlock([
          ["Where", c.place],
          ["Our post", c.postTitle],
          [`${c.author} wrote`, c.body],
          ["Read as", c.why ? `${c.sort}: ${c.why}` : c.sort],
        ]),
        about: `${c.postTitle ?? ""} ${c.body}`,
        guide: await deps.guide(db, c.platform as Platform),
      };
    },
    write: async (db, id, text) => {
      const done = await db
        .update(comments)
        .set({ draft: text })
        .where(and(eq(comments.id, Number(id)), inArray(comments.state, COMMENT_OPEN)))
        .returning({ id: comments.id });
      if (!done.length)
        throw new Error("That comment is answered or dropped already, so its answer can't change.");
    },
    waiting: async (db, limit) =>
      (
        await db
          .select()
          .from(comments)
          .where(and(inArray(comments.state, COMMENT_OPEN), isNotNull(comments.draft)))
          .orderBy(desc(comments.at))
          .limit(limit)
      ).map((c) => ({
        item: `comment:${c.id}`,
        type: "comment" as const,
        title: `${siteName(c.platform)}: ${c.author} on ${c.postTitle ?? c.place ?? "a post"}`,
        draft: c.draft,
        at: c.at,
      })),
  };
}
