/**
 * Cold outreach on Restate:
 *
 * - `ReachSender/fleet`: the send loop. One pass = one tick (tick.ts) over
 *   the journal: database steps in `ctx.run`, platform calls as journaled
 *   calls to the Mac's desk. Next pass after the gap when it sent, five
 *   minutes when nothing could go. Off until `wren reach queue start`.
 * - `ReachWatch/daily`: reads each account's inbox on the warm cadence
 *   (`@wren/core/warm`): every 2 minutes right after a touch, easing to 30.
 *   DMs become replies, comments on our posts and under our comments become
 *   `comments` rows and events on the `reach.comments` workflow. Then each
 *   account's health (the warmup ladder runs on it). A send, an answer or a
 *   post wakes it, so the first check comes at once. Every 6 hours the
 *   LinkedIn invites account (Shop → LinkedIn invites) is swept for accepts
 *   and stale invites, then topped up (invites.ts). Last, DM drafts for threads
 *   waiting on William and accepted invites (drafts.ts), at most 30 a day.
 * - `ReachDesk`: the operator's reads and writes (accounts, finds, enrich,
 *   enroll, templates, threads), each one journaled.
 */
import * as restate from "@restatedev/restate-sdk";
import { linkedinOutreach } from "@wren/channel-linkedin";
import { redditOutreach } from "@wren/channel-reddit";
import { finishRun, openRun } from "@wren/core";
import { byOf, keepSentEdit } from "@wren/core/ask";
import { sendsOn } from "@wren/core/clients";
import { type Platform as ContentPlatform, capWaitMs, type SiteClient } from "@wren/core/content";
import { isRefusal } from "@wren/core/content/restate";
import type { Scorecard } from "@wren/core/draft-models";
import { rejectWhy } from "@wren/core/draft-record";
import { isVendorStop, meteredModel, meteredSites } from "@wren/core/metered";
import type { Notifier } from "@wren/core/notify";
import type { OurPost } from "@wren/core/our-posts";
import type { Found, OutreachChannel, Profile } from "@wren/core/outreach";
import { PASS_REASONS, type PassReason } from "@wren/core/pass-reasons";
import { gate } from "@wren/core/vendors";

/** The `Content` service's reply handler as the worker serves it. */
type ContentReply = {
  reply: (
    ctx: restate.Context,
    req: { platform: ContentPlatform; commentId: string; postId?: string | null; text: string },
  ) => Promise<void>;
  privateReply: (
    ctx: restate.Context,
    req: { platform: ContentPlatform; commentId: string; text: string },
  ) => Promise<{ ref: string | null }>;
  arm: (
    ctx: restate.Context,
    req: { platform: ContentPlatform; commentId: string; postId?: string | null; text: string },
  ) => Promise<{ armed: boolean }>;
};

import type { KeyStore } from "@wren/core/keys";
import {
  clientKey,
  clientOfKey,
  errorText,
  lastPass,
  makeLoopObject,
  NO_INPUT,
  type PassOutcome,
  PORTAL_FIELDS,
  serviceHandler,
  setLastPass,
  stoppedPass,
} from "@wren/core/restate";
import { type FireTriggers, replyFired, spineEmit } from "@wren/core/spine";
import { COLD_EVERY_MS, warmEveryMs } from "@wren/core/warm";
import { cadenceId } from "@wren/core/workflows";
import type { Db } from "@wren/db";
import { type LlmClient, llmForKey } from "@wren/llm";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  type AccountView,
  accountById,
  addAccount,
  type HealthStats,
  lastTouches,
  listAccounts,
  platformOf,
  refreshHealth,
  setAccountState,
  viewOf,
} from "../accounts.js";
import {
  type ClientReach,
  clientReach,
  clientSends,
  type ReachPart,
  syncLogins,
} from "../clients.js";
import {
  answerFor,
  COMMENTS_FLOW,
  COMMENTS_FROM,
  checkThread,
  commentById,
  commentEvent,
  dmCommenter,
  dropComment,
  keepComments,
  markAnswered,
  planAnswer,
  planPrivateReply,
  privateReplied,
} from "../comments.js";
import {
  type AddStats,
  addContact,
  addProspects,
  contactById,
  enrichContact,
  listContacts,
} from "../contacts.js";
import { pickAccount, pickedAccount } from "../draft-accounts.js";
import { draftScorecard, parseSince } from "../draft-models.js";
import {
  contactsToDraft,
  type DmGuide,
  DRAFTS_PER_DAY,
  draftDm,
  draftsToday,
  queueDraft,
} from "../drafts.js";
import { type EnrollStats, enroll } from "../enroll.js";
import { reachLead } from "../follow.js";
import {
  adoptNode,
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
  threadFor,
  watchFromComments,
  wrenCommentsRead,
} from "../follow-ups.js";
import {
  itemPerson,
  markFollowed,
  messageAccount,
  personContact,
  personFollow,
} from "../from-people.js";
import {
  draftInviteNote,
  invitesToNote,
  NOTE_MAX,
  notesLeft,
  recordNote,
  setInviteNote,
} from "../invite-notes.js";
import {
  applyWithdraw,
  approveInvites,
  INVITE_SEQUENCE,
  type InviteSettings,
  inviteSettings,
  invitesSettingsSchema,
  type ProposedInvite,
  proposedInvites,
  type SweepStats,
  skipInvites,
  sweepInvites,
  type TopUpStats,
  topUp,
} from "../invites.js";
import { liftPass, listPasses, passOn } from "../passes.js";
import type { ReachPolicy } from "../policy.js";
import {
  allCommentsSettings,
  COMMENT_MAX,
  type CommentsSettings,
  commentsSettings,
  followAct,
  listPosts,
  markPostActed,
  markPostCommented,
  type PostsStats,
  planPostAct,
  planPostComment,
  postActs,
  postReader,
  postsPass,
  type RedraftResult,
  redraftPosts,
  skipPost,
} from "../reach-posts.js";
import { ReachRefusal } from "../refusal.js";
import { pullReplies, type RepliesStats } from "../replies.js";
import {
  type Slotted,
  schedulePosts,
  scheduleThreads,
  sendFailed,
  stillDue,
  unschedule,
} from "../scheduled.js";
import {
  ACCOUNT_STATES,
  type AccountState,
  CONTACT_STATES,
  type ContactState,
  type DmPlatform,
  isReachPlatform,
  type Platform,
  REACH_POST_PLATFORMS,
  type ReachAccount,
  type ReachContact,
  type ReachPostPlatform,
  reachContacts,
} from "../schema.js";
import { type ReachSequence, slotsOf } from "../sequences.js";
import { itemOf, markPosted, requeueDm, unsureItem } from "../settle-send.js";
import { listTemplates, type SetTemplate, type SlotView, setTemplate } from "../store.js";
import {
  getThread,
  listThreads,
  markRead,
  type ReachStats,
  reachStats,
  type Thread,
  type ThreadFilter,
  type ThreadSummary,
} from "../threads.js";
import { nextDue, type TickStats, tick } from "../tick.js";
import { discoveryHandlers } from "./discovery.js";
import { contentLook, isSendUnsure, sendAtMostOnce, sendError } from "./maybe-sent.js";
import { pasteHandlers } from "./paste.js";
import { scheduleProofs } from "./proofs.js";
import { fireSlots } from "./schedule.js";

export const SENDER_KEY = "fleet";
export const WATCH_KEY = "daily";
/** Due rows held (window, caps, warming): asked again this soon. */
const HELD_MS = 5 * 60 * 1000;
/**
 * Nothing due: the net under the push. A queued row wakes the sender at commit (`wren_wake`,
 * the box's listener), so this only covers a wake lost while the box restarts.
 */
const NET_MS = 15 * 60 * 1000;

/** The wait after a tick: the gap while sending, a short wait while due rows are held, else until the next. */
export function reachDelayMs(
  s: TickStats,
  next: string | null,
  gapSeconds: number,
  now: Date,
): number {
  if (s.sent > 0) return gapSeconds * 1000;
  if (Object.values(s.held).some((n) => n > 0)) return HELD_MS;
  const wait = next ? Date.parse(next) - now.getTime() : NET_MS;
  return Math.min(Math.max(wait, 1000), NET_MS);
}
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
/** And for others' LinkedIn posts to comment on, once a day. */
const POSTS = "posts";
/** LinkedIn keeps the first key, so a deploy doesn't read it twice in a day. */
const postsKey = (p: ReachPostPlatform) => (p === "linkedin" ? POSTS : `${POSTS}:${p}`);
const POSTS_EVERY_MS = 24 * 60 * 60 * 1000;

export interface ReachDeps {
  db: Db;
  /**
   * What was pushed for our own logins (content's `SocialPushed/wren.reach`): DMs to read now,
   * and platforms a tab watcher is on, read cold. Unset: none.
   */
  pushes?: (ctx: restate.ObjectContext) => Promise<ReachView>;
  /** Each lead's DM reply to the spine's Reply triggers (`spineFire`). Unset, none fire. */
  fire?: FireTriggers;
  policy: ReachPolicy;
  sequences: ReadonlyMap<string, ReachSequence>;
  /** The live gate: off = the loop plans and holds, nothing leaves. */
  live: boolean;
  /** `{sender}` in the copy. */
  senderName: string;
  heldNiches: readonly string[];
  /** The desk's sites client for this context (journaled calls to the Mac). */
  sitesFor: (ctx: restate.Context) => SiteClient;
  notifier?: Notifier;
  clock?: () => Date;
  /** When Wren last posted on `platform` (content's channel): a post warms that site's accounts. */
  postedAt?: (platform: Platform) => Promise<string | null>;
  /**
   * DM drafts: the model and the `outbound-copy` SOP. No model, no drafts. Comments on others'
   * LinkedIn posts: the comments SOP (`commentGuide`) and his voice. `facts`: what is true about
   * the writer, the only first-person claims a draft may make; none, and it claims nothing.
   */
  drafts?: {
    llm: LlmClient | null;
    guide?: DmGuide;
    commentGuide?: DmGuide;
    voice?: string;
    facts?: () => Promise<readonly string[]>;
    /** What we've posted: what comments on others' posts draw on. */
    ours?: () => Promise<readonly OurPost[]>;
  };
  /** Runs per client (`ReachWatch/<client>/daily`): none, and a client's key stops. */
  clients?: ReachClients;
}

export interface ReachClients {
  /** A client's own database. */
  clientDb: (id: string) => Db;
  /** The model a client's drafts use on Wren's key, metered on its own `models` vendor. */
  llm: LlmClient | null;
  /** Clients' own keys: a client on its own Exa or model key runs on it. */
  keys?: KeyStore | null;
  /** A client's DM guide, from the SOPs in its own database. */
  dmGuide?: (db: Db, platform: DmPlatform) => Promise<string>;
  /** A client's facts for Reddit drafts: the SOPs in its own database. */
  facts?: (db: Db) => Promise<{ label: string; text: string }[]>;
}

/**
 * The deps for one client's pass: its own database, every read through its vendor gate (in
 * journaled steps), its model metered, no Discord lane and no content posts of Wren's.
 */
export function clientDeps(
  deps: ReachDeps,
  plan: Extract<ClientReach, { kind: "work" }>,
  part: ReachPart,
  now: Date,
  /** Its `models` gate said yes this pass (`gate` once: a model call costs no units). */
  model = false,
): ReachDeps {
  const { notifier: _n, postedAt: _p, drafts: _d, clients, ...rest } = deps;
  if (!clients) throw new Error("no client databases here");
  const db = clients.clientDb(plan.client.id);
  const scope = {
    main: deps.db,
    client: plan.client.id,
    part,
    now: () => now,
    store: clients.keys ?? null,
  };
  const dmGuide = clients.dmGuide;
  return {
    ...rest,
    db,
    sitesFor: (ctx) =>
      meteredSites(deps.sitesFor(ctx), { ...scope, step: (name, fn) => ctx.run(name, fn) }),
    ...(clients.llm && model
      ? {
          drafts: {
            llm: meteredModel(clients.llm, { ...scope, own: llmForKey }),
            ...(dmGuide ? { guide: (p: DmPlatform) => dmGuide(db, p) } : {}),
          },
        }
      : {}),
  };
}

/** Wake the watch so a touch's first check comes now, not after a cold sleep. */
export const wakeWatch = (ctx: restate.Context, client: string | null = null) =>
  ctx
    .objectSendClient<{ wake: (c: restate.ObjectContext) => Promise<unknown> }>(
      { name: "ReachWatch" },
      client ? clientKey(client, WATCH_KEY) : WATCH_KEY,
    )
    .wake();

async function nowFor(ctx: restate.Context, clock?: () => Date): Promise<Date> {
  return clock ? clock() : new Date(await ctx.date.now());
}

/** One adapter per account row, over the desk's sites as that account. */
export function channelsFor(deps: ReachDeps, ctx: restate.Context) {
  const sites = deps.sitesFor(ctx);
  const made = new Map<string, OutreachChannel>();
  return (a: ReachAccount): OutreachChannel | null => {
    const hit = made.get(a.id);
    if (hit) return hit;
    const asAccount: SiteClient = {
      call: (site, method, path, input, acct) =>
        sites.call(site, method, path, input, acct ?? a.account),
      via: (site, method, path) => sites.via(site, method, path),
    };
    const ch =
      a.platform === "reddit"
        ? redditOutreach(asAccount, { account: a.account })
        : linkedinOutreach(asAccount, { account: a.account, startedOn: a.startedOn });
    made.set(a.id, ch);
    return ch;
  };
}

/**
 * A site's refusal (4xx, `isRefusal`) as the terminal error it is. `restateSites` hands it back
 * as a SiteCallError, which a handler would retry forever against the journaled answer.
 */
export function finalRefusal(err: unknown): unknown {
  return isRefusal(err) ? new restate.TerminalError(err.message, { errorCode: err.status }) : err;
}

export function makeReachSender(deps: ReachDeps) {
  return makeLoopObject<TickStats>("ReachSender", async (ctx) => {
    const now = await nowFor(ctx, deps.clock);
    const owner = clientOfKey(ctx.key);
    if (!owner) return senderPass(deps, ctx, now, { client: null });
    if (!deps.clients) return stoppedPass<TickStats>(ctx, now, "no client databases here");
    const plan = await ctx.run("client", () =>
      clientReach(deps.db, owner.client, ["reach.outreach", "linkedin.invites"]),
    );
    if (plan.kind === "gone") return stoppedPass<TickStats>(ctx, now, plan.why);
    const d = clientDeps(deps, plan, "reach.outreach", now);
    await ctx.run("logins", async () => {
      await syncLogins(d.db, plan.logins, now);
    });
    return senderPass(d, ctx, now, {
      client: owner.client,
      sends: clientSends(plan.client, deps.live),
    });
  });
}

/** One tick: Wren's over its database, or a client's over its own with its live flags. */
async function senderPass(
  deps: ReachDeps,
  ctx: restate.ObjectContext,
  now: Date,
  scope: { client: string | null; sends?: (kind: string) => boolean },
): Promise<PassOutcome<TickStats>> {
  const channelFor = channelsFor(deps, ctx);
  // The ledger row brackets the pass; the tick's own steps are journaled one by one.
  const runId = await ctx.run("open run", async () => {
    const run = await openRun(deps.db, { command: "reach tick", argv: { live: deps.live } });
    return run.id;
  });
  let stats: TickStats | null = null;
  let error: string | null = null;
  try {
    stats = await tick(
      deps.db,
      {
        channelFor,
        policy: deps.policy,
        sequences: deps.sequences,
        sender: deps.senderName,
        live: deps.live,
        ...(scope.sends ? { sends: scope.sends } : {}),
        linkSource: scope.client ?? "wren",
        now,
        runId,
        settle: (ms) => ctx.sleep(ms),
      },
      (name, fn) => ctx.run(name, fn),
    );
  } catch (err) {
    if (!(err instanceof restate.TerminalError)) throw err;
    error = errorText(err);
  }
  await ctx.run("finish run", () => finishRun(deps.db, runId, stats ?? { error }));
  // Each sent step leaves its node; the cadence's wire waits, then queues the next (follow.ts).
  for (const s of stats?.stepped ?? [])
    spineEmit(ctx, {
      client: scope.client,
      workflow: cadenceId(s.sequence),
      from: `s${s.step}.sent`,
      events: [reachLead(s.contactId)],
    });
  if (stats && stats.sent > 0) wakeWatch(ctx, scope.client);
  const previous = await lastPass<PassOutcome<TickStats>>(ctx);
  const failures = stats ? 0 : (previous?.failures ?? 0) + 1;
  const next = stats ? await ctx.run("next due", () => nextDue(deps.db, now)) : null;
  const delayMs = stats ? reachDelayMs(stats, next, deps.policy.gapSeconds, now) : HELD_MS;
  const outcome: PassOutcome<TickStats> = {
    stats,
    error,
    failures,
    delayMs,
    now: now.toISOString(),
  };
  await setLastPass(ctx, outcome);
  if (deps.notifier && error && previous?.error !== error) {
    const notifier = deps.notifier;
    await ctx.run("notify error", () =>
      notifier.notify("reach tick failing", error as string, "warning"),
    );
  }
  return outcome;
}

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
}

/** The invites account (settings) when it's an active LinkedIn row, else null. */
const invitesAccount = (accounts: readonly ReachAccount[], s: InviteSettings) =>
  (s.account &&
    accounts.find(
      (a) => a.platform === "linkedin" && a.account === s.account && a.state === "active",
    )) ||
  null;

/** Sweep one account's invites, then queue tomorrow's. Platform calls between journaled steps. */
async function invitesPass(
  deps: ReachDeps,
  ctx: restate.Context,
  a: ReachAccount,
  s: InviteSettings,
  now: Date,
): Promise<InvitesPass> {
  const ch = channelsFor(deps, ctx)(a);
  const sweep = ch
    ? await sweepInvites(deps.db, ch, a, s, now, (name, fn) => ctx.run(name, fn))
    : { accepted: [], withdrawn: 0, gone: 0, errors: ["no channel"] };
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
async function postsFor(
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
    if (!mine.length || !ch?.thread) continue;
    const handles = ours.filter(Boolean);
    try {
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
        let read = await ch.thread(t.post);
        out.read += 1;
        if (read.more > 0)
          for (const focus of focusesOf(read, handles)) {
            read = mergeReads(read, [await ch.thread(t.post, focus)]);
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
    } catch (err) {
      stop(err);
      if (capWaitMs(err) === null && !isVendorStop(err))
        out.errors.push(`threads ${a.account}: ${errorText(err)}`);
    }
  }
  return out;
}

/** What content's `SocialPushed/wren.reach` answers. */
export type ReachView = { pushed: string[]; watched: string[] };

async function watchPass(
  deps: ReachDeps,
  ctx: restate.ObjectContext,
  now: Date,
  scope: WatchScope,
): Promise<PassOutcome<WatchStats>> {
  const channelFor = channelsFor(deps, ctx);
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
    if (scope.replies)
      try {
        const got = await ch.replies(null);
        const r = await ctx.run(`replies ${a.account}`, () =>
          pullReplies(deps.db, [a], () => ({ ...ch, replies: async () => got }), now),
        );
        replies.checked += r.checked;
        replies.received += r.received;
        replies.optedOut += r.optedOut;
        // Each lead's reply: every live Reply trigger that hears DMs gets it.
        if (deps.fire)
          for (const id of r.replied ?? []) deps.fire(ctx, replyFired(scope.client, "dm", id));
      } catch (err) {
        stop(err);
        if (!capped(a, err)) replies.errors.push(`${a.account}: ${errorText(err)}`);
      }
    // The same inbox read: the adapter asks the platform once for both.
    if (scope.comments && ch.comments && !stopped)
      try {
        const got = await ch.comments();
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
    checked[a.id] = now.getTime();
    try {
      const h = await ch.health();
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
      ? await threadsPass(deps, ctx, now, scope, live, channelFor, ours, stop)
      : { probed: 0, read: 0, kept: 0, answered: 0, errors: [] };
  let invites: InvitesPass | null = null;
  const swept = (await ctx.get<number>(INVITES)) ?? 0;
  if (!stopped && now.getTime() - swept >= INVITES_EVERY_MS) {
    const settings = await ctx.run("invite settings", () => scope.invites());
    const a = settings && invitesAccount(live, settings);
    if (settings && a) {
      ctx.set(INVITES, now.getTime());
      try {
        invites = await invitesPass(deps, ctx, a, settings, now);
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
      ctx.set(key, now.getTime());
      try {
        posts.push(await postsFor(deps, ctx, platform, settings, now));
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
  const toComment = posts.reduce((n, p) => n + p.queued, 0);
  if (
    notifier &&
    (replies.received > 0 ||
      kept.kept > 0 ||
      threads.kept > 0 ||
      accepted > 0 ||
      toComment > 0 ||
      health.frozen.length > 0)
  ) {
    const news = [
      replies.received ? `${replies.received} new DMs` : null,
      kept.kept ? `${kept.kept} new comments` : null,
      threads.kept ? `${threads.kept} follow-ups in threads` : null,
      accepted ? `${accepted} accepted invites` : null,
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

const PLATFORM = z.string().describe("reddit or linkedin");
const NICHE = z.string().nullish();
const CONTACT = z.looseObject({ contactId: z.number() });
const ADD_ACCOUNT = z.looseObject({
  platform: PLATFORM,
  account: z.string().describe("The autobrowse credential, e.g. reddit@alt"),
});
const CLIENT = z.string().nullish().describe("A client's id: its own logins; none: Wren's");
const ACCOUNT_STATE = z.looseObject({
  id: z.string(),
  state: z.enum(ACCOUNT_STATES),
  reason: z.string().nullish(),
  client: CLIENT,
});
const FIND = z.looseObject({
  accountId: z.string(),
  query: z.string(),
  limit: z.number().nullish(),
  cursor: z.string().nullish().describe("Where the last page stopped"),
  niche: NICHE,
});
const ADD_CONTACT = z.looseObject({
  platform: PLATFORM,
  handle: z.string().describe("A profile URL or a handle"),
  name: z.string().nullish(),
  niche: NICHE,
});
const CONTACTS = z
  .looseObject({
    platform: PLATFORM.nullish(),
    state: z.enum(CONTACT_STATES).nullish(),
    limit: z.number().nullish(),
  })
  .nullish();
const ENRICH = z.looseObject({
  contactId: z.number(),
  accountId: z.string().nullish().describe("Read as this account; default theirs, else the first"),
});
const ENROLL = z.looseObject({
  sequence: z.string(),
  limit: z.number().nullish(),
  contactIds: z.array(z.number()).nullish(),
  enrichedOnly: z.boolean().nullish(),
  niche: NICHE,
});
const SET_TEMPLATE = z.looseObject({
  key: z.string(),
  body: z.string().nullish().describe("Empty clears it"),
  by: z.string().nullish().describe("Who saved it; from the console, the operator"),
  viewer: PORTAL_FIELDS.viewer,
});
const THREADS = z
  .looseObject({
    platform: PLATFORM.nullish(),
    state: z.enum(CONTACT_STATES).nullish(),
    unread: z.boolean().nullish(),
    limit: z.number().nullish(),
  })
  .nullish();
const REPLY = CONTACT.extend({
  body: z.string().nullish().describe("The words; the console leaves an untouched draft out"),
  subject: z.string().nullish().describe("Reddit only"),
});
const STATS = z.looseObject({ platform: PLATFORM.nullish(), days: z.number().nullish() }).nullish();
const COMMENT = z.looseObject({ id: z.number() });
/** A drop's optional why (quick pick, note) for the draft record; a bad pick is the caller's. */
export const terminalWhy = (req: { reason?: unknown; note?: unknown }) => {
  try {
    return rejectWhy(req);
  } catch (err) {
    throw new restate.TerminalError((err as Error).message, { errorCode: 400 });
  }
};
const POST = z.looseObject({
  id: z.number().int(),
  body: z.string().nullish().describe("The words; the console leaves an untouched draft out"),
  at: z.iso
    .datetime()
    .nullish()
    .describe("The scheduler's slot; one moved or cleared sends nothing"),
});
const SCHEDULE = z.strictObject({
  posts: z.boolean().default(true).describe("Comments on others' posts"),
  threads: z.boolean().default(true).describe("Reddit threads"),
});
const UNSCHEDULE = z.looseObject({
  posts: z.array(z.number().int()).default([]),
  threads: z.array(z.string()).default([]),
});
const POST_ACT = z.looseObject({
  id: z.number().int(),
  act: z.enum(["like", "follow"]).describe("Like the post, or follow its author"),
});
const DRAFT_MODELS = z.looseObject({ since: z.string().max(40).nullish() });
const POST_IDS = z.looseObject({ ids: z.array(z.number().int()).min(1).max(100) });
const PASS = z.looseObject({
  ids: z
    .array(z.string().regex(/^(comment|onpost|thread|dm):\S+$/))
    .min(1)
    .max(200)
    .describe("Engage ids: comment:4, onpost:9, thread:t3_x, dm:3"),
  reason: z
    .enum(PASS_REASONS)
    .describe("Why: not_lead, not_worth, spam, competitor, rude, not_now"),
  note: z.string().max(280).nullish(),
});
const LIFT = z.looseObject({ platform: z.string().min(1), handle: z.string().min(1) });
const POSTS_LIST = z
  .looseObject({ state: z.string().nullish(), limit: z.number().nullish() })
  .nullish();
const INVITE_IDS = z.looseObject({
  ids: z.array(z.number().int()).min(1).max(100).describe("contacts with a proposed invite"),
});
const INVITE_APPROVE = INVITE_IDS.extend({
  note: z
    .string()
    .max(NOTE_MAX)
    .nullish()
    .describe("His words for the note, one invite only; empty sends it bare"),
});
const ANSWER = COMMENT.extend({
  body: z.string().nullish().describe("The words; the console leaves an untouched draft out"),
});
const DM = COMMENT.extend({ body: z.string() });
/** A person's word on an unsure send (designs/2026-10-16-maybe-sent.md). */
const SETTLE_SEND = z.looseObject({
  item: z.string().min(3).max(80).describe("The send's typed id: thread:, comment:, onpost:, dm:"),
  outcome: z
    .enum(["posted", "again"])
    .describe("posted: he saw it on the site; again: send it once more"),
});
/** ReachDesk's own sends, called again on a person's Send again. */
type DeskSends = {
  [K in "commentThread" | "answerComment" | "commentPost"]: (
    ctx: restate.Context,
    req: { id: string | number; again: true; viewer?: unknown },
  ) => Promise<unknown>;
};
const THREAD_REPLY = COMMENT.extend({
  ref: z.string().min(1).max(200).describe("The platform id of the comment to reply to"),
  body: z.string().nullish().describe("The words"),
  account: z.string().nullish().describe("The account it goes out as; none: the default"),
});
const PERSON = z.looseObject({
  id: z.string().describe("A People id: li:<people.id>, reddit:<handle> or <platform>:<handle>"),
});
const ITEM_MESSAGE = z.looseObject({
  id: z
    .string()
    .regex(/^(comment|onpost|thread|dm):\S+$/)
    .describe("An Engage row: comment:<n>, onpost:<n>, thread:<id>, dm:<contactId>"),
  body: z.string().min(1).describe("His words"),
});
const PERSON_MESSAGE = PERSON.extend({
  body: z.string().nullish().describe("The words; the console leaves an untouched draft out"),
});

export function makeReachDesk(deps: ReachDeps) {
  /** A LinkedIn invite for one contact through the invite sequence; answers their id. */
  const invite = async (c: ReachContact, now: Date): Promise<number> => {
    const seq = deps.sequences.get(INVITE_SEQUENCE);
    if (!seq) throw new ReachRefusal(`no sequence ${INVITE_SEQUENCE}`);
    const settings = await inviteSettings(deps.db);
    const a = invitesAccount(await listAccounts(deps.db), settings);
    if (!a) throw new ReachRefusal("no active account set in Shop → LinkedIn invites");
    if (c.platform !== "linkedin") throw new ReachRefusal("invites are LinkedIn only");
    if (c.connectedAt) throw new ReachRefusal("already connected: message them");
    if (c.state !== "new") throw new ReachRefusal(`already ${c.state}`);
    const e = await enroll(deps.db, {
      sequence: seq,
      sender: deps.senderName,
      contactIds: [c.id],
      limit: 1,
      account: a.account,
      now,
    });
    if (!e.enrolled)
      throw new ReachRefusal((await contactById(deps.db, c.id)).stateReason ?? "not enrolled");
    return c.id;
  };
  const terminal = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ReachRefusal) throw new restate.TerminalError(err.message);
      throw err;
    }
  };
  const nowOf = (ctx: restate.Context) => nowFor(ctx, deps.clock);
  /** Wren's database, or a client's own (its logins' rows). */
  const dbOf = (client: string | null | undefined): Db => {
    if (!client) return deps.db;
    if (!deps.clients) throw new restate.TerminalError("no client databases here");
    return deps.clients.clientDb(client);
  };
  const slots = slotsOf(deps.sequences.values());
  const nudge = (ctx: restate.Context) =>
    ctx
      .objectSendClient<{ sync: (c: restate.ObjectContext) => Promise<unknown> }>(
        { name: "ReachSender" },
        SENDER_KEY,
      )
      .sync();
  /**
   * One comment answered in its thread, as the account that read it, or through `Content.reply`
   * on our own post. `body` null: the draft. Sent now: the click is the yes.
   */
  const answerOne = async (
    ctx: restate.Context,
    id: number,
    given: string | null,
    by: ReturnType<typeof byOf>,
    again = false,
  ): Promise<{ ref: string | null }> => {
    const now = await nowOf(ctx);
    const plan = await ctx.run("plan", () => terminal(() => planAnswer(deps.db, id, now)));
    const words = (given ?? plan.comment.draft ?? "").trim();
    if (!words) throw new restate.TerminalError("the answer is empty");
    // Answered, and words that differ from the draft kept as his edit.
    const answered = (ref: string | null, body: string) =>
      ctx.run("answered", async () => {
        await keepSentEdit(deps.db, {
          record: "comment",
          id: String(id),
          by,
          before: plan.comment.draft,
          after: body,
        });
        await markAnswered(deps.db, id, { body, ref, now, by });
      });
    const item = `comment:${id}`;
    /** Unsure waits on a person; any other failure as the handler throws it. */
    const failed = (err: unknown): never => {
      throw isSendUnsure(err) ? err : sendError(err);
    };
    if (!plan.account) {
      // On our own post: the content channel answers (designs/2026-10-06-social-inbox.md).
      const { target, text } = answerFor(plan.comment, words);
      const platform = plan.comment.platform;
      const sent = await sendAtMostOnce(ctx, deps.db, {
        item,
        platform,
        account: null,
        words: text,
        target,
        url: plan.comment.url,
        again,
        look: contentLook(ctx, { platform, post: plan.comment.post, parent: target, text }),
        send: async () => {
          await ctx.serviceClient<ContentReply>({ name: "Content" }).reply({
            platform,
            commentId: target,
            // LinkedIn names a member comment by its post and its bare id.
            postId: plan.comment.post,
            text,
          });
          return { ref: null };
        },
      }).catch(failed);
      await answered(sent.ref, text);
      scheduleProofs(ctx, item);
      return { ref: sent.ref };
    }
    const ch = channelsFor(deps, ctx)(plan.account);
    const comment = ch?.comment;
    if (!ch || !comment) throw new restate.TerminalError("this site can't answer comments");
    const findSent = ch.findSent;
    const to = plan.comment.ref;
    const sent = await sendAtMostOnce(ctx, deps.db, {
      item,
      platform: plan.account.platform,
      account: plan.account.account,
      words,
      target: to,
      url: plan.comment.url,
      again,
      look: findSent && ((since) => findSent({ kind: "comment", to, text: words, since })),
      before: async () => {
        const authors = (await ch.threadAuthors?.(plan.comment.post)) ?? [];
        await terminal(async () => checkThread(authors, plan.others));
      },
      send: () => comment(to, words),
    }).catch(failed);
    await answered(sent.ref, words);
    scheduleProofs(ctx, item);
    wakeWatch(ctx);
    return { ref: sent.ref };
  };
  return restate.service({
    name: "ReachDesk",
    handlers: {
      accounts: serviceHandler(
        { input: z.looseObject({ client: CLIENT }).nullish() },
        async (
          ctx: restate.Context,
          req?: { client?: string | null } | null,
        ): Promise<AccountView[]> => {
          const now = await nowOf(ctx);
          const db = dbOf(req?.client);
          const rows = await ctx.run("accounts", () => listAccounts(db));
          return rows.map((a) => viewOf(a, deps.policy, now));
        },
      ),
      addAccount: serviceHandler(
        { input: ADD_ACCOUNT },
        async (
          ctx: restate.Context,
          req: { platform: string; account: string },
        ): Promise<AccountView> => {
          const now = await nowOf(ctx);
          const row = await ctx.run("add account", () =>
            terminal(() =>
              addAccount(deps.db, {
                platform: platformOf(req.platform),
                account: req.account,
                now,
              }),
            ),
          );
          return viewOf(row, deps.policy, now);
        },
      ),
      setAccountState: serviceHandler(
        { input: ACCOUNT_STATE },
        async (
          ctx: restate.Context,
          req: { id: string; state: AccountState; reason?: string | null; client?: string | null },
        ): Promise<AccountView> => {
          const now = await nowOf(ctx);
          const db = dbOf(req.client);
          const row = await ctx.run("set state", () =>
            terminal(() =>
              setAccountState(db, req.id, req.state, { reason: req.reason ?? null, now }),
            ),
          );
          return viewOf(row, deps.policy, now);
        },
      ),
      /** One account's health now (platform read, then stored). */
      health: serviceHandler(
        { input: z.looseObject({ id: z.string() }) },
        async (ctx: restate.Context, req: { id: string }): Promise<AccountView> => {
          const now = await nowOf(ctx);
          const a = await ctx.run("account", () => terminal(() => accountById(deps.db, req.id)));
          const ch = channelsFor(deps, ctx)(a);
          if (!ch) throw new restate.TerminalError(`no channel for ${a.platform}`);
          const h = await ch.health();
          await ctx.run("store health", () =>
            refreshHealth(deps.db, [a], () => ({ ...ch, health: async () => h }), now),
          );
          const fresh = await ctx.run("account again", () => accountById(deps.db, req.id));
          return viewOf(fresh, deps.policy, now);
        },
      ),
      /** Search as an account; what it found is kept as `new` contacts. */
      find: serviceHandler(
        { input: FIND },
        async (
          ctx: restate.Context,
          req: {
            accountId: string;
            query: string;
            limit?: number;
            cursor?: string | null;
            niche?: string | null;
          },
        ): Promise<{ found: Found; added: AddStats }> => {
          if (req.niche && deps.heldNiches.includes(req.niche))
            throw new restate.TerminalError(`niche ${req.niche} is held`);
          const a = await ctx.run("account", () =>
            terminal(() => accountById(deps.db, req.accountId)),
          );
          const ch = channelsFor(deps, ctx)(a);
          if (!ch) throw new restate.TerminalError(`no channel for ${a.platform}`);
          const found = await ch.find({
            query: req.query,
            limit: Math.min(req.limit ?? 25, 100),
            cursor: req.cursor ?? null,
          });
          const added = await ctx.run("add prospects", () =>
            addProspects(deps.db, a.platform, found.prospects, { niche: req.niche ?? null }),
          );
          return { found, added };
        },
      ),
      addContact: serviceHandler(
        { input: ADD_CONTACT },
        async (
          ctx: restate.Context,
          req: { platform: string; handle: string; name?: string | null; niche?: string | null },
        ): Promise<ReachContact> =>
          ctx.run("add contact", () =>
            terminal(() => addContact(deps.db, { ...req, platform: platformOf(req.platform) })),
          ),
      ),
      contacts: serviceHandler(
        { input: CONTACTS },
        async (
          ctx: restate.Context,
          req: { platform?: string | null; state?: ContactState | null; limit?: number } = {},
        ): Promise<ReachContact[]> =>
          ctx.run("contacts", () =>
            listContacts(deps.db, {
              platform: req.platform ? platformOf(req.platform) : null,
              state: req.state ?? null,
              limit: req.limit ?? 50,
            }),
          ),
      ),
      /** Read one person's page as an account (any active one on the platform when none is given). */
      enrich: serviceHandler(
        { input: ENRICH },
        async (
          ctx: restate.Context,
          req: { contactId: number; accountId?: string | null },
        ): Promise<Profile> => {
          const now = await nowOf(ctx);
          const c = await ctx.run("contact", () =>
            terminal(() => contactById(deps.db, req.contactId)),
          );
          const a = await ctx.run("account", () =>
            terminal(async () => {
              if (req.accountId) return accountById(deps.db, req.accountId);
              if (c.accountId) return accountById(deps.db, c.accountId);
              if (!isReachPlatform(c.platform))
                throw new ReachRefusal("reads through the client's connected account");
              const [first] = await listAccounts(deps.db, c.platform);
              if (!first) throw new ReachRefusal(`no ${c.platform} account to read with`);
              return first;
            }),
          );
          const ch = channelsFor(deps, ctx)(a);
          if (!ch) throw new restate.TerminalError(`no channel for ${a.platform}`);
          const profile = await ch.enrich(c.handle);
          await ctx.run("store profile", () =>
            enrichContact(deps.db, c, { ...ch, enrich: async () => profile }, now),
          );
          return profile;
        },
      ),
      enroll: serviceHandler(
        { input: ENROLL, effect: "sends" },
        async (
          ctx: restate.Context,
          req: {
            sequence: string;
            limit?: number;
            contactIds?: number[];
            enrichedOnly?: boolean;
            niche?: string | null;
          },
        ): Promise<EnrollStats> => {
          const seq = deps.sequences.get(req.sequence);
          if (!seq) throw new restate.TerminalError(`no sequence ${req.sequence}`);
          if (req.niche && deps.heldNiches.includes(req.niche))
            throw new restate.TerminalError(`niche ${req.niche} is held`);
          const now = await nowOf(ctx);
          const stats = await ctx.run("enroll", () =>
            terminal(() =>
              enroll(deps.db, {
                sequence: seq,
                sender: deps.senderName,
                limit: req.limit ?? 20,
                ...(req.contactIds ? { contactIds: req.contactIds } : {}),
                ...(req.enrichedOnly ? { enrichedOnly: true } : {}),
                now,
              }),
            ),
          );
          if (stats.enrolled > 0) nudge(ctx);
          return stats;
        },
      ),
      /** Each draft model's record on reach drafts, and the verdict (designs/2026-10-14-draft-models.md). */
      draftModels: serviceHandler(
        { input: DRAFT_MODELS },
        async (ctx: restate.Context, req: { since?: string | null } = {}): Promise<Scorecard> => {
          const now = await nowOf(ctx);
          const since = parseSince(req?.since ?? "30d", now);
          if (!since) throw new restate.TerminalError("since is a day count like 30d, or a date");
          return ctx.run("draft models", () => draftScorecard(deps.db, since));
        },
      ),
      templates: serviceHandler(
        { input: NO_INPUT },
        async (ctx: restate.Context): Promise<SlotView[]> =>
          ctx.run("templates", () => listTemplates(deps.db, slots, deps.senderName)),
      ),
      setTemplate: serviceHandler(
        { input: SET_TEMPLATE },
        async (
          ctx: restate.Context,
          req: Omit<SetTemplate, "by"> & { by?: string | null; viewer?: { email?: string } },
        ): Promise<SlotView> => {
          const by = req.by ?? req.viewer?.email ?? "console";
          return ctx.run("set template", () =>
            terminal(() =>
              setTemplate(deps.db, { slots, sender: deps.senderName }, { ...req, by }),
            ),
          );
        },
      ),
      threads: serviceHandler(
        { input: THREADS },
        async (ctx: restate.Context, req: ThreadFilter = {}): Promise<ThreadSummary[]> =>
          ctx.run("threads", () => listThreads(deps.db, req ?? {})),
      ),
      thread: serviceHandler(
        { input: CONTACT },
        async (ctx: restate.Context, req: { contactId: number }): Promise<Thread> =>
          ctx.run("thread", () => terminal(() => getThread(deps.db, req.contactId))),
      ),
      markRead: serviceHandler(
        { input: CONTACT },
        async (ctx: restate.Context, req: { contactId: number }): Promise<void> => {
          const now = await nowOf(ctx);
          await ctx.run("mark read", () => markRead(deps.db, req.contactId, now));
        },
      ),
      /** Queue a message on a thread; the sender is nudged so it leaves on the next tick. */
      reply: serviceHandler(
        { input: REPLY, effect: "sends" },
        async (
          ctx: restate.Context,
          req: { contactId: number; body?: string | null; subject?: string | null },
        ): Promise<{ messageId: number }> => {
          const now = await nowOf(ctx);
          const msg = await ctx.run("queue", () =>
            terminal(async () => {
              const contact = await contactById(deps.db, req.contactId);
              if (contact.state === "opted_out") throw new ReachRefusal("they asked to stop");
              return queueDraft(deps.db, contact, req.body, req.subject ?? null, now, byOf(req));
            }),
          );
          await ctx.run("mark read", () => markRead(deps.db, req.contactId, now));
          nudge(ctx);
          return { messageId: msg.id };
        },
      ),
      /**
       * Answer a comment in its thread, as the account that read it, or through `Content.reply` on
       * our own post. Sent now: the click is the yes.
       */
      answerComment: serviceHandler(
        { input: ANSWER, effect: "sends" },
        (ctx: restate.Context, req: { id: number; body?: string | null; again?: boolean }) =>
          answerOne(ctx, req.id, req.body ?? null, byOf(req), req.again === true),
      ),
      /**
       * Reply to any comment in a thread's conversation (designs/2026-10-15-engage-threads.md):
       * one the inbox kept, or one only the thread read saw, kept now so it answers like any
       * other. `id` is the row the conversation was opened from; `account`, a Send as pick.
       */
      replyInThread: serviceHandler(
        { input: THREAD_REPLY, effect: "sends" },
        async (
          ctx: restate.Context,
          req: { id: number; ref: string; body?: string | null; account?: string | null },
        ): Promise<{ id: number; ref: string | null }> => {
          const target = await ctx.run("target", () =>
            terminal(() => adoptNode(deps.db, req.id, req.ref)),
          );
          if (req.account)
            await ctx.run("send as", () =>
              terminal(() =>
                pickAccount(deps.db, {
                  item: `comment:${target}`,
                  account: req.account ?? null,
                  by: byOf(req),
                }),
              ),
            );
          const sent = await answerOne(ctx, target, req.body ?? null, byOf(req));
          return { id: target, ...sent };
        },
      ),
      /** Read a thread's conversation again now, on the reads budget: the context view's refresh. */
      readThread: serviceHandler(
        { input: ANSWER },
        async (ctx: restate.Context, req: { id: number }): Promise<{ read: boolean }> => {
          const now = await nowOf(ctx);
          const found = await ctx.run("thread", () =>
            terminal(() => threadFor(deps.db, req.id, now)),
          );
          if (!found) return { read: false };
          const got = { ...found, thread: asThread(found.thread) };
          const a = got.account;
          const ch = channelsFor(deps, ctx)(a);
          if (!ch?.thread) return { read: false };
          const ours = await ctx.run("ours", async () =>
            (await listAccounts(deps.db)).flatMap((x) => (x.handle ? [x.handle] : [])),
          );
          let read = await ch.thread(got.thread.post).catch((err) => {
            throw finalRefusal(err);
          });
          if (read.more > 0)
            for (const focus of focusesOf(read, ours))
              read = mergeReads(read, [await ch.thread(got.thread.post, focus)]);
          const r = ctx.rand.random();
          const days = await ctx.run("follow-up days", async () =>
            Math.max(1, (await wrenCommentsRead(deps.db)).followUpDays),
          );
          const applied = await ctx.run("apply", () =>
            applyThread(deps.db, got.thread, a, read, ours, now, r, days),
          );
          if (applied.kept.length)
            spineEmit(ctx, {
              client: null,
              workflow: COMMENTS_FLOW,
              from: COMMENTS_FROM,
              events: applied.kept.map(commentEvent),
            });
          return { read: true };
        },
      ),
      /**
       * Warm `answerComment` while it waits on a yes: on our own post, `Content.arm` runs its
       * browser leg to the reply box. A reach account's answer is not armed. Never fails.
       */
      armComment: serviceHandler(
        { input: ANSWER },
        async (
          ctx: restate.Context,
          req: { id: number; body?: string | null },
        ): Promise<{ armed: boolean }> => {
          const now = await nowOf(ctx);
          // A comment that can't be answered now arms nothing; the yes says why.
          const plan = await ctx.run("plan", () =>
            planAnswer(deps.db, req.id, now).catch(() => null),
          );
          const text = (req.body ?? plan?.comment.draft ?? "").trim();
          if (!plan || plan.account || !text) return { armed: false };
          return ctx.serviceClient<ContentReply>({ name: "Content" }).arm({
            platform: plan.comment.platform,
            commentId: plan.comment.ref,
            postId: plan.comment.post,
            text,
          });
        },
      ),
      /**
       * One DM to the comment's author through its door (`dmDoorOf`): on our own Instagram or
       * Facebook post, Meta's private reply now; on a reach inbox, queued for the sender (its
       * window and caps); anywhere else refused with what to do instead.
       */
      dmComment: serviceHandler(
        { input: DM, effect: "sends" },
        async (
          ctx: restate.Context,
          req: { id: number; body: string },
        ): Promise<{ contactId: number; messageId: number }> => {
          const now = await nowOf(ctx);
          const body = req.body.trim();
          if (!body) throw new restate.TerminalError("the message is empty");
          const c = await ctx.run("comment", () => terminal(() => commentById(deps.db, req.id)));
          if (!c.accountId) {
            await ctx.run("plan", () => terminal(() => planPrivateReply(deps.db, req.id, now)));
            const sent = await ctx
              .serviceClient<ContentReply>({ name: "Content" })
              .privateReply({ platform: c.platform, commentId: c.ref, text: body });
            return ctx.run("sent", () =>
              privateReplied(deps.db, c, { body, ref: sent.ref, now, by: byOf(req) }),
            );
          }
          const r = await ctx.run("queue", () =>
            terminal(() => dmCommenter(deps.db, { id: req.id, body: req.body, now })),
          );
          nudge(ctx);
          return r;
        },
      ),
      dropComment: serviceHandler(
        { input: COMMENT },
        async (ctx: restate.Context, req: { id: number; reason?: unknown; note?: unknown }) => {
          const why = terminalWhy(req);
          await ctx.run("drop", () => dropComment(deps.db, req.id, { by: byOf(req), ...why }));
        },
      ),
      /** Withdraw one pending LinkedIn invite now. It reads the profile first. */
      withdrawInvite: serviceHandler(
        { input: CONTACT, effect: "sends" },
        async (ctx: restate.Context, req: { contactId: number }): Promise<{ outcome: string }> => {
          const now = await nowOf(ctx);
          const { contact, account, days } = await ctx.run("contact", () =>
            terminal(async () => {
              const contact = await contactById(deps.db, req.contactId);
              if (!contact.accountId) throw new ReachRefusal("never invited");
              const account = await accountById(deps.db, contact.accountId);
              return { contact, account, days: (await inviteSettings(deps.db)).withdrawAfterDays };
            }),
          );
          const ch = channelsFor(deps, ctx)(account);
          if (!ch?.withdraw) throw new restate.TerminalError("this site has no invites");
          const r = await ch.withdraw(contact.handle);
          const outcome = await ctx.run("apply", () =>
            applyWithdraw(deps.db, contact.id, r, days, now),
          );
          return { outcome };
        },
      ),
      /** The invites pass now: accepts, stale withdrawn, tomorrow's proposed for his yes. */
      invites: serviceHandler(
        { input: NO_INPUT, effect: "sends" },
        async (ctx: restate.Context): Promise<InvitesPass | { off: string }> => {
          const now = await nowOf(ctx);
          const settings = await ctx.run("invite settings", () => inviteSettings(deps.db));
          const accounts = await ctx.run("accounts", () => listAccounts(deps.db));
          const a = invitesAccount(accounts, settings);
          if (!a)
            return {
              off: settings.account
                ? `${settings.account} is not an active LinkedIn account in reach`
                : "no account set in Shop → LinkedIn invites",
            };
          return invitesPass(deps, ctx, a, settings, now);
        },
      ),
      /** Invites the sweep proposed, waiting on his yes. */
      proposedInvites: serviceHandler(
        { input: NO_INPUT },
        async (ctx: restate.Context): Promise<ProposedInvite[]> =>
          ctx.run("proposed", () => proposedInvites(deps.db)),
      ),
      /** His yes on proposed invites: queued, sent by the tick under the day's cap and ramp. */
      approveInvites: serviceHandler(
        { input: INVITE_APPROVE, effect: "sends" },
        async (
          ctx: restate.Context,
          req: { ids: number[]; note?: string | null; viewer?: unknown },
        ): Promise<{ approved: number[] }> => {
          const now = await nowOf(ctx);
          const by = byOf(req);
          const approved = await ctx.run("approve", async () => {
            const [one] = req.ids;
            if (typeof req.note === "string" && req.ids.length === 1 && one !== undefined)
              await setInviteNote(deps.db, one, req.note, by);
            const ids = await approveInvites(deps.db, req.ids, now);
            await recordNote(deps.db, ids, "approved", by);
            return ids;
          });
          if (approved.length === 0)
            throw new restate.TerminalError("no proposed invite among these: already answered?", {
              errorCode: 409,
            });
          nudge(ctx);
          return { approved };
        },
      ),
      /** His no: skipped, and the person is never proposed again. */
      skipInvites: serviceHandler(
        { input: INVITE_IDS },
        async (
          ctx: restate.Context,
          req: { ids: number[]; viewer?: unknown },
        ): Promise<{ skipped: number[] }> => {
          const now = await nowOf(ctx);
          return {
            skipped: await ctx.run("skip", async () => {
              const ids = await skipInvites(deps.db, req.ids, now);
              await recordNote(deps.db, ids, "rejected", byOf(req));
              return ids;
            }),
          };
        },
      ),
      /**
       * Comment on someone else's post: his words, or the draft he left untouched. The click is
       * the yes. LinkedIn and X go through the content channel as Wren's page; Instagram through
       * the settings' account. Then the like and follow the settings ask for, as that account;
       * neither fails the comment.
       */
      commentPost: serviceHandler(
        { input: POST, effect: "sends" },
        async (
          ctx: restate.Context,
          req: { id: number; body?: string | null; at?: string | null; again?: boolean },
        ): Promise<{ commented: number; held?: string }> => {
          const now = await nowOf(ctx);
          const at = req.at;
          if (at && !(await ctx.run("due", () => stillDue(deps.db, "post", String(req.id), at))))
            return { commented: 0, held: "taken off the schedule" };
          const post = await ctx.run("plan", () =>
            terminal(() => planPostComment(deps.db, req.id)),
          );
          const body = (req.body ?? post.draft ?? "").trim();
          if (!body) throw new restate.TerminalError("the comment is empty");
          const max = COMMENT_MAX[post.platform];
          if (body.length > max)
            throw new restate.TerminalError(`${post.platform} takes ${max} characters at most`);
          const settings = await ctx.run("settings", () =>
            commentsSettings(deps.db, post.platform),
          );
          // A person's pick on the draft, else the comments settings' account.
          const picked = await ctx.run("account", () =>
            pickedAccount(deps.db, `onpost:${post.id}`),
          );
          const account = picked || settings.account || null;
          const acts = postActs(post, settings, body);
          const sites = deps.sitesFor(ctx);
          const item = `onpost:${post.id}`;
          try {
            if (acts.comment && !account)
              throw new restate.TerminalError(`no ${post.platform} account is set for comments`);
            const viaSite = acts.comment;
            // At most once (designs/2026-10-16-maybe-sent.md). Instagram's comment goes through
            // the site with nothing to read it back by; LinkedIn and X through `Content.reply`.
            await sendAtMostOnce(ctx, deps.db, {
              item,
              platform: post.platform,
              account,
              words: body,
              target: post.ref,
              url: post.url,
              again: req.again === true,
              look: viaSite
                ? undefined
                : contentLook(ctx, {
                    platform: post.platform,
                    post: post.ref,
                    parent: null,
                    text: body,
                  }),
              send: async () => {
                if (viaSite) {
                  const [site, method, path, input] = viaSite;
                  await sites.call(site, method, path, input, account ?? undefined);
                } else
                  await ctx
                    .serviceClient<ContentReply>({ name: "Content" })
                    .reply({ platform: post.platform, commentId: post.ref, text: body });
                return { ref: null };
              },
            });
          } catch (thrown) {
            if (isSendUnsure(thrown)) {
              if (at) await ctx.run("hold", () => unschedule(deps.db, { posts: [post.id] }));
              throw thrown;
            }
            const err = sendError(thrown);
            // A slot that fails for good leaves the schedule, or it would sit queued forever.
            if (at && err instanceof restate.TerminalError)
              await ctx.run("send failed", () =>
                sendFailed(deps.db, "post", String(req.id), err.message),
              );
            throw err;
          }
          await ctx.run("commented", () =>
            markPostCommented(deps.db, post, { body, by: byOf(req), now }),
          );
          scheduleProofs(ctx, item);
          for (const [what, act] of [
            ["like", acts.like],
            ["follow", acts.follow],
          ] as const) {
            if (!act || !account) continue;
            try {
              const [site, method, path, input] = act;
              await sites.call(site, method, path, input, account);
              await ctx.run(what, () => markPostActed(deps.db, post.id, what, now));
            } catch (err) {
              console.warn(`post ${post.id} ${what}: ${errorText(err)}`);
            }
          }
          return { commented: post.id };
        },
      ),
      /**
       * Settle a send that may have gone through and no read could tell (it waits in To approve):
       * `posted` records it as sent; `again` sends it once more through its own handler, which
       * reads the site first. Wren's own sends only.
       */
      settleSend: serviceHandler(
        { input: SETTLE_SEND, effect: "sends" },
        async (
          ctx: restate.Context,
          req: { item: string; outcome: "posted" | "again"; viewer?: unknown },
        ): Promise<{ item: string; outcome: "posted" | "again" }> => {
          const now = await nowOf(ctx);
          const { kind, id } = await ctx.run("item", () =>
            terminal(async () => {
              await unsureItem(deps.db, req.item);
              return itemOf(req.item);
            }),
          );
          if (req.outcome === "posted") {
            const stats = await ctx.run("posted", () =>
              terminal(() =>
                markPosted(deps.db, req.item, {
                  sequences: deps.sequences,
                  sender: deps.senderName,
                  by: byOf(req),
                  now,
                }),
              ),
            );
            // A DM's sequence step leaves its node, as the sender's would.
            for (const s of stats.stepped)
              spineEmit(ctx, {
                client: null,
                workflow: cadenceId(s.sequence),
                from: `s${s.step}.sent`,
                events: [reachLead(s.contactId)],
              });
            if (kind !== "dm") scheduleProofs(ctx, req.item);
            return { item: req.item, outcome: "posted" };
          }
          if (kind === "dm") {
            await ctx.run("requeue", () => terminal(() => requeueDm(deps.db, Number(id), now)));
            nudge(ctx);
            return { item: req.item, outcome: "again" };
          }
          const desk = ctx.serviceClient<DeskSends>({ name: "ReachDesk" });
          const again = { again: true as const, viewer: req.viewer };
          if (kind === "thread") await desk.commentThread({ id, ...again });
          else if (kind === "comment") await desk.answerComment({ id: Number(id), ...again });
          else await desk.commentPost({ id: Number(id), ...again });
          return { item: req.item, outcome: "again" };
        },
      ),
      /**
       * A like on the post or a follow of its author on its own, as the comments settings'
       * account: the click is the yes. A touch like the one that goes with a comment.
       */
      actOnPost: serviceHandler(
        { input: POST_ACT, effect: "sends" },
        async (
          ctx: restate.Context,
          req: { id: number; act: "like" | "follow" },
        ): Promise<{ id: number; act: "like" | "follow" }> => {
          const now = await nowOf(ctx);
          const post = await ctx.run("plan", () =>
            terminal(() => planPostAct(deps.db, req.id, req.act)),
          );
          const settings = await ctx.run("settings", () =>
            commentsSettings(deps.db, post.platform),
          );
          if (!settings.account)
            throw new restate.TerminalError(`no ${post.platform} account is set for comments`, {
              errorCode: 409,
            });
          const acts = postActs(
            post,
            { like: req.act === "like", follow: req.act === "follow" },
            "",
          );
          const act = acts[req.act];
          if (!act)
            throw new restate.TerminalError("that post's author has no handle to follow", {
              errorCode: 409,
            });
          const [site, method, path, input] = act;
          await deps.sitesFor(ctx).call(site, method, path, input, settings.account);
          await ctx.run(req.act, () => markPostActed(deps.db, post.id, req.act, now));
          return { id: post.id, act: req.act };
        },
      ),
      /** His no on posts to comment on. */
      /** Pass on the people behind these rows: theirs close now and land closed later. */
      passOn: serviceHandler(
        { input: PASS },
        async (
          ctx: restate.Context,
          req: { ids: string[]; reason: PassReason; note?: string | null },
        ): Promise<{ people: number; closed: number }> => {
          const now = await nowOf(ctx);
          const by = (req as { viewer?: { email?: string } }).viewer?.email ?? byOf(req);
          return ctx.run("pass", () =>
            passOn(deps.db, req.ids, { reason: req.reason, note: req.note ?? null, by, now }),
          );
        },
      ),
      liftPass: serviceHandler(
        { input: LIFT },
        async (ctx: restate.Context, req: { platform: string; handle: string }) => {
          const now = await nowOf(ctx);
          return {
            lifted: await ctx.run("lift", () => liftPass(deps.db, req.platform, req.handle, now)),
          };
        },
      ),
      passes: serviceHandler({ input: z.looseObject({}).nullish() }, async (ctx: restate.Context) =>
        ctx.run("passes", () => listPasses(deps.db)),
      ),
      skipPost: serviceHandler(
        { input: POST_IDS },
        async (
          ctx: restate.Context,
          req: { ids: number[]; by?: unknown; reason?: unknown; note?: unknown },
        ): Promise<{ skipped: number[] }> => {
          const why = terminalWhy(req);
          // The portal's viewer when there is one; else who the CLI names.
          const by =
            (req as { viewer?: { email?: string } }).viewer?.email ??
            (typeof req.by === "string" && req.by.trim() ? req.by.trim().slice(0, 200) : byOf(req));
          return {
            skipped: await ctx.run("skip", () => skipPost(deps.db, req.ids, { by, ...why })),
          };
        },
      ),
      /**
       * Write queued drafts again from the posts kept at read time (no platform read): ranked
       * again, guarded, and the new words replace the old in To approve. One now off target, or
       * one the guard drops, leaves To approve.
       */
      redraftPosts: serviceHandler(
        { input: POST_IDS },
        async (ctx: restate.Context, req: { ids: number[] }): Promise<RedraftResult> => {
          const llm = deps.drafts?.llm;
          if (!llm) throw new restate.TerminalError("no model is set for drafts");
          const now = await nowOf(ctx);
          const settings = await ctx.run("settings", () => allCommentsSettings(deps.db));
          const guide = deps.drafts?.commentGuide;
          const guides = guide
            ? await ctx.run("guides", async () =>
                Object.fromEntries(
                  await Promise.all(REACH_POST_PLATFORMS.map(async (p) => [p, await guide(p)])),
                ),
              )
            : {};
          const facts = deps.drafts?.facts;
          const truths = facts ? await ctx.run("facts", async () => [...(await facts())]) : [];
          const oursOf = deps.drafts?.ours;
          const ours = oursOf ? await ctx.run("our posts", async () => [...(await oursOf())]) : [];
          const out: RedraftResult = { redrafted: [], dropped: [], skipped: [] };
          // One step a post: a retry after a crash does not ask the model twice for one done.
          for (const id of [...new Set(req.ids)]) {
            const r = await ctx.run(`redraft ${id}`, () =>
              redraftPosts(deps.db, llm, [id], {
                settings,
                guides,
                facts: truths,
                ours,
                ...(deps.drafts?.voice ? { voice: deps.drafts.voice } : {}),
                now,
              }),
            );
            out.redrafted.push(...r.redrafted);
            out.dropped.push(...r.dropped);
            out.skipped.push(...r.skipped);
          }
          return out;
        },
      ),
      /** Posts to comment on, newest first; a state narrows them. */
      posts: serviceHandler(
        { input: POSTS_LIST },
        async (ctx: restate.Context, req?: { state?: string | null; limit?: number | null }) =>
          ctx.run("posts", () =>
            listPosts(deps.db, {
              ...(req?.state ? { state: req.state } : {}),
              ...(req?.limit ? { limit: req.limit } : {}),
            }),
          ),
      ),
      /** The posts pass now on each platform with an account set: read, rank, draft to the cap. */
      postsNow: serviceHandler(
        { input: NO_INPUT },
        async (ctx: restate.Context): Promise<PostsStats[]> => {
          const now = await nowOf(ctx);
          const all = await ctx.run("settings", () => allCommentsSettings(deps.db));
          const out: PostsStats[] = [];
          for (const platform of REACH_POST_PLATFORMS)
            if (all[platform].account)
              out.push(await postsFor(deps, ctx, platform, all[platform], now));
          return out;
        },
      ),
      /** A person from People: their contact, added when new, with a model draft to edit. */
      draftPerson: serviceHandler(
        { input: PERSON },
        async (
          ctx: restate.Context,
          req: { id: string },
        ): Promise<{ contactId: number; draft: string | null }> => {
          const llm = deps.drafts?.llm;
          if (!llm) throw new restate.TerminalError("no model is set for DM drafts");
          const now = await nowOf(ctx);
          const contact = await ctx.run("contact", () =>
            terminal(async () => {
              const c = await personContact(deps.db, req.id);
              await messageAccount(deps.db, c, now);
              return c;
            }),
          );
          // He is waiting on the box: a failed call says so once, not a retry loop.
          const draft = await ctx.run("draft", async () => {
            try {
              return await draftDm(deps.db, llm, contact.id, {
                sender: deps.senderName,
                ...(deps.drafts?.guide ? { guide: deps.drafts.guide } : {}),
                facts: deps.drafts?.facts ? await deps.drafts.facts() : [],
                now,
              });
            } catch (err) {
              throw new restate.TerminalError(`the draft failed: ${errorText(err)}`);
            }
          });
          return { contactId: contact.id, draft };
        },
      ),
      /** Message a person from People, queued like a reply (its window and caps). */
      messagePerson: serviceHandler(
        { input: PERSON_MESSAGE, effect: "sends" },
        async (
          ctx: restate.Context,
          req: { id: string; body?: string | null },
        ): Promise<{ contactId: number; messageId: number }> => {
          const now = await nowOf(ctx);
          const r = await ctx.run("queue", () =>
            terminal(async () => {
              const c = await personContact(deps.db, req.id);
              const a = await messageAccount(deps.db, c, now);
              if (!c.accountId)
                await deps.db
                  .update(reachContacts)
                  .set({ accountId: a.id })
                  .where(eq(reachContacts.id, c.id));
              const msg = await queueDraft(
                deps.db,
                { ...c, accountId: a.id },
                req.body,
                null,
                now,
                byOf(req),
              );
              return { contactId: c.id, messageId: msg.id };
            }),
          );
          nudge(ctx);
          return r;
        },
      ),
      /** Follow a person from People (LinkedIn, X, Instagram) as that site's comments account. */
      followPerson: serviceHandler(
        { input: PERSON, effect: "sends" },
        async (
          ctx: restate.Context,
          req: { id: string },
        ): Promise<{ platform: string; handle: string }> => {
          const now = await nowOf(ctx);
          const who = await ctx.run("plan", () => terminal(() => personFollow(deps.db, req.id)));
          const settings = await ctx.run("settings", () => commentsSettings(deps.db, who.platform));
          if (!settings.account)
            throw new restate.TerminalError(`no ${who.platform} account is set for comments`, {
              errorCode: 409,
            });
          const account = settings.account;
          const [site, method, path, input] = followAct(who.platform, { handle: who.handle });
          await deps.sitesFor(ctx).call(site, method, path, input, account);
          await ctx.run("follow", () => markFollowed(deps.db, who, { account, at: now }));
          return { platform: who.platform, handle: who.handle };
        },
      ),
      /** Invite a person from People on LinkedIn now: `linkedin-invite`, under the ramp. */
      invitePerson: serviceHandler(
        { input: PERSON, effect: "sends" },
        async (ctx: restate.Context, req: { id: string }): Promise<{ contactId: number }> => {
          const now = await nowOf(ctx);
          const contactId = await ctx.run("enroll", () =>
            terminal(async () => invite(await personContact(deps.db, req.id), now)),
          );
          nudge(ctx);
          return { contactId };
        },
      ),
      /**
       * DM them from an Engage row (a thread, a post, a comment, a DM): his words to the author.
       * Not yet connected on LinkedIn, they get an invite and his words wait as the first DM.
       */
      messageFrom: serviceHandler(
        { input: ITEM_MESSAGE, effect: "sends" },
        async (
          ctx: restate.Context,
          req: { id: string; body: string },
        ): Promise<{ contactId: number; sent: "dm" | "invite" }> => {
          const now = await nowOf(ctx);
          const r = await ctx.run("queue", () =>
            terminal(async () => {
              const c = await personContact(deps.db, await itemPerson(deps.db, req.id));
              if (c.platform === "linkedin" && !c.connectedAt) {
                await invite(c, now);
                await deps.db
                  .update(reachContacts)
                  .set({ draft: req.body.trim() })
                  .where(eq(reachContacts.id, c.id));
                return { contactId: c.id, sent: "invite" as const };
              }
              const a = await messageAccount(deps.db, c, now);
              if (!c.accountId)
                await deps.db
                  .update(reachContacts)
                  .set({ accountId: a.id })
                  .where(eq(reachContacts.id, c.id));
              await queueDraft(deps.db, { ...c, accountId: a.id }, req.body, null, now, byOf(req));
              return { contactId: c.id, sent: "dm" as const };
            }),
          );
          nudge(ctx);
          return r;
        },
      ),
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
      ...discoveryHandlers(deps),
      ...pasteHandlers(deps),
      stats: serviceHandler(
        { input: STATS },
        async (
          ctx: restate.Context,
          req: { platform?: string | null; days?: number } = {},
        ): Promise<ReachStats> => {
          const now = await nowOf(ctx);
          return ctx.run("stats", () =>
            reachStats(deps.db, {
              platform: req.platform ? platformOf(req.platform) : null,
              days: req.days ?? 7,
              now,
            }),
          );
        },
      ),
    },
  });
}

export type ReachSender = ReturnType<typeof makeReachSender>;
export type ReachWatchObject = ReturnType<typeof makeReachWatch>;
export type ReachDeskService = ReturnType<typeof makeReachDesk>;

export {
  type DiscoveryDeps,
  makeRedditReads,
  READS_KEY,
  type RedditReadsObject,
} from "./discovery.js";
export {
  type CommentProofsService,
  makeCommentProofs,
  PROOFS_SERVICE,
  type ProofCheck,
  type ProofsDeps,
  scheduleProofs,
} from "./proofs.js";
export type { Platform };
