/**
 * Touches from our own accounts' activity, and the whole backfill (designs/2026-10-07-touches.md).
 * A follow, subscribe, reaction or mention someone gave us is theirs; a notice is no one's.
 * `wren touches backfill` folds every source table in under the refs the live writers use.
 */
import type { FollowingRow, OwnCommentRow } from "@wren/core/content";
import { usableUrl } from "@wren/core/touch-link";
import {
  mergeHandle,
  normalizeHandle,
  recordTouch,
  relinkHandles,
  type TouchKind,
} from "@wren/core/touches";
import type { Queryable } from "@wren/db";
import { backfillOutreachTouches, type TouchBackfill } from "@wren/outreach/touches";
import { eq, ne, sql } from "drizzle-orm";
import { socialActivity } from "./schema.js";

/** The touches source of follows read off our account's follow list. */
export const FOLLOWING_SOURCE = "following";

const ACTIVITY_TOUCH: Record<string, TouchKind | undefined> = {
  follow: "follow",
  subscribe: "follow",
  reaction: "like",
  mention: "mention",
};

/** One kept activity row as their touch; a notice (no actor) is skipped. */
export async function touchFromActivity(db: Queryable, id: number) {
  const [a] = await db.select().from(socialActivity).where(eq(socialActivity.id, id));
  const kind = a ? ACTIVITY_TOUCH[a.kind] : undefined;
  if (!a || !kind || !(a.actorUrl || a.actor)) return null;
  return recordTouch(db, {
    platform: a.platform,
    handle: (a.actorUrl || a.actor) as string,
    name: a.actor,
    kind,
    direction: "theirs",
    account: "wren",
    url: a.url,
    // A mention's notice opens the mention; a like or follow has no page of its own.
    link: kind === "mention" ? usableUrl(a.url) : null,
    text: a.text,
    at: a.at,
    source: "social_activity",
    ref: `sa:${a.id}`,
  });
}

export interface FollowingKept {
  /** Follows the list had that wren did not: made by hand on the site. */
  added: number;
  /** Handles the list had before and has no more: unfollowed on the site. Nothing is deleted. */
  gone: number;
}

/**
 * Our account's follow list as ours follow touches (designs/2026-10-22-drift-reconcile.md), so a
 * follow made by hand on the site counts like one wren made. A handle with an ours follow from any
 * writer is left alone. A follow with no time from the platform takes `now`.
 */
export async function keepFollowing(
  db: Queryable,
  platform: string,
  rows: readonly FollowingRow[],
  now: Date,
): Promise<FollowingKept> {
  const listed = new Map<string, FollowingRow>();
  for (const r of rows) {
    const h = normalizeHandle(platform, r.handle);
    if (h && !listed.has(h.handle)) listed.set(h.handle, r);
  }
  const ours = (await db.execute(sql`
    SELECT h.handle, bool_or(t.source = ${FOLLOWING_SOURCE}) listed
    FROM touches t JOIN social_handles h ON h.id = t.handle_id
    WHERE h.platform = ${platform} AND t.kind = 'follow' AND t.direction = 'ours'
    GROUP BY 1`)) as unknown as Array<{ handle: string; listed: boolean }>;
  const known = new Set(ours.map((r) => r.handle));
  let added = 0;
  for (const [handle, r] of listed) {
    if (known.has(handle)) continue;
    const t = await recordTouch(db, {
      platform,
      handle,
      name: r.name,
      kind: "follow",
      direction: "ours",
      account: "wren",
      url: r.url,
      at: r.at ? new Date(r.at) : now,
      source: FOLLOWING_SOURCE,
      ref: `fo:${platform}:${handle}`,
    });
    if (t?.created) added++;
  }
  const gone = ours.filter((r) => r.listed && !listed.has(r.handle)).length;
  return { added, gone };
}

/** Where `keepOwnComments` touches come from: our comment lists, read back. */
export const OWN_COMMENTS_SOURCE = "own_comments";

/**
 * Our comments as the site lists them (designs/2026-10-22-drift-reconcile.md). One made by hand
 * becomes an ours `comment` (a `reply` when it answers a comment) toward whom it answers. One a
 * writer already kept stays as it is, and so does a thread's answer in a karma place (warmup, never
 * a touch) or an answer on our own post: each is matched by the comment's id.
 */
export async function keepOwnComments(
  db: Queryable,
  platform: string,
  rows: readonly OwnCommentRow[],
): Promise<number> {
  if (!rows.length) return 0;
  const ids = sql.join(
    rows.map((r) => sql`${r.id}`),
    sql`, `,
  );
  const kept = (await db.execute(sql`
    SELECT external_id id FROM touches WHERE direction = 'ours' AND external_id IN (${ids})
    UNION SELECT answer_ref FROM reddit_threads WHERE ${platform} = 'reddit' AND answer_ref IN (${ids})
    UNION SELECT answer_ref FROM comments WHERE platform = ${platform} AND answer_ref IN (${ids})`)) as unknown as Array<{
    id: string;
  }>;
  const known = new Set(kept.map((r) => r.id));
  let added = 0;
  for (const r of rows) {
    if (known.has(r.id) || !r.to) continue;
    const t = await recordTouch(db, {
      platform,
      handle: r.to.handle,
      name: r.to.name,
      kind: r.reply ? "reply" : "comment",
      direction: "ours",
      account: "wren",
      url: r.url,
      text: r.text,
      at: new Date(r.at),
      externalId: r.id,
      source: OWN_COMMENTS_SOURCE,
      ref: `oc:${platform}:${r.id}`,
    });
    if (t?.created) added++;
  }
  return added;
}

/** How far a notification's time may sit from the comment it names. */
const NOTICE_WINDOW = "2 days";

/**
 * LinkedIn names the author of a comment on our post only by a URN only our app can read. The
 * page's notification ("Jane commented on your post") names them by profile. A URN handle whose
 * comments each meet one such notice, by the comment's id in the notice's link or else alone on
 * that post within two days, and all of them the same profile, becomes that profile: its touches
 * move there. Two people on one post the same day stay unlinked.
 */
export async function linkCommentAuthors(db: Queryable): Promise<number> {
  const rows = (await db.execute(sql`
    WITH c AS (
      SELECT h.id handle_id, t.at,
        substring(t.external_id from ',([^,()]+)\\)$') cid,
        substring(t.external_id from '^urn:li:comment:\\(urn:li:[a-zA-Z]+:([0-9]+),') pid
      FROM social_handles h
      JOIN touches t ON t.handle_id = h.id AND t.direction = 'theirs'
      WHERE h.platform = 'linkedin' AND h.handle LIKE 'urn:li:person:%'
        AND t.external_id LIKE 'urn:li:comment:(%'
    ), m AS (
      SELECT c.handle_id, c.cid, a.actor, lower(a.actor_url) actor_url,
        bool_or(position(c.cid in coalesce(a.url, '') || a.raw::text) > 0) by_id
      FROM c JOIN social_activity a
        ON a.platform = 'linkedin' AND a.raw->>'kind' = 'comment'
        AND a.actor_url ~* 'linkedin\\.com/in/'
        AND (position(c.cid in coalesce(a.url, '') || a.raw::text) > 0
          OR (position(c.pid in coalesce(a.url, '') || a.raw::text) > 0
            AND a.at BETWEEN c.at - ${NOTICE_WINDOW}::interval AND c.at + ${NOTICE_WINDOW}::interval))
      GROUP BY 1, 2, 3, 4
    ), per AS (
      -- Each comment's one profile: the notice that names its id, else the only one on the post.
      SELECT handle_id, cid, min(actor) actor, min(actor_url) actor_url
      FROM m
      WHERE by_id OR NOT EXISTS (SELECT 1 FROM m m2 WHERE m2.handle_id = m.handle_id AND m2.cid = m.cid AND m2.by_id)
      GROUP BY 1, 2 HAVING count(DISTINCT actor_url) = 1
    )
    SELECT handle_id, min(actor) actor, min(actor_url) actor_url FROM per
    GROUP BY 1 HAVING count(DISTINCT actor_url) = 1`)) as unknown as Array<{
    handle_id: number;
    actor: string | null;
    actor_url: string;
  }>;
  let n = 0;
  for (const r of rows) {
    const to = normalizeHandle("linkedin", r.actor_url);
    if (to && (await mergeHandle(db, r.handle_id, to, { name: r.actor }))) n++;
  }
  return n;
}

export interface TouchesBackfill extends TouchBackfill {
  activity: number;
  /** LinkedIn comment authors moved from a URN to their profile. */
  authors: number;
  linked: number;
}

/** Every source table as touches; re-runs keep nothing twice. `dryRun` counts the rows. */
export async function backfillTouches(
  db: Queryable,
  o: { dryRun?: boolean; now?: Date } = {},
): Promise<TouchesBackfill> {
  const reach = await backfillOutreachTouches(db, o);
  const rows = await db
    .select({ id: socialActivity.id })
    .from(socialActivity)
    .where(ne(socialActivity.kind, "notification"))
    .orderBy(socialActivity.at, socialActivity.id);
  if (o.dryRun) return { ...reach, activity: rows.length, authors: 0, linked: 0 };
  let activity = 0;
  let links = reach.links;
  for (const r of rows) {
    const t = await touchFromActivity(db, r.id);
    if (t?.created) activity++;
    if (t?.linked) links++;
  }
  const authors = await linkCommentAuthors(db);
  return { ...reach, links, activity, authors, linked: await relinkHandles(db) };
}
