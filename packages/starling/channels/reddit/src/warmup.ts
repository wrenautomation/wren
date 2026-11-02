/**
 * The Reddit warmup protocol: what a young account may do today, from its
 * age and karma. Reddit shadowbans and rate-limits accounts that message or
 * post before they look like a person, so the ladder is read first, then
 * comment, then post, then message, and every rung has a daily cap under the
 * site's own (`caps` in autobrowse's reddit site: 3 posts, 20 comments, 5
 * messages). A pure function: the loop asks it before each step and the CLI
 * prints it.
 *
 * Under 50 karma most of a day's comments go to karma places (large general subs that take new
 * accounts, designs/2026-10-18-reddit-karma.md): business subs filter young accounts, so a comment
 * there is often hidden and earns nothing.
 */
import type { AccountHealth } from "@wren/core/outreach";

export type WarmupStage = "lurk" | "comment" | "post" | "reach";

interface WarmupCaps {
  comments: number;
  /** Of `comments`, how many may go to reach (business) places; the rest go to karma places. */
  reachComments: number;
  posts: number;
  messages: number;
}

export interface Warmup {
  stage: WarmupStage;
  caps: WarmupCaps;
  ageDays: number;
  karma: number;
  /** What moves it up a rung, in words; "" at the top. */
  next: string;
  /** True = nothing may go out at all (suspended, or messages closed). */
  frozen: string | null;
}

type StageCaps = Omit<WarmupCaps, "reachComments">;

export const STAGES: Record<WarmupStage, { minDays: number; minKarma: number; caps: StageCaps }> = {
  lurk: { minDays: 0, minKarma: 0, caps: { comments: 0, posts: 0, messages: 0 } },
  comment: { minDays: 3, minKarma: 0, caps: { comments: 5, posts: 0, messages: 0 } },
  post: { minDays: 14, minKarma: 50, caps: { comments: 6, posts: 1, messages: 0 } },
  reach: { minDays: 30, minKarma: 150, caps: { comments: 10, posts: 1, messages: 3 } },
};
/** Below this karma, reach places take at most `YOUNG_REACH_COMMENTS` of the day's comments. */
export const REACH_FULL_KARMA = 50;
const YOUNG_REACH_COMMENTS = 2;
const LADDER: WarmupStage[] = ["lurk", "comment", "post", "reach"];
/** Messages a day grow by one a week past `reach`, up to the site's 5. */
const REACH_MESSAGE_CAP = 5;

export function warmupOf(health: AccountHealth, now: Date): Warmup {
  const created = health.createdAt ? new Date(health.createdAt) : null;
  const ageDays = created
    ? Math.max(0, Math.floor((now.getTime() - created.getTime()) / 86_400_000))
    : 0;
  const karma = health.karma ?? 0;
  let stage: WarmupStage = "lurk";
  for (const s of LADDER) {
    const r = STAGES[s];
    if (ageDays >= r.minDays && karma >= r.minKarma) stage = s;
  }
  const base = STAGES[stage].caps;
  const caps: WarmupCaps = {
    ...base,
    reachComments:
      karma < REACH_FULL_KARMA ? Math.min(YOUNG_REACH_COMMENTS, base.comments) : base.comments,
  };
  if (stage === "reach") {
    const weeksIn = Math.floor((ageDays - STAGES.reach.minDays) / 7);
    caps.messages = Math.min(REACH_MESSAGE_CAP, STAGES.reach.caps.messages + weeksIn);
  }
  const up = LADDER[LADDER.indexOf(stage) + 1];
  const need = up ? STAGES[up] : null;
  const next = need
    ? [
        ageDays < need.minDays ? `${need.minDays - ageDays} more days` : null,
        karma < need.minKarma ? `${need.minKarma - karma} more karma` : null,
      ]
        .filter(Boolean)
        .join(" and ")
        .concat(` → ${up}`)
    : "";
  const frozen = health.suspended
    ? "suspended"
    : health.acceptsMessages === false
      ? "the account refuses private messages (settings → privacy)"
      : null;
  return { stage, caps, ageDays, karma, next, frozen };
}
