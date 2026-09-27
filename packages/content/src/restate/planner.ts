/**
 * `ContentPlanner/default`: once a day, at `hour` on the fleet's clock, reads
 * tomorrow's plan (slots vs scheduled drafts per platform) and says the
 * shortfall on Discord. It never drafts or approves: those stay a person's
 * call (drafting costs money, approving is publishing). Off until started;
 * `start {"platforms":["linkedin","reddit"]}` picks which platforms count.
 */
import type * as restate from "@restatedev/restate-sdk";
import { PLATFORMS, type Platform } from "@wren/core/content";
import type { Notifier } from "@wren/core/notify";
import { LAST, loopSettings, makeLoopObject, type PassOutcome } from "@wren/core/restate";
import { wallClock, zonedInstant } from "@wren/core/time";
import type { Db } from "@wren/db";
import { type DayPlan, formatPlan, planFor, shortfallOf, tomorrowOf } from "../plan.js";

export const PLANNER_KEY = "default";
export const DEFAULT_PLAN_PLATFORMS: readonly Platform[] = ["linkedin", "reddit"];
const DEFAULT_HOUR = 17;

export interface ContentPlannerDeps {
  db: Db;
  /** The fleet's clock: slots and the daily hour read on it. */
  zone: string;
  /** Hour of day the plan goes out (default 17:00, time to review before tomorrow). */
  hour?: number;
  notifier?: Notifier;
}

export interface PlannerSettings {
  platforms?: Platform[];
}

/** The next `hour`:00 on `zone`'s clock strictly after `now`. */
export function nextRunAt(now: Date, zone: string, hour: number): Date {
  const w = wallClock(zone, now);
  const today = zonedInstant(zone, w.year, w.month, w.day, hour);
  if (today.getTime() > now.getTime()) return today;
  const t = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
  return zonedInstant(zone, t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), hour);
}

export function makeContentPlanner(deps: ContentPlannerDeps) {
  const hour = deps.hour ?? DEFAULT_HOUR;
  return makeLoopObject("ContentPlanner", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const chosen = (await loopSettings<PlannerSettings>(ctx))?.platforms;
    const platforms = (chosen ?? DEFAULT_PLAN_PLATFORMS).filter((p) => PLATFORMS.includes(p));
    const plan = await ctx.run("plan", () =>
      planFor(deps.db, platforms, tomorrowOf(now, deps.zone), deps.zone),
    );
    const short = shortfallOf(plan);
    const notifier = deps.notifier;
    if (notifier)
      await ctx.run("notify", () =>
        notifier.notify(
          short > 0
            ? `content ${plan.day}: ${short} empty slots`
            : `content ${plan.day}: every slot filled`,
          formatPlan(plan).join("\n"),
          short > 0 ? "warning" : "info",
        ),
      );
    const outcome: PassOutcome<DayPlan> = {
      stats: plan,
      error: null,
      failures: 0,
      delayMs: nextRunAt(now, deps.zone, hour).getTime() - now.getTime(),
      now: now.toISOString(),
    };
    ctx.set(LAST, outcome);
    return outcome;
  });
}

export type ContentPlanner = ReturnType<typeof makeContentPlanner>;
