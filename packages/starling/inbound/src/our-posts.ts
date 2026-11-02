/** Our posts for comment drafts (`@wren/core/our-posts`): published or approved, newest first. */
import type { OurPost } from "@wren/core/our-posts";
import type { Queryable } from "@wren/db";
import { desc, inArray, sql } from "drizzle-orm";
import { contentDrafts } from "./schema.js";

const KEPT = 40;

/** The newest distinct texts we published or approved, one per text across platforms. */
export async function ourPosts(db: Queryable): Promise<OurPost[]> {
  const rows = await db
    .select({ platform: contentDrafts.platform, text: contentDrafts.text })
    .from(contentDrafts)
    .where(inArray(contentDrafts.status, ["published", "approved", "publishing"]))
    .orderBy(desc(sql`coalesce(${contentDrafts.publishedAt}, ${contentDrafts.createdAt})`))
    .limit(KEPT * 2);
  const seen = new Set<string>();
  const out: OurPost[] = [];
  for (const r of rows) {
    const key = r.text.replace(/\s+/g, " ").trim().slice(0, 200).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ platform: r.platform, text: r.text });
    if (out.length === KEPT) break;
  }
  return out;
}
