/** `ReachDesk`'s schedule: drafted comments onto spaced slots, and off them. */
import type * as restate from "@restatedev/restate-sdk";
import { serviceHandler } from "@wren/core/restate";
import { z } from "zod";
import { allCommentsSettings } from "../reach-posts/settings.js";
import { type Slotted, schedulePosts, scheduleThreads, unschedule } from "../scheduled.js";
import { REACH_POST_PLATFORMS } from "../schema.js";
import type { DeskContext } from "./desk-context.js";
import { fireSlots } from "./schedule.js";

const SCHEDULE = z.strictObject({
  posts: z.boolean().default(true).describe("Comments on others' posts"),
  threads: z.boolean().default(true).describe("Reddit threads"),
});

const UNSCHEDULE = z.looseObject({
  posts: z.array(z.number().int()).default([]),
  threads: z.array(z.string()).default([]),
});

export function scheduleHandlers(desk: DeskContext) {
  const { deps, nowOf } = desk;
  return {
    /**
     * Drafted comments onto spaced slots, each sent when its slot comes (`pacing.ts`): others'
     * posts on each platform with an account, Reddit threads on each warmed account.
     */
    schedule: serviceHandler(
      { input: SCHEDULE },
      async (
        ctx: restate.Context,
        req: { posts?: boolean; threads?: boolean } = {},
      ): Promise<{ slots: Slotted[] }> => {
        const now = await nowOf(ctx);
        const slots: Slotted[] = [];
        if (req.posts !== false) {
          const all = await ctx.run("settings", () => allCommentsSettings(deps.db));
          for (const platform of REACH_POST_PLATFORMS)
            slots.push(
              ...(await ctx.run(`schedule ${platform}`, () =>
                schedulePosts(deps.db, platform, all[platform], { now, rand: Math.random }),
              )),
            );
        }
        if (req.threads !== false)
          slots.push(
            ...(await ctx.run("schedule threads", () =>
              scheduleThreads(deps.db, { now, rand: Math.random }),
            )),
          );
        await fireSlots(ctx, slots);
        return { slots };
      },
    ),
    /** Off the schedule: the drafts wait for his click again; their delayed calls send nothing. */
    unschedule: serviceHandler(
      { input: UNSCHEDULE },
      async (
        ctx: restate.Context,
        req: { posts?: number[]; threads?: string[] },
      ): Promise<void> => {
        await ctx.run("unschedule", () =>
          unschedule(deps.db, { posts: req.posts ?? [], threads: req.threads ?? [] }),
        );
      },
    ),
  };
}
