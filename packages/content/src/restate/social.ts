/**
 * `SocialWatch/wren` (designs/2026-10-06-social-inbox.md): every 30 minutes, 07:00-23:00 on the
 * fleet's clock, reads comments on our posts of the last 14 days, activity since the newest kept
 * row, and the follower count once a day, through the `Content` service. New comments go on the
 * spine (`reach.comments`) like reach's; one ping per pass that kept something. It reads only:
 * every answer waits on William's click.
 *
 * `SocialDesk` is Marketing → Inbox's activity actions: mark seen, mark all seen.
 */
import * as restate from "@restatedev/restate-sdk";
import type {
  ActivityQuery,
  ActivityRow,
  Audience,
  CommentRow,
  ListQuery,
  Platform,
} from "@wren/core/content";
import { Broadcast, type Notifier } from "@wren/core/notify";
import {
  makeLoopObject,
  NO_INPUT,
  type PassOutcome,
  serviceHandler,
  setLastPass,
} from "@wren/core/restate";
import { spineEmit } from "@wren/core/spine";
import { wallClock } from "@wren/core/time";
import type { Db } from "@wren/db";
import { COMMENTS_FLOW, COMMENTS_FROM, commentEvent } from "@wren/outreach";
import { z } from "zod";
import {
  hasDay,
  isDue,
  type KeptComment,
  keepActivity,
  keepDay,
  keepPostComments,
  markSeen,
  newestActivityAt,
  pingOf,
  recentPosts,
} from "../social/store.js";
import { nextRunAt } from "./planner.js";

export const SOCIAL_KEY = "wren";
export const SOCIAL_EVERY_MS = 30 * 60 * 1000;
const FIRST_HOUR = 7;
const LAST_HOUR = 23;
/** Object state: each post's last comment read, ms, by `platform:id`. */
const READS = "reads";

/** The `Content` service's read handlers as the worker serves them. */
type ContentReads = {
  comments: (
    ctx: restate.Context,
    req: { platform: Platform; id: string; q?: ListQuery },
  ) => Promise<CommentRow[]>;
  activity: (
    ctx: restate.Context,
    req: { platform: Platform; q?: ActivityQuery },
  ) => Promise<ActivityRow[] | null>;
  audience: (ctx: restate.Context, req: { platform: Platform }) => Promise<Audience | null>;
};

export interface SocialWatchDeps {
  db: Db;
  /** The configured content channels (`WREN_CONTENT_CHANNELS`). */
  platforms: readonly Platform[];
  /** The fleet's clock: the 07:00-23:00 window and the day a follower count is kept for. */
  zone: string;
  /** Every ping (Discord). */
  notifier?: Notifier;
  /** Joins the ping only when a kept comment asks for something (a text). Follows never text. */
  texter?: Notifier;
}

export interface SocialStats {
  posts: number;
  comments: number;
  asked: number;
  activity: number;
  /** Platforms whose follower count was kept this pass. */
  audience: Platform[];
  errors: string[];
}

/** 30 minutes on, or the next 07:00 when that lands outside 07:00-23:00. */
export function nextPassAt(now: Date, zone: string): Date {
  const next = new Date(now.getTime() + SOCIAL_EVERY_MS);
  const { hour } = wallClock(zone, next);
  return hour >= FIRST_HOUR && hour < LAST_HOUR ? next : nextRunAt(now, zone, FIRST_HOUR);
}

const dayOf = (now: Date, zone: string) => {
  const w = wallClock(zone, now);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function makeSocialWatch(deps: SocialWatchDeps) {
  return makeLoopObject("SocialWatch", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const content = ctx.serviceClient<ContentReads>({ name: "Content" });
    const stats: SocialStats = {
      posts: 0,
      comments: 0,
      asked: 0,
      activity: 0,
      audience: [],
      errors: [],
    };
    const kept: KeptComment[] = [];
    const happened: { kind: ActivityRow["kind"] }[] = [];

    const posts = await ctx.run("posts", () => recentPosts(deps.db, deps.platforms, now));
    const before = (await ctx.get<Record<string, number>>(READS)) ?? {};
    const reads: Record<string, number> = {};
    for (const p of posts) {
      const key = `${p.platform}:${p.id}`;
      const last = before[key];
      if (last !== undefined) reads[key] = last;
      if (!isDue(p, last, now)) continue;
      reads[key] = now.getTime();
      stats.posts += 1;
      try {
        const got = await content.comments({ platform: p.platform, id: p.id });
        const rows = await ctx.run(`comments ${key}`, () => keepPostComments(deps.db, p, got));
        kept.push(...rows);
      } catch (err) {
        stats.errors.push(`${key}: ${errorText(err)}`);
      }
    }
    // Posts past the window drop out of state.
    ctx.set(READS, reads);
    if (kept.length)
      spineEmit(ctx, {
        client: null,
        workflow: COMMENTS_FLOW,
        from: COMMENTS_FROM,
        events: kept.map(commentEvent),
      });

    const day = dayOf(now, deps.zone);
    for (const platform of deps.platforms) {
      try {
        const since = await ctx.run(`since ${platform}`, () => newestActivityAt(deps.db, platform));
        const rows = await content.activity({ platform, ...(since ? { q: { since } } : {}) });
        if (rows?.length)
          happened.push(
            ...(await ctx.run(`activity ${platform}`, () =>
              keepActivity(deps.db, platform, rows, now),
            )),
          );
      } catch (err) {
        stats.errors.push(`${platform} activity: ${errorText(err)}`);
      }
      try {
        if (await ctx.run(`day ${platform}`, () => hasDay(deps.db, platform, day))) continue;
        const a = await content.audience({ platform });
        if (a && (await ctx.run(`keep day ${platform}`, () => keepDay(deps.db, platform, day, a))))
          stats.audience.push(platform);
      } catch (err) {
        stats.errors.push(`${platform} audience: ${errorText(err)}`);
      }
    }

    stats.comments = kept.length;
    stats.asked = kept.filter((c) => c.asked).length;
    stats.activity = happened.length;
    const line = pingOf(kept, happened);
    const { notifier, texter } = deps;
    if (line && notifier) {
      const to = stats.asked && texter ? new Broadcast([notifier, texter]) : notifier;
      const body = stats.asked
        ? `${stats.asked} asked for something. Marketing → Inbox.`
        : "Marketing → Inbox.";
      await ctx.run("notify", () => to.notify(line, body, "action"));
    }

    const outcome: PassOutcome<SocialStats> = {
      stats,
      error: stats.errors.length ? stats.errors.join("; ").slice(0, 2000) : null,
      failures: 0,
      delayMs: nextPassAt(now, deps.zone).getTime() - now.getTime(),
      now: now.toISOString(),
    };
    await setLastPass(ctx, outcome);
    return outcome;
  });
}

export type SocialWatch = ReturnType<typeof makeSocialWatch>;

const IDS = z.looseObject({ ids: z.array(z.number().int()).describe("Activity row ids") });

/** Marketing → Inbox's activity actions. Database writes only. */
export function makeSocialDesk(deps: { db: Db }) {
  return restate.service({
    name: "SocialDesk",
    handlers: {
      markSeen: serviceHandler(
        { input: IDS },
        async (ctx: restate.Context, req: { ids: number[] }): Promise<{ seen: number }> => ({
          seen: await ctx.run("seen", () => markSeen(deps.db, req.ids)),
        }),
      ),
      markAllSeen: serviceHandler(
        { input: NO_INPUT },
        async (ctx: restate.Context): Promise<{ seen: number }> => ({
          seen: await ctx.run("seen", () => markSeen(deps.db, null)),
        }),
      ),
    },
  });
}

export type SocialDesk = ReturnType<typeof makeSocialDesk>;
