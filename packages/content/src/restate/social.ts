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
 * Each Wren pass also renews autobrowse's tab watchers on our logins (`watched`): a rise in a
 * tab's unread count pushes a pass at once (designs/2026-10-12-push-everywhere.md). The lease runs
 * past the next pass, so a loop that stops leaves no tab open.
 *
 * Every read waits at most its limit (`LIMITS`, designs/2026-10-16-loop-watchdog.md): one that
 * gives no answer is cancelled and said in `errors`; a platform that times out twice in a pass is
 * left for the next; a post or read that times out three passes in a row is held (`unit_holds`,
 * stage `loop.social-watch/<key>`).
 *
 * `SocialDesk` is Marketing → Inbox's activity actions (mark seen, mark all seen) and Followers'
 * "Read now": a follower count read once, for a platform the loop never reads one on (LinkedIn).
 */
import * as restate from "@restatedev/restate-sdk";
import {
  type ActivityQuery,
  type ActivityRow,
  type Audience,
  type CapHolds,
  type CommentRow,
  capHeld,
  holdCap,
  type ListQuery,
  liveHolds,
  PLATFORMS,
  type Platform,
  type SiteClient,
} from "@wren/core/content";
import { DESK, MANY_POSTS } from "@wren/core/content/restate";
import { Broadcast, type Notifier } from "@wren/core/notify";
import {
  clientOfKey,
  type Limits,
  limitsWith,
  makeLoopObject,
  NO_INPUT,
  type PassOutcome,
  serviceHandler,
  setLastPass,
  stoppedPass,
  unitLimits,
  within,
} from "@wren/core/restate";
import { spineEmit } from "@wren/core/spine";
import { wallClock } from "@wren/core/time";
import type { Db } from "@wren/db";
import {
  COMMENTS_FLOW,
  COMMENTS_FROM,
  commentEvent,
  commentsReadSettings,
  wrenCommentsRead,
} from "@wren/outreach";
import { z } from "zod";
import { clientContent } from "../clients.js";
import { MAPS_EVERY_MS, readMapsReviews } from "../social/maps-reviews.js";
import { ringLowReviews } from "../social/review-ring.js";
import {
  canSkip,
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
  postOfComment,
  recentPosts,
} from "../social/store.js";
import { autoReplyReviews } from "./auto-reply.js";
import { catchKeywordDms } from "./keyword-dm.js";
import { nextRunAt } from "./planner.js";
import type { Pushed, SocialPushed } from "./social-push.js";

export const SOCIAL_KEY = "wren";
export const SOCIAL_EVERY_MS = 30 * 60 * 1000;
const FIRST_HOUR = 7;
const LAST_HOUR = 23;
/** Object state: each post's last check, ms, by `platform:id`: a read, or a count that held. */
const READS = "reads";
/** Object state: each post's comment count at its last full read, by `platform:id`. */
const COUNTS = "counts";
/** Object state: each post's last full comment read, ms, by `platform:id`. */
const FULL_READS = "fullReads";
/** Object state: each platform's last activity read, ms. */
const ACTIVITY_READS = "activityReads";
/**
 * Object state: reads a used daily cap holds, until it resets (ms), by `<platform> comments` or
 * `<platform> counts`: no pass asks them before then (X's search cap is 50 a day).
 */
const CAP_HOLDS = "capHolds";
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
  /** Comment counts by post id in one read; null when the channel has to read to count. */
  commentCounts: (
    ctx: restate.Context,
    req: { platform: Platform; ids: string[] } & ForClient,
  ) => Promise<Record<string, number> | null>;
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
  /** Our logins autobrowse's desk keeps a tab watcher on (`linkedin` → `linkedin@wren`). */
  watched?: Partial<Record<Platform, string>>;
  /** Each call's limit over `LIMITS` (tests shorten them). */
  limits?: Partial<Limits>;
}

/** autobrowse's `desk/watch`, as it serves it; no import from that repo. */
type DeskWatch = {
  watch: (
    ctx: restate.Context,
    lease: {
      site: string;
      account: string;
      sink: { path: string; body: Record<string, unknown> };
      until: string;
    },
  ) => Promise<unknown>;
};

/** A watcher's lease outlives the next pass by this much. */
const LEASE_SLACK_MS = 45 * 60_000;

export interface SocialStats {
  /** Posts whose comments were read. */
  posts: number;
  /** Due posts left unread: their comment count had not moved since the last full read. */
  skipped: number;
  comments: number;
  /** New reviews of a client's Business Profile: in `comments` too. */
  reviews: number;
  asked: number;
  activity: number;
  /** New DMs a client's connected accounts brought in. */
  dms: number;
  /** Comments that said a keyword, each sent its DM. */
  keywordDms: number;
  /** Platforms whose follower count was kept this pass. */
  audience: Platform[];
  /** Follower counts that failed this pass, said here, not a failed pass: the next pass asks again. */
  missed: string[];
  /** Reads a used daily cap holds until it resets (`x comments`): no error, asked after the reset. */
  held: string[];
  /** Reads left out: held after timing out pass after pass, or their platform timed out twice. */
  slow?: number;
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

/** A Facebook post id without its Page prefix (`<page>_<post>`): ours may be kept either way. */
const postTail = (id: string) => id.slice(id.indexOf("_") + 1);

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function makeSocialWatch(deps: SocialWatchDeps) {
  const L = limitsWith(deps.limits);
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
    if (!client && deps.watched) {
      const until = new Date(nextPassAt(now, deps.zone).getTime() + LEASE_SLACK_MS).toISOString();
      const desk = ctx.serviceSendClient<DeskWatch>(DESK);
      for (const p of platforms) {
        const account = deps.watched[p];
        if (!account) continue;
        const body = { owner: SOCIAL_KEY, platform: p };
        desk.watch({ site: p, account, sink: { path: "/SocialPush/watch/send", body }, until });
      }
    }
    // What was pushed since the last pass (designs/2026-10-12-push-everywhere.md): read now, due or not.
    const pushed: Pushed[] = await within(
      ctx,
      ctx.objectClient<SocialPushed>({ name: "SocialPushed" }, client ?? SOCIAL_KEY).take(),
      { ms: L.quick, call: "SocialPushed/take" },
    ).catch(() => []);
    const limits = await unitLimits(ctx, deps.db, "SocialWatch");
    const pushedPosts = new Set(
      pushed.flatMap((p) =>
        p.post ? [`${p.platform}:${p.post}`, `${p.platform}:${postTail(p.post)}`] : [],
      ),
    );
    const pushedActivity = new Set(
      pushed.filter((p) => p.kind !== "comment").map((p) => p.platform),
    );
    const stats: SocialStats = {
      posts: 0,
      skipped: 0,
      comments: 0,
      reviews: 0,
      asked: 0,
      activity: 0,
      dms: 0,
      keywordDms: 0,
      audience: [],
      missed: [],
      held: [],
      errors: [],
    };
    /** A read this pass makes, or false (and counted) when it is left out. */
    const go = (unit: string, platform: Platform) => {
      if (!limits.skip(unit, platform)) return true;
      stats.slow = (stats.slow ?? 0) + 1;
      return false;
    };
    const kept: KeptComment[] = [];
    const happened: { kind: ActivityRow["kind"] }[] = [];

    // Only where its account can read them: a LinkedIn profile has no comments API.
    const read = platforms.filter((p) => commented.includes(p));
    const posts = await ctx.run("posts", async () =>
      // A client's posts follow up for the default days; Wren's for its comment reader's setting.
      recentPosts(
        db,
        read,
        now,
        (client ? commentsReadSettings(null) : await wrenCommentsRead(deps.db)).followUpDays,
      ),
    );
    const before = (await ctx.get<Record<string, number>>(READS)) ?? {};
    const countsBefore = (await ctx.get<Record<string, number>>(COUNTS)) ?? {};
    const fullBefore = (await ctx.get<Record<string, number>>(FULL_READS)) ?? {};
    const holds = liveHolds((await ctx.get<CapHolds>(CAP_HOLDS)) ?? {}, now.getTime());
    /** `key` waits on a used cap, or `err` just used one: said in `held`, never an error. */
    const held = (key: string, err?: unknown): boolean => {
      const t = now.getTime();
      const yes = err === undefined ? capHeld(holds, key, t) : holdCap(holds, key, err, t);
      if (yes && !stats.held.includes(key)) stats.held.push(key);
      return yes;
    };
    const reads: Record<string, number> = {};
    const counts: Record<string, number> = {};
    const fulls: Record<string, number> = {};
    const due: { p: (typeof posts)[number]; key: string; wasPushed: boolean }[] = [];
    for (const p of posts) {
      const key = `${p.platform}:${p.id}`;
      const last = before[key];
      if (last !== undefined) reads[key] = last;
      const count = countsBefore[key];
      if (count !== undefined) counts[key] = count;
      const full = fullBefore[key];
      if (full !== undefined) fulls[key] = full;
      const wasPushed = pushedPosts.has(key) || pushedPosts.has(`${p.platform}:${postTail(p.id)}`);
      if (wasPushed || isDue(p, last, now)) due.push({ p, key, wasPushed });
    }
    // One count read per platform for every due post: a post whose count held needs no comment
    // read (designs/2026-10-15-fetch-budget.md). A probe that fails or has no answer reads as before.
    const probed: Record<string, number> = {};
    for (const platform of new Set(due.filter((d) => !d.wasPushed).map((d) => d.p.platform))) {
      const ids = due.filter((d) => d.p.platform === platform).map((d) => d.p.id);
      const unit = `counts ${platform}`;
      for (
        let i = 0;
        i < ids.length && !held(`${platform} counts`) && go(unit, platform);
        i += MANY_POSTS
      )
        try {
          const got = await limits.within(
            unit,
            content.commentCounts({ platform, ids: ids.slice(i, i + MANY_POSTS), ...mine }),
            { ms: L.read, call: "Content/commentCounts", group: platform },
          );
          for (const [id, n] of Object.entries(got ?? {})) probed[`${platform}:${id}`] = n;
        } catch (err) {
          if (!held(`${platform} counts`, err))
            stats.missed.push(`${platform} comment counts: ${errorText(err)}`);
        }
    }
    for (const { p, key, wasPushed } of due) {
      const n = probed[key];
      if (!wasPushed && canSkip(p, n, countsBefore[key], fullBefore[key], now)) {
        reads[key] = now.getTime();
        stats.skipped += 1;
        continue;
      }
      // A used cap: the post stays due, read once the cap resets.
      if (held(`${p.platform} comments`)) continue;
      // Held after timeouts, or its platform slow this pass: it stays due.
      if (!go(`comments ${key}`, p.platform)) continue;
      reads[key] = now.getTime();
      stats.posts += 1;
      try {
        const got = await limits.within(
          `comments ${key}`,
          content.comments({ platform: p.platform, id: p.id, ...mine }),
          { ms: L.read, call: "Content/comments", group: p.platform },
        );
        const rows = await ctx.run(`comments ${key}`, () => keepPostComments(db, p, got));
        kept.push(...rows);
        fulls[key] = now.getTime();
        if (n === undefined) delete counts[key];
        else counts[key] = n;
      } catch (err) {
        if (held(`${p.platform} comments`, err)) {
          stats.posts -= 1;
          if (before[key] === undefined) delete reads[key];
          else reads[key] = before[key];
        } else stats.errors.push(`${key}: ${errorText(err)}`);
      }
    }
    ctx.set(CAP_HOLDS, holds);
    // Posts past the window drop out of state.
    ctx.set(READS, reads);
    ctx.set(COUNTS, counts);
    ctx.set(FULL_READS, fulls);
    // A comment that says a keyword gets its DM (designs/2026-10-11-comment-keywords.md).
    try {
      stats.keywordDms = await catchKeywordDms(
        ctx,
        db,
        client,
        kept.map((k) => k.id),
      );
    } catch (err) {
      stats.errors.push(`keywords: ${errorText(err)}`);
    }
    // Reviews of the account itself, since the newest kept.
    const reviewsBefore = kept.length;
    for (const platform of reviewed)
      try {
        if (!go(`reviews ${platform}`, platform)) continue;
        const rows = await limits.within(
          `reviews ${platform}`,
          content.reviews({ platform, ...mine }),
          { ms: L.read, call: "Content/reviews", group: platform },
        );
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
      const due =
        pushedActivity.has(platform) || now.getTime() - (lastActivity[platform] ?? 0) >= every;
      if (due) lastActivity[platform] = now.getTime();
      // Rows with no time (YouTube's subscribers) pass any `since`; the unique ref keeps them once.
      if (due && go(`activity ${platform}`, platform))
        try {
          const since = await ctx.run(`since ${platform}`, () => newestActivityAt(db, platform));
          const rows = await limits.within(
            `activity ${platform}`,
            content.activity({ platform, ...(since ? { q: { since } } : {}), ...mine }),
            { ms: L.read, call: "Content/activity", group: platform },
          );
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
        if (!go(`audience ${platform}`, platform)) continue;
        const a = await limits.within(
          `audience ${platform}`,
          content.audience({ platform, ...mine }),
          { ms: L.read, call: "Content/audience", group: platform },
        );
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
        const r = await limits.within(
          "dms",
          ctx.serviceClient<SocialInboxRead>({ name: "SocialInbox" }).read({ client }),
          { ms: L.batch, call: "SocialInbox/read" },
        );
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
const ONE_COMMENT = z.looseObject({ id: z.number().int().describe("A comment on our post") });
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
      /**
       * Refresh on a comment on our own post: its post's comments read now and kept, as the
       * watch's pass keeps them (a keyword's DM, the spine), on the same Content read.
       */
      readPost: serviceHandler(
        { input: ONE_COMMENT },
        async (
          ctx: restate.Context,
          req: { id: number },
        ): Promise<{ read: boolean; kept: number }> => {
          const post = await ctx.run("post", () => postOfComment(deps.db, req.id));
          if (!post) return { read: false, kept: 0 };
          const got = await ctx
            .serviceClient<ContentReads>({ name: "Content" })
            .comments({ platform: post.platform, id: post.id });
          const kept = await ctx.run("keep", () => keepPostComments(deps.db, post, got ?? []));
          if (kept.length) {
            await catchKeywordDms(
              ctx,
              deps.db,
              null,
              kept.map((k) => k.id),
            );
            spineEmit(ctx, {
              client: null,
              workflow: COMMENTS_FLOW,
              from: COMMENTS_FROM,
              events: kept.map(commentEvent),
            });
          }
          return { read: true, kept: kept.length };
        },
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
