/**
 * `ReachWatch/daily`: reads each account's inbox on the warm cadence (`@wren/core/warm`): every
 * 2 minutes right after a touch, easing to 30. DMs become replies, comments on our posts and
 * under our comments become `comments` rows and events on the `reach.comments` workflow. Then
 * each account's health (the warmup ladder runs on it). A send, an answer or a post wakes it, so
 * the first check comes at once. Every 6 hours the LinkedIn invites account (Shop → LinkedIn
 * invites) is swept for accepts and stale invites, then topped up (invites.ts). Last, DM drafts
 * for threads waiting on William and accepted invites (drafts.ts), at most 30 a day.
 */
import type * as restate from "@restatedev/restate-sdk";
import { sendsOn } from "@wren/core/clients";
import { capWaitMs } from "@wren/core/content";
import { isVendorStop } from "@wren/core/metered";
import type { OutreachChannel } from "@wren/core/outreach";
import { replyWho } from "@wren/core/reply-who";
import {
  clientOfKey,
  errorText,
  makeLoopObject,
  type PassOutcome,
  setLastPass,
  stoppedPass,
  type UnitLimits,
  unitLimits,
} from "@wren/core/restate";
import { replyFired, spineEmit } from "@wren/core/spine";
import { gate } from "@wren/core/vendors";
import { COLD_EVERY_MS, warmEveryMs } from "@wren/core/warm";
import { type HealthStats, lastTouches, listAccounts, refreshHealth } from "../accounts.js";
import { clientReach, type ReachPart, syncLogins } from "../clients.js";
import { COMMENTS_FLOW, COMMENTS_FROM, commentEvent, keepComments } from "../comments.js";
import { contactsToDraft, DRAFTS_PER_DAY, draftDm, draftsToday } from "../drafts.js";
import {
  applyThread,
  asThread,
  COMMENTS_READ,
  commentsReadSettings,
  dueThreads,
  focusesOf,
  mergeReads,
  needsRead,
  nextCheckAt,
  probed,
  THREAD_READS_PER_PASS,
  watchFromComments,
  wrenCommentsRead,
} from "../follow-ups.js";
import { draftInviteNote, invitesToNote, notesLeft } from "../invite-notes.js";
import {
  DRIFT_ERROR,
  emptySweep,
  type InviteSettings,
  inviteSettings,
  invitesSettingsSchema,
  type SweepStats,
  sweepInvites,
  type TopUpStats,
  topUp,
} from "../invites.js";
import {
  allCommentsSettings,
  type CommentsSettings,
  type PostsStats,
  postReader,
  postsPass,
} from "../reach-posts.js";
import { pullReplies, type RepliesStats } from "../replies.js";
import { schedulePosts } from "../scheduled.js";
import { REACH_POST_PLATFORMS, type ReachAccount, type ReachPostPlatform } from "../schema.js";
import { channelsFor, clientDeps, nowFor, type ReachDeps, type ReachView } from "./deps.js";
import { fireSlots } from "./schedule.js";

/** The soonest the watch comes back, whatever is due. */
const WATCH_FLOOR_MS = 60 * 1000;

/** Restate state on `ReachWatch/daily`: each account's last read, epoch ms by account id. */
const READS = "reads";

/**
 * The least time between two inbox reads on a platform whose login has a daily inbox cap:
 * LinkedIn's 48 a day (autobrowse `src/sites/linkedin.ts`) is one every 30 minutes; every 36
 * keeps 8 for other readers, and warm reads never spend it by noon.
 */
const READ_FLOOR_MS: Partial<Record<string, number>> = { linkedin: 36 * 60_000 };

/** The same for health: it stays on the cold cadence, whatever the inbox does. */
const HEALTH = "health";

/** And for the invites sweep, every 6 hours. */
const INVITES = "invites";

const INVITES_EVERY_MS = 6 * 60 * 60 * 1000;

/** And for others' posts to comment on, every six hours until the day's comments wait. */
const POSTS = "posts";

/** LinkedIn keeps the first key, so a deploy doesn't read it twice in a day. */
const postsKey = (p: ReachPostPlatform) => (p === "linkedin" ? POSTS : `${POSTS}:${p}`);

const POSTS_EVERY_MS = 6 * 60 * 60 * 1000;

export interface InvitesPass {
  account: string;
  sweep: SweepStats;
  topUp: TopUpStats | null;
  /** Notes drafted on proposed invites this pass. */
  notes: { written: number; errors: string[] };
}

export interface WatchStats {
  replies: RepliesStats;
  comments: { kept: number; errors: string[] };
  /** Conversations under our comments read for what the inbox missed. */
  threads: ThreadsStats;
  health: HealthStats;
  invites: InvitesPass | null;
  drafts: { written: number; errors: string[] };
  /** Others' LinkedIn posts read, ranked and drafted for To approve: once a day, Wren's only. */
  /** One per platform read this pass. */
  posts: PostsStats[];
  /** A client's vendor gate said no: why, and the pass read no more. */
  stopped: string | null;
  /** Reads left out: held after timing out pass after pass, or their platform slow this pass. */
  skipped?: number;
}

/** The invites account (settings) when it's an active LinkedIn row, else null. */
export const invitesAccount = (accounts: readonly ReachAccount[], s: InviteSettings) =>
  (s.account &&
    accounts.find(
      (a) => a.platform === "linkedin" && a.account === s.account && a.state === "active",
    )) ||
  null;

/** Sweep one account's invites, then queue tomorrow's. Platform calls between journaled steps. */
export async function invitesPass(
  deps: ReachDeps,
  ctx: restate.Context,
  a: ReachAccount,
  s: InviteSettings,
  now: Date,
): Promise<InvitesPass> {
  const ch = channelsFor(deps, ctx)(a);
  const sweep = ch
    ? await sweepInvites(deps.db, ch, a, s, now, (name, fn) => ctx.run(name, fn))
    : emptySweep(["no channel"]);
  const top = await ctx.run(`top up ${a.account}`, () =>
    topUp(deps.db, {
      settings: s,
      account: a,
      policy: deps.policy,
      sequences: deps.sequences,
      sender: deps.senderName,
      held: deps.heldNiches,
      now,
    }),
  );
  return { account: a.account, sweep, topUp: top, notes: await notesPass(deps, ctx, a, now) };
}

/**
 * A note on proposed invites while the month's free notes last: one model call each. A failed
 * call is kept as its words; the invite waits bare and the next pass asks again.
 */
async function notesPass(
  deps: ReachDeps,
  ctx: restate.Context,
  a: ReachAccount,
  now: Date,
): Promise<InvitesPass["notes"]> {
  const out: InvitesPass["notes"] = { written: 0, errors: [] };
  const llm = deps.drafts?.llm;
  if (!llm) return out;
  const due = await ctx.run(`notes due ${a.account}`, async () =>
    invitesToNote(
      deps.db,
      a.id,
      await notesLeft(deps.db, a.id, deps.policy.linkedin.notesPerMonth, now),
    ),
  );
  const factsOf = deps.drafts?.facts;
  const facts =
    due.length && factsOf ? await ctx.run("note facts", async () => [...(await factsOf())]) : [];
  for (const id of due) {
    const r = await ctx.run(`note ${id}`, async () => {
      try {
        const note = await draftInviteNote(deps.db, llm, id, {
          sender: deps.senderName,
          facts,
          now,
        });
        return { written: note ? 1 : 0, error: null };
      } catch (err) {
        return { written: 0, error: `note ${id}: ${errorText(err)}` };
      }
    });
    out.written += r.written;
    if (r.error) out.errors.push(r.error);
  }
  return out;
}

/**
 * Others' posts on one platform: read as the settings' account, ranked, drafted for his yes. With
 * `autoSend`, the drafts then take spaced slots and go out on them.
 */
export async function postsFor(
  deps: ReachDeps,
  ctx: restate.Context,
  platform: ReachPostPlatform,
  settings: CommentsSettings,
  now: Date,
): Promise<PostsStats> {
  const guide = deps.drafts?.commentGuide;
  const stats = await postsPass(deps.db, {
    platform,
    settings,
    read: postReader(deps.sitesFor(ctx), platform, settings.account, {
      authorTitle: settings.authorTitle,
      now,
    }),
    llm: deps.drafts?.llm ?? null,
    ...(guide ? { guide: () => guide(platform) } : {}),
    ...(deps.drafts?.voice ? { voice: deps.drafts.voice } : {}),
    ...(deps.drafts?.facts ? { facts: deps.drafts.facts } : {}),
    ...(deps.drafts?.ours ? { ours: deps.drafts.ours } : {}),
    now,
    step: (name, fn) => ctx.run(name, fn),
    capped: (err) => capWaitMs(err) !== null,
  });
  if (!settings.autoSend) return stats;
  const slots = await ctx.run(`schedule ${platform}`, () =>
    schedulePosts(deps.db, platform, settings, { now, rand: Math.random }),
  );
  await fireSlots(ctx, slots);
  return { ...stats, scheduled: slots.length };
}

/** Draft each contact whose next message is ours, one model call each, under the day's cap. */
async function draftsPass(
  deps: ReachDeps,
  ctx: restate.Context,
  now: Date,
): Promise<WatchStats["drafts"]> {
  const out: WatchStats["drafts"] = { written: 0, errors: [] };
  const llm = deps.drafts?.llm;
  if (!llm) return out;
  const due = await ctx.run("drafts due", async () =>
    contactsToDraft(deps.db, DRAFTS_PER_DAY - (await draftsToday(deps.db, now))),
  );
  const factsOf = deps.drafts?.facts;
  const facts =
    due.length && factsOf ? await ctx.run("facts", async () => [...(await factsOf())]) : [];
  for (const id of due) {
    // A failed call is kept as its words, not thrown: the next pass asks again.
    const r = await ctx.run(`draft ${id}`, async () => {
      try {
        const draft = await draftDm(deps.db, llm, id, {
          sender: deps.senderName,
          ...(deps.drafts?.guide ? { guide: deps.drafts.guide } : {}),
          facts,
          now,
        });
        return { written: draft ? 1 : 0, error: null };
      } catch (err) {
        return { written: 0, error: `draft ${id}: ${errorText(err)}` };
      }
    });
    out.written += r.written;
    if (r.error) out.errors.push(r.error);
  }
  return out;
}

/** What one watch pass reads: Wren's everything, or a client's installed parts on its logins. */
interface WatchScope {
  client: string | null;
  /** Its reach rows by id; null: every row in the database (Wren's). */
  only: readonly string[] | null;
  replies: boolean;
  comments: boolean;
  /** The invites block, or null: no invites this pass. */
  invites: () => Promise<InviteSettings | null>;
  drafts: boolean;
  /** Comments on others' LinkedIn posts: Wren's only. */
  posts: boolean;
  /** Days a thread stays watched after its last activity; 0 = no follow-up reads. */
  followUpDays: () => Promise<number>;
}

export function makeReachWatch(deps: ReachDeps) {
  return makeLoopObject<WatchStats>("ReachWatch", async (ctx) => {
    const now = await nowFor(ctx, deps.clock);
    const owner = clientOfKey(ctx.key);
    if (!owner)
      return watchPass(deps, ctx, now, {
        client: null,
        only: null,
        replies: true,
        comments: true,
        invites: () => inviteSettings(deps.db),
        drafts: true,
        posts: true,
        followUpDays: async () => (await wrenCommentsRead(deps.db)).followUpDays,
      });
    if (!deps.clients) return stoppedPass<WatchStats>(ctx, now, "no client databases here");
    const plan = await ctx.run("client", () =>
      clientReach(deps.db, owner.client, ["reach.outreach", "comments.read", "linkedin.invites"]),
    );
    if (plan.kind === "gone") return stoppedPass<WatchStats>(ctx, now, plan.why);
    const has = (p: ReachPart) => plan.parts.includes(p);
    const part = has("comments.read")
      ? "comments.read"
      : has("reach.outreach")
        ? "reach.outreach"
        : "linkedin.invites";
    const model = await ctx.run(
      "gate models",
      async () => (await gate(deps.db, owner.client, "models", 1, now)).ok,
    );
    const d = clientDeps(deps, plan, part, now, model);
    const only = await ctx.run("logins", async () =>
      (await syncLogins(d.db, plan.logins, now)).map((a) => a.id),
    );
    return watchPass(d, ctx, now, {
      client: owner.client,
      only,
      replies: has("reach.outreach"),
      comments: has("comments.read"),
      // Invites read and queue only once an admin armed them: sweeping withdraws, a write.
      invites: async () => {
        if (!has("linkedin.invites") || !sendsOn(plan.client, "linkedin.invites")) return null;
        const got = invitesSettingsSchema.safeParse(plan.client.products["linkedin.invites"] ?? {});
        if (!got.success) return null;
        const login = plan.logins.find((l) => l.platform === "linkedin")?.account ?? null;
        return { ...got.data, account: got.data.account || (login ?? "") };
      },
      drafts: has("reach.outreach"),
      posts: false,
      followUpDays: async () =>
        commentsReadSettings(plan.client.products[COMMENTS_READ]).followUpDays,
    });
  });
}

export interface ThreadsStats {
  probed: number;
  read: number;
  kept: number;
  answered: number;
  errors: string[];
}

/**
 * Follow-ups the inbox never lists (designs/2026-10-15-engage-threads.md): each watched thread's
 * count probed in one read per account, read in full only when it moved (or a sweep is due), a
 * few reads a pass. A used cap or a vendor stop ends the account's reads; the next pass asks again.
 */
async function threadsPass(
  deps: ReachDeps,
  ctx: restate.ObjectContext,
  now: Date,
  scope: WatchScope,
  live: readonly ReachAccount[],
  channelFor: (a: ReachAccount) => OutreachChannel | null,
  ours: readonly string[],
  stop: (err: unknown) => void,
  limits: UnitLimits,
): Promise<ThreadsStats> {
  const out: ThreadsStats = { probed: 0, read: 0, kept: 0, answered: 0, errors: [] };
  const readers = live.filter((a) => channelFor(a)?.thread);
  if (!readers.length) return out;
  const days = await ctx.run("follow-up days", () => scope.followUpDays());
  if (days <= 0) return out;
  const due = (
    await ctx.run("threads due", async () => {
      await watchFromComments(deps.db, now, days, [...new Set(readers.map((a) => a.platform))]);
      return dueThreads(
        deps.db,
        now,
        readers.map((a) => a.id),
      );
    })
  ).map(asThread);
  let budget = THREAD_READS_PER_PASS;
  for (const a of readers) {
    const mine = due.filter((t) => t.accountId === a.id);
    const ch = channelFor(a);
    const thread = ch?.thread;
    if (!mine.length || !ch || !thread) continue;
    const handles = ours.filter(Boolean);
    const unit = `threads ${a.account}`;
    if (limits.skip(unit, a.platform)) continue;
    try {
      await limits.guard(
        unit,
        async () => {
          const counts = ch.commentCounts ? await ch.commentCounts(mine.map((t) => t.post)) : {};
          out.probed += mine.length;
          for (const t of mine) {
            const r = ctx.rand.random();
            const count = counts[t.post];
            if (!needsRead(t, count, now)) {
              await ctx.run(`probed ${t.id}`, () =>
                probed(deps.db, t.id, nextCheckAt(t.activeAt, now, r)),
              );
              continue;
            }
            // Out of reads this pass: it stays due and goes first next pass.
            if (budget <= 0) continue;
            budget -= 1;
            let read = await thread(t.post);
            out.read += 1;
            if (read.more > 0)
              for (const focus of focusesOf(read, handles)) {
                read = mergeReads(read, [await thread(t.post, focus)]);
                out.read += 1;
              }
            const got = await ctx.run(`thread ${t.id}`, () =>
              applyThread(deps.db, t, a, read, handles, now, r, days),
            );
            out.kept += got.kept.length;
            out.answered += got.answered.length;
            if (got.kept.length)
              spineEmit(ctx, {
                client: scope.client,
                workflow: COMMENTS_FLOW,
                from: COMMENTS_FROM,
                events: got.kept.map(commentEvent),
              });
          }
        },
        a.platform,
      );
    } catch (err) {
      stop(err);
      if (capWaitMs(err) === null && !isVendorStop(err))
        out.errors.push(`threads ${a.account}: ${errorText(err)}`);
    }
  }
  return out;
}

async function watchPass(
  deps: ReachDeps,
  ctx: restate.ObjectContext,
  now: Date,
  scope: WatchScope,
): Promise<PassOutcome<WatchStats>> {
  const channelFor = channelsFor(deps, ctx);
  // Every desk read waits at most `LIMITS.desk` (`sitesFor`); a read that times out pass after
  // pass is held, and a platform whose reads time out twice is left for the next pass.
  const limits = await unitLimits(ctx, deps.db, "ReachWatch");
  let skipped = 0;
  const go = (unit: string, group: string) => {
    if (!limits.skip(unit, group)) return true;
    skipped += 1;
    return false;
  };
  const accounts = await ctx.run("accounts", () => listAccounts(deps.db));
  const live = accounts.filter(
    (a) =>
      (a.state === "active" || a.state === "warming") &&
      (scope.only === null || scope.only.includes(a.id)),
  );
  // Each account reads on its own warm cadence: often after a touch, easing off as it goes quiet.
  const touches = await ctx.run("touches", async () => {
    const t = await lastTouches(deps.db);
    for (const p of new Set(live.map((a) => a.platform))) {
      const posted = await deps.postedAt?.(p);
      if (!posted) continue;
      for (const a of live)
        if (a.platform === p && (!t[a.id] || posted > (t[a.id] as string))) t[a.id] = posted;
    }
    return t;
  });
  const reads = (await ctx.get<Record<string, number>>(READS)) ?? {};
  const checked = (await ctx.get<Record<string, number>>(HEALTH)) ?? {};
  // Our own logins: a pushed DM reads now; a platform a tab watcher is on reads cold, since the
  // tab says when something comes in (content's `SocialPushed`, designs/2026-10-12-push-everywhere.md).
  const view: ReachView =
    scope.client || !deps.pushes
      ? { pushed: [], watched: [] }
      : await deps.pushes(ctx).catch(() => ({ pushed: [], watched: [] }));
  const everyOf = new Map(
    live.map((a) => {
      const t = view.watched.includes(a.platform) ? null : touches[a.id];
      const warm = warmEveryMs(t ? new Date(t) : null, now, ctx.rand.random());
      return [a.id, Math.max(warm, READ_FLOOR_MS[a.platform] ?? 0)];
    }),
  );
  const isDue = (a: ReachAccount) =>
    view.pushed.includes(a.platform) ||
    now.getTime() - (reads[a.id] ?? 0) >= (everyOf.get(a.id) ?? 0);
  // Platform reads happen inside these helpers; each account's result is applied in its own step.
  const replies: RepliesStats = { checked: 0, received: 0, optedOut: 0, errors: [] };
  const health: HealthStats = { checked: 0, frozen: [], errors: [] };
  const kept: WatchStats["comments"] = { kept: 0, errors: [] };
  const ours = accounts.flatMap((a) => (a.handle ? [a.handle] : []));
  // A client's vendor gate saying no ends the pass's reads; the next pass asks again.
  let stopped: string | null = null;
  const stop = (err: unknown) => {
    if (isVendorStop(err)) stopped ??= err.why;
  };
  // A used daily cap is no error: the account's next read waits until the cap resets.
  const capped = (a: ReachAccount, err: unknown) => {
    const wait = capWaitMs(err);
    if (wait === null) return false;
    reads[a.id] = now.getTime() + wait - (everyOf.get(a.id) ?? 0);
    return true;
  };
  for (const a of live.filter(isDue)) {
    if (stopped) break;
    const ch = channelFor(a);
    if (!ch) continue;
    reads[a.id] = now.getTime();
    if (scope.replies && go(`replies ${a.account}`, a.platform))
      try {
        const got = await limits.guard(`replies ${a.account}`, () => ch.replies(null), a.platform);
        const r = await ctx.run(`replies ${a.account}`, () =>
          pullReplies(deps.db, [a], () => ({ ...ch, replies: async () => got }), now),
        );
        replies.checked += r.checked;
        replies.received += r.received;
        replies.optedOut += r.optedOut;
        // Each lead's reply: every live Reply trigger that hears DMs gets it.
        if (deps.fire)
          for (const id of r.replied ?? []) {
            const who = await ctx.run(`reply who ${id}`, () => replyWho(deps.db, "dm", id));
            deps.fire(ctx, replyFired(scope.client, "dm", id, who));
          }
      } catch (err) {
        stop(err);
        if (!capped(a, err)) replies.errors.push(`${a.account}: ${errorText(err)}`);
      }
    // The same inbox read: the adapter asks the platform once for both.
    const readComments = ch.comments;
    if (scope.comments && readComments && !stopped && go(`comments ${a.account}`, a.platform))
      try {
        const got = await limits.guard(`comments ${a.account}`, () => readComments(), a.platform);
        const rows = await ctx.run(`comments ${a.account}`, () =>
          keepComments(deps.db, a, got, ours),
        );
        kept.kept += rows.length;
        if (rows.length)
          spineEmit(ctx, {
            client: scope.client,
            workflow: COMMENTS_FLOW,
            from: COMMENTS_FROM,
            events: rows.map(commentEvent),
          });
      } catch (err) {
        stop(err);
        if (!capped(a, err)) kept.errors.push(`${a.account}: ${errorText(err)}`);
      }
    if (stopped || now.getTime() - (checked[a.id] ?? 0) < COLD_EVERY_MS) continue;
    if (!go(`health ${a.account}`, a.platform)) continue;
    checked[a.id] = now.getTime();
    try {
      const h = await limits.guard(`health ${a.account}`, () => ch.health(), a.platform);
      const r = await ctx.run(`health ${a.account}`, () =>
        refreshHealth(deps.db, [a], () => ({ ...ch, health: async () => h }), now),
      );
      health.checked += r.checked;
      health.frozen.push(...r.frozen);
    } catch (err) {
      stop(err);
      health.errors.push(`${a.account}: ${errorText(err)}`);
    }
  }
  const threads: ThreadsStats =
    scope.comments && !stopped
      ? await threadsPass(deps, ctx, now, scope, live, channelFor, ours, stop, limits)
      : { probed: 0, read: 0, kept: 0, answered: 0, errors: [] };
  let invites: InvitesPass | null = null;
  const swept = (await ctx.get<number>(INVITES)) ?? 0;
  if (!stopped && now.getTime() - swept >= INVITES_EVERY_MS) {
    const settings = await ctx.run("invite settings", () => scope.invites());
    const a = settings && invitesAccount(live, settings);
    if (settings && a && go(`invites ${a.account}`, a.platform)) {
      ctx.set(INVITES, now.getTime());
      try {
        invites = await limits.guard(
          `invites ${a.account}`,
          () => invitesPass(deps, ctx, a, settings, now),
          a.platform,
        );
      } catch (err) {
        stop(err);
        health.errors.push(`invites ${a.account}: ${errorText(err)}`);
      }
    }
  }
  const drafts = scope.drafts ? await draftsPass(deps, ctx, now) : { written: 0, errors: [] };
  const posts: PostsStats[] = [];
  if (scope.posts && !stopped) {
    const all = await ctx.run("comment settings", () => allCommentsSettings(deps.db));
    for (const platform of REACH_POST_PLATFORMS) {
      const settings = all[platform];
      const key = postsKey(platform);
      const at = (await ctx.get<number>(key)) ?? 0;
      if (!settings.account || now.getTime() - at < POSTS_EVERY_MS) continue;
      if (!go(`posts ${platform}`, platform)) continue;
      ctx.set(key, now.getTime());
      try {
        posts.push(
          await limits.guard(
            `posts ${platform}`,
            () => postsFor(deps, ctx, platform, settings, now),
            platform,
          ),
        );
      } catch (err) {
        health.errors.push(`posts ${platform}: ${errorText(err)}`);
      }
    }
  }
  ctx.set(READS, reads);
  ctx.set(HEALTH, checked);
  const stats: WatchStats = {
    replies,
    comments: kept,
    threads,
    health,
    invites,
    drafts,
    posts,
    stopped,
    ...(skipped ? { skipped } : {}),
  };
  const next = live.map((a) => (reads[a.id] ?? 0) + (everyOf.get(a.id) ?? 0) - now.getTime());
  const outcome: PassOutcome<WatchStats> = {
    stats,
    error: null,
    failures: 0,
    delayMs: Math.max(WATCH_FLOOR_MS, next.length ? Math.min(...next) : COLD_EVERY_MS),
    now: now.toISOString(),
  };
  await setLastPass(ctx, outcome);
  const notifier = deps.notifier;
  const accepted = invites?.sweep.accepted.length ?? 0;
  const drift = invites?.sweep.errors.find((e) => e.startsWith(DRIFT_ERROR)) ?? null;
  const toComment = posts.reduce((n, p) => n + p.queued, 0);
  if (
    notifier &&
    (replies.received > 0 ||
      kept.kept > 0 ||
      threads.kept > 0 ||
      accepted > 0 ||
      drift ||
      toComment > 0 ||
      health.frozen.length > 0)
  ) {
    const news = [
      replies.received ? `${replies.received} new DMs` : null,
      kept.kept ? `${kept.kept} new comments` : null,
      threads.kept ? `${threads.kept} follow-ups in threads` : null,
      accepted ? `${accepted} accepted invites` : null,
      drift ? "LinkedIn connections drift" : null,
      toComment ? `${toComment} post comments to approve` : null,
    ].filter(Boolean);
    await ctx.run("notify", () =>
      notifier.notify(
        `reach: ${news.join(", ") || "no news"}${health.frozen.length ? `, paused ${health.frozen.join(", ")}` : ""}`,
        [
          replies.received || kept.kept ? "Inbox → Waiting on you" : null,
          accepted || toComment ? "Marketing → To approve" : null,
          ...replies.errors,
          ...kept.errors,
          ...(invites?.sweep.errors ?? []),
          ...health.errors,
          ...drafts.errors,
        ]
          .filter(Boolean)
          .join("\n"),
        health.frozen.length ? "warning" : news.length ? "action" : "info",
      ),
    );
  }
  return outcome;
}

export type ReachWatchObject = ReturnType<typeof makeReachWatch>;
