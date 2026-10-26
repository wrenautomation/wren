/**
 * Outreach's day caps (William, 10-26): follows a day per platform, each on the shared warm-up
 * ramp from its first follow. The `limits` table overrides a cap (`wren limits set`); the ramp
 * climbs to whatever cap holds. autobrowse's own caps stay the outer bound on the Mac.
 */
import { type LimitDef, limitOf } from "@wren/core/limits";
import { SCHEDULE_ZONE } from "@wren/core/logic";
import { rampedCap } from "@wren/core/ramp";
import { dayStart } from "@wren/core/time";
import type { Queryable } from "@wren/db";
import { RESEARCH_LIMITS } from "@wren/research/limits";
import { sql } from "drizzle-orm";
import type { ReachPostPlatform } from "./schema.js";

const follows = (platform: string, perDay: number, unit = "follows"): LimitDef => ({
  name: `outreach.follow.${platform}`,
  unit: `${unit} a day`,
  why: "a person's pace, not a bot's; ramps up from the first follow",
  perDay,
  burst: null,
  scope: "wren",
});

const FOLLOW_LIMITS = {
  linkedin: follows("linkedin", 15),
  x: follows("x", 15),
  instagram: follows("instagram", 10),
  threads: follows("threads", 7),
  tiktok: follows("tiktok", 7),
  youtube: follows("youtube", 5, "subscribes"),
} as const satisfies Record<string, LimitDef>;

const OUTREACH_LIMITS: readonly LimitDef[] = Object.values(FOLLOW_LIMITS);

/** Every limit Wren keeps, for `wren limits` and the portal. */
export const WREN_LIMITS: readonly LimitDef[] = [...RESEARCH_LIMITS, ...OUTREACH_LIMITS];

const DAY_MS = 86_400_000;

/** Follows still free today on `platform`: the ramped cap less today's follows. */
export async function followsLeft(
  db: Queryable,
  main: Queryable,
  platform: ReachPostPlatform,
  now: Date,
): Promise<number> {
  const cap = (await limitOf(main, null, FOLLOW_LIMITS[platform])).perDay;
  const today = dayStart(SCHEDULE_ZONE, now).toISOString();
  const [row] = (await db.execute(sql`
    SELECT min(followed_at) AS "first",
      count(*) FILTER (WHERE followed_at >= ${today}::timestamptz)::int AS "today"
    FROM reach_posts WHERE platform = ${platform} AND followed_at IS NOT NULL`)) as unknown as Array<{
    first: string | Date | null;
    today: number;
  }>;
  const first = row?.first ? new Date(row.first).getTime() : now.getTime();
  const days = Math.floor((now.getTime() - first) / DAY_MS);
  return Math.max(0, rampedCap(cap, days) - (row?.today ?? 0));
}
