/**
 * `SocialWatch/wren` (designs/2026-10-06-social-inbox.md): every 30 minutes, 07:00-23:00 on the
 * fleet's clock, reads comments on our posts of the last 14 days, activity since the newest kept
 * row, and the follower count once a day, through the `Content` service. New comments go on the
 * spine (`reach.comments`) like reach's; one ping per pass that kept something. It reads only:
 * every answer waits on William's click.
 *
 * `SocialWatch/<client>/social`: the same for a client, on its own logins (`Content` with
 * `client`, reads through its vendor gate) into its own database; its comments go on the spine
 * with its id. No ping: its Inbox is its own.
 *
 * `SocialDesk` is Marketing → Inbox's activity actions (mark seen, mark all seen) and Followers'
 * "Read now": a follower count read once, for a platform the loop never reads one on (LinkedIn).
 */
import * as restate from "@restatedev/restate-sdk";
import {
  type ActivityQuery,
  type ActivityRow,
  type Audience,
  type CommentRow,
  type ListQuery,
  PLATFORMS,
  type Platform,
  type SiteClient,
} from "@wren/core/content";
import { Broadcast, type Notifier } from "@wren/core/notify";
import {
  clientOfKey,
  makeLoopObject,
  NO_INPUT,
  type PassOutcome,
  serviceHandler,
  setLastPass,
  stoppedPass,
} from "@wren/core/restate";
import { spineEmit } from "@wren/core/spine";
import { wallClock } from "@wren/core/time";
import type { Db } from "@wren/db";
import { COMMENTS_FLOW, COMMENTS_FROM, commentEvent } from "@wren/outreach";
import { z } from "zod";
import { clientContent } from "../clients.js";
import { MAPS_EVERY_MS, readMapsReviews } from "../social/maps-reviews.js";
import { ringLowReviews } from "../social/review-ring.js";
import {
  hasDay,
  isDue,
  type KeptComment,
  keepActivity,
  keepDay,
  keepPostComments,
  keepReviews,
  markSeen,
  newestActivityAt,
  pingOf,
  recentPosts,
} from "../social/store.js";
import { autoReplyReviews } from "./auto-reply.js";
import { nextRunAt } from "./planner.js";

export const SOCIAL_KEY = "wren";
export const SOCIAL_EVERY_MS = 30 * 60 * 1000;
const FIRST_HOUR = 7;
const LAST_HOUR = 23;
/** Object state: each post's last comment read, ms, by `platform:id`. */
const READS = "reads";
/** Object state: each platform's last activity read, ms. */
const ACTIVITY_READS = "activityReads";
/** Object state: the last Google Maps review read, ms. */
const MAPS_READ = "mapsRead";
/** Platforms whose activity is read less often than every pass: LinkedIn's 12 reads a day. */
export const ACTIVITY_EVERY_MS: Partial<Record<Platform, number>> = {
  linkedin: 2 * 60 * 60 * 1000,
};

/** Follower counts read only on his click (`SocialDesk.readAudience`): LinkedIn's is a desk read. */
export const AUDIENCE_ON_DEMAND: readonly Platform[] = ["linkedin"];

/** The `Content` service's read handlers as the worker serves them. */
type ForClient = { client?: string | null };
type ContentReads = {
  comments: (
    ctx: restate.Context,
    req: { platform: Platform; id: string; q?: ListQuery } & ForClient,
  ) => Promise<CommentRow[]>;
  activity: (
    ctx: restate.Context,
    req: { platform: Platform; q?: ActivityQuery } & ForClient,
  ) => Promise<ActivityRow[] | null>;
  audience: (
    ctx: restate.Context,
    req: { platform: Platform } & ForClient,
  ) => Promise<Audience | null>;
  reviews: (
    ctx: restate.Context,
    req: { platform: Platform; q?: ActivityQuery } & ForClient,
  ) => Promise<CommentRow[] | null>;
};
/** A client's DMs through its connected accounts (`makeSocialInbox`). */
type SocialInboxRead = {
  read: (
    ctx: restate.Context,
    req: { client: string },
  ) => Promise<{ messages: number; errors: string[] }>;
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
  /** A client's database; absent, a client's key stops. */
  clientDb?: ((client: string) => Db) | null;
  /**
   * Google reviews off Maps for a client whose Business Profile doesn't read them: its Place ID,
   * and autobrowse's desk to read them on.
   */
  maps?: {
    placeId: (client: string) => Promise<string | null>;
    sites: (ctx: restate.Context) => SiteClient;
  };
}

export interface SocialStats {
  posts: number;
  comments: number;
  /** New reviews of a client's Business Profile: in `comments` too. */
  reviews: number;
  asked: number;
  activity: number;
  /** New DMs a client's connected accounts brought in. */
  dms: number;
  /** Platforms whose follower count was kept this pass. */
  audience: Platform[];
  /** Follower counts that failed this pass, said here, not a failed pass: the next pass asks again. */
  missed: string[];
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
    const client = clientOfKey(ctx.key)?.client ?? null;
    let db = deps.db;
    let platforms = deps.platforms;
    /** Platforms whose post comments are read; Wren's own: every one. */
    let commented: readonly Platform[] = deps.platforms;
    let reviewed: readonly Platform[] = [];
    let dms = false;
    if (client) {
      if (!deps.clientDb) return stoppedPass<SocialStats>(ctx, now, "no client databases here");
      const plan = await ctx.run("client", () => clientContent(deps.db, client, "content.social"));
      if (plan.kind === "gone") return stoppedPass<SocialStats>(ctx, now, plan.why);
      db = deps.clientDb(client);
      dms = plan.dms.length > 0;
      // Its connected accounts, and its autobrowse logins on the channels the worker runs.
      platforms = plan.platforms.filter((p) => plan.connected[p] || deps.platforms.includes(p));
      commented = plan.comments;
      reviewed = plan.reviews.filter((p) => platforms.includes(p));
    }
    const mine = client ? { client } : {};
    const stats: SocialStats = {
      posts: 0,
      comments: 0,
      reviews: 0,
      asked: 0,
      activity: 0,
      dms: 0,
      audience: [],
      missed: [],
      errors: [],
    };
    const kept: KeptComment[] = [];
    const happened: { kind: ActivityRow["kind"] }[] = [];

    // Only where its account can read them: a LinkedIn profile has no comments API.
    const read = platforms.filter((p) => commented.includes(p));
    const posts = await ctx.run("posts", () => recentPosts(db, read, now));
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
        const got = await content.comments({ platform: p.platform, id: p.id, ...mine });
        const rows = await ctx.run(`comments ${key}`, () => keepPostComments(db, p, got));
        kept.push(...rows);
      } catch (err) {
        stats.errors.push(`${key}: ${errorText(err)}`);
      }
    }
    // Posts past the window drop out of state.
    ctx.set(READS, reads);
    // Reviews of the account itself, since the newest kept.
    const reviewsBefore = kept.length;
    for (const platform of reviewed)
      try {
        const rows = await content.reviews({ platform, ...mine });
        if (rows?.length)
          kept.push(
            ...(await ctx.run(`reviews ${platform}`, () => keepReviews(db, platform, rows, now))),
          );
      } catch (err) {
        stats.errors.push(`${platform} reviews: ${errorText(err)}`);
      }
    // No Profile reading them: Google Maps, by the Place ID, every 6 hours.
    const lastMaps = (await ctx.get<number>(MAPS_READ)) ?? 0;
    if (
      client &&
      deps.maps &&
      !reviewed.includes("google_business") &&
      now.getTime() - lastMaps >= MAPS_EVERY_MS
    ) {
      const maps = deps.maps;
      ctx.set(MAPS_READ, now.getTime());
      try {
        const place = await ctx.run("place", () => maps.placeId(client));
        if (place) {
          const rows = await readMapsReviews(maps.sites(ctx), place);
          if (rows.length)
            kept.push(
              ...(await ctx.run("reviews maps", () =>
                keepReviews(db, "google_business", rows, now),
              )),
            );
        }
      } catch (err) {
        stats.errors.push(`Google Maps reviews: ${errorText(err)}`);
      }
    }
    stats.reviews = kept.length - reviewsBefore;
    // A 1 or 2 star review: its owners hear of it like an @ mention.
    const fresh = kept.slice(reviewsBefore).map((k) => k.id);
    if (client && fresh.length)
      try {
        await ctx.run("ring", () => ringLowReviews(deps.db, db, client, fresh, now));
      } catch (err) {
        stats.errors.push(`review ring: ${errorText(err)}`);
      }
    // Each new review gets a reply drafted (designs/2026-10-09-review-replies.md).
    autoReplyReviews(
      ctx,
      client,
      kept.slice(reviewsBefore).map((k) => k.id),
    );
    if (kept.length)
      spineEmit(ctx, {
        client,
        workflow: COMMENTS_FLOW,
        from: COMMENTS_FROM,
        events: kept.map(commentEvent),
      });

    const day = dayOf(now, deps.zone);
    const lastActivity = (await ctx.get<Record<string, number>>(ACTIVITY_READS)) ?? {};
    for (const platform of platforms) {
      const every = ACTIVITY_EVERY_MS[platform] ?? 0;
      const due = now.getTime() - (lastActivity[platform] ?? 0) >= every;
      if (due) lastActivity[platform] = now.getTime();
      // Rows with no time (YouTube's subscribers) pass any `since`; the unique ref keeps them once.
      if (due)
        try {
          const since = await ctx.run(`since ${platform}`, () => newestActivityAt(db, platform));
          const rows = await content.activity({
            platform,
            ...(since ? { q: { since } } : {}),
            ...mine,
          });
          if (rows?.length)
            happened.push(
              ...(await ctx.run(`activity ${platform}`, () =>
                keepActivity(db, platform, rows, now),
              )),
            );
        } catch (err) {
          stats.errors.push(`${platform} activity: ${errorText(err)}`);
        }
      // A count that fails is no reading this pass, never a failed pass: the next pass asks again.
      if (AUDIENCE_ON_DEMAND.includes(platform)) continue;
      try {
        if (await ctx.run(`day ${platform}`, () => hasDay(db, platform, day))) continue;
        const a = await content.audience({ platform, ...mine });
        if (a && (await ctx.run(`keep day ${platform}`, () => keepDay(db, platform, day, a))))
          stats.audience.push(platform);
      } catch (err) {
        stats.missed.push(`${platform} audience: ${errorText(err)}`);
      }
    }
    ctx.set(ACTIVITY_READS, lastActivity);

    // A client's DMs on its connected Page, Instagram and X, into its Inbox.
    if (client && dms)
      try {
        const r = await ctx
          .serviceClient<SocialInboxRead>({ name: "SocialInbox" })
          .read({ client });
        stats.dms = r.messages;
        stats.errors.push(...r.errors.map((e) => `dms ${e}`));
      } catch (err) {
        stats.errors.push(`dms: ${errorText(err)}`);
      }

    stats.comments = kept.length;
    stats.asked = kept.filter((c) => c.asked).length;
    stats.activity = happened.length;
    const line = pingOf(kept, happened);
    const { notifier, texter } = client ? {} : deps;
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
const PLATFORM = z.looseObject({
  platform: z.enum(PLATFORMS as [Platform, ...Platform[]]).describe("linkedin"),
});

/** Marketing → Inbox's activity actions, and Followers' "Read now". */
export function makeSocialDesk(deps: { db: Db; zone: string }) {
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
      /** One follower count now, kept as today's (it replaces one read earlier today). */
      readAudience: serviceHandler(
        { input: PLATFORM },
        async (ctx: restate.Context, req: { platform: Platform }) => {
          const day = dayOf(new Date(await ctx.date.now()), deps.zone);
          const a = await ctx
            .serviceClient<ContentReads>({ name: "Content" })
            .audience({ platform: req.platform });
          if (!a) throw new restate.TerminalError(`${req.platform} reads no follower count`);
          await ctx.run("keep day", () => keepDay(deps.db, req.platform, day, a, true));
          return { platform: req.platform, day, followers: a.followers };
        },
      ),
    },
  });
}

export type SocialDesk = ReturnType<typeof makeSocialDesk>;
