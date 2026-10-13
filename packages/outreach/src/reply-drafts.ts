/** Reply boxes when he writes replies himself (`drafts.replies` = you). */
import type { Queryable } from "@wren/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { comments, reachContacts, reachPosts, redditThreads } from "./schema.js";

/**
 * Empty every open reply box: queued threads and posts, comments waiting on him, DM drafts. The
 * words stay in the draft ledger (`generated` events); the rows stay. Answers the count per kind.
 */
export async function clearReplyDrafts(db: Queryable) {
  const t = await db
    .update(redditThreads)
    .set({ draft: null })
    .where(and(eq(redditThreads.state, "queued"), sql`${redditThreads.draft} is not null`))
    .returning({ id: redditThreads.id });
  const p = await db
    .update(reachPosts)
    .set({ draft: null })
    .where(and(eq(reachPosts.state, "queued"), sql`${reachPosts.draft} is not null`))
    .returning({ id: reachPosts.id });
  const c = await db
    .update(comments)
    .set({ draft: null })
    .where(and(inArray(comments.state, ["new", "waiting"]), sql`${comments.draft} is not null`))
    .returning({ id: comments.id });
  const d = await db
    .update(reachContacts)
    .set({ draft: null })
    .where(sql`${reachContacts.draft} is not null`)
    .returning({ id: reachContacts.id });
  return { threads: t.length, posts: p.length, comments: c.length, dms: d.length };
}
