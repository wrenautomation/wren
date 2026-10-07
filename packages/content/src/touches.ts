/**
 * Touches from our own accounts' activity, and the whole backfill (designs/2026-10-07-touches.md).
 * A follow, subscribe, reaction or mention someone gave us is theirs; a notice is no one's.
 * `wren touches backfill` folds every source table in under the refs the live writers use.
 */
import { recordTouch, relinkHandles, type TouchKind } from "@wren/core/touches";
import type { Queryable } from "@wren/db";
import { backfillOutreachTouches, type TouchBackfill } from "@wren/outreach/touches";
import { eq, ne } from "drizzle-orm";
import { socialActivity } from "./schema.js";

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
    text: a.text,
    at: a.at,
    source: "social_activity",
    ref: `sa:${a.id}`,
  });
}

export interface TouchesBackfill extends TouchBackfill {
  activity: number;
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
  if (o.dryRun) return { ...reach, activity: rows.length, linked: 0 };
  let activity = 0;
  for (const r of rows) if ((await touchFromActivity(db, r.id))?.created) activity++;
  return { ...reach, activity, linked: await relinkHandles(db) };
}
