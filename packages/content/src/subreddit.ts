/**
 * Where a Reddit draft posts when nobody named a subreddit (designs/2026-10-14-saving-and-ui-audit.md):
 * the watched places that take posts, best fit first, less any whose gate holds every account
 * (designs/2026-10-14-reddit-gates.md). A draft gets the first when it is made, redrafted or
 * approved without one; the panel offers the rest. Reads only.
 */

import type { Queryable } from "@wren/db";
import { gatesFor } from "@wren/outreach";
import { sql } from "drizzle-orm";

/** A watched subreddit a post may go to, as research judged it. */
export interface PostPlace {
  /** `reddit_places.subreddit`, its key. */
  subreddit: string;
  /** As the post's field takes it, without `r/`. */
  name: string;
  rules: string;
  /** False where the sub takes no links in a post. */
  links: boolean;
}

/** Every watched place that takes posts and lets an account through, best fit first. */
export async function postPlaces(db: Queryable, now: Date, limit = 12): Promise<PostPlace[]> {
  const rows = await db.execute<{
    subreddit: string;
    name: string;
    rules: string | null;
    links: boolean;
  }>(
    sql`select subreddit, name, judged->>'rules' rules,
          coalesce(not (judged->>'linkOnly')::boolean, false) links
        from reddit_places
        where state = 'watching' and coalesce((judged->>'mayPost')::boolean, false)
        order by fit desc nulls last, subscribers desc nulls last
        limit ${limit}`,
  );
  if (!rows.length) return [];
  const gates = await gatesFor(
    db,
    rows.map((r) => r.subreddit),
    now,
  );
  return rows
    .filter((r) => gates.get(r.subreddit)?.ok !== false)
    .map((r) => ({
      subreddit: r.subreddit,
      name: r.name.replace(/^r\//i, ""),
      rules: r.rules ?? "",
      links: r.links,
    }));
}

/** The best one, or null when no watched place takes posts. */
export async function postPlace(db: Queryable, now: Date): Promise<PostPlace | null> {
  return (await postPlaces(db, now))[0] ?? null;
}

/**
 * A Reddit draft's `extra` with a subreddit: the one it has, else the best watched place. Any
 * other platform's comes back as is.
 */
export async function withSubreddit(
  db: Queryable,
  platform: string,
  extra: Record<string, unknown> | null | undefined,
  now: Date,
): Promise<Record<string, unknown>> {
  const base = extra ?? {};
  if (platform !== "reddit") return base;
  if (typeof base.subreddit === "string" && base.subreddit.trim()) return base;
  const place = await postPlace(db, now);
  return place ? { ...base, subreddit: place.name } : base;
}
