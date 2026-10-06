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
import type { Platform as ContentPlatform, SiteClient } from "@wren/core/content";
import type { Notifier } from "@wren/core/notify";
import type { Found, OutreachChannel, Profile } from "@wren/core/outreach";

/** The `Content` service's reply handler as the worker serves it. */
type ContentReply = {
  reply: (
    ctx: restate.Context,
    req: { platform: ContentPlatform; commentId: string; text: string },
  ) => Promise<void>;
};

import {
  errorText,
  lastPass,
  makeLoopObject,
  NO_INPUT,
  type PassOutcome,
  PORTAL_FIELDS,
  serviceHandler,
  setLastPass,
} from "@wren/core/restate";
import { spineEmit } from "@wren/core/spine";
import { COLD_EVERY_MS, warmEveryMs } from "@wren/core/warm";
import { cadenceId } from "@wren/core/workflows";
import type { Db } from "@wren/db";
import type { LlmClient } from "@wren/llm";
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
  COMMENTS_FLOW,
  COMMENTS_FROM,
  checkThread,
  commentEvent,
  dmCommenter,
  dropComment,
  keepComments,
  markAnswered,
  planAnswer,
} from "../comments.js";
import {
  type AddStats,
  addContact,
  addProspects,
  contactById,
  enrichContact,
  listContacts,
} from "../contacts.js";
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
import { messageAccount, personContact } from "../from-people.js";
import {
  applyWithdraw,
  INVITE_SEQUENCE,
  type InviteSettings,
  inviteSettings,
  type SweepStats,
  sweepInvites,
  type TopUpStats,
  topUp,
} from "../invites.js";
import type { ReachPolicy } from "../policy.js";
import { ReachRefusal } from "../refusal.js";
import { pullReplies, type RepliesStats } from "../replies.js";
import {
  ACCOUNT_STATES,
  type AccountState,
  CONTACT_STATES,
  type ContactState,
  type Platform,
  type ReachAccount,
  type ReachContact,
  reachContacts,
} from "../schema.js";
import { type ReachSequence, slotsOf } from "../sequences.js";
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
import { type TickStats, tick } from "../tick.js";
import { discoveryHandlers } from "./discovery.js";

export const SENDER_KEY = "fleet";
export const WATCH_KEY = "daily";
const IDLE_MS = 5 * 60 * 1000;
/** The soonest the watch comes back, whatever is due. */
const WATCH_FLOOR_MS = 60 * 1000;
/** Restate state on `ReachWatch/daily`: each account's last read, epoch ms by account id. */
const READS = "reads";
/** The same for health: it stays on the cold cadence, whatever the inbox does. */
const HEALTH = "health";
/** And for the invites sweep, every 6 hours. */
const INVITES = "invites";
const INVITES_EVERY_MS = 6 * 60 * 60 * 1000;

export interface ReachDeps {
  db: Db;
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
  /** DM drafts: the model and the platform's `dm` SOP. No model, no drafts. */
  drafts?: { llm: LlmClient | null; guide?: DmGuide };
}

/** Wake the watch so a touch's first check comes now, not after a cold sleep. */
export const wakeWatch = (ctx: restate.Context) =>
  ctx
    .objectSendClient<{ wake: (c: restate.ObjectContext) => Promise<unknown> }>(
      { name: "ReachWatch" },
      WATCH_KEY,
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

export function makeReachSender(deps: ReachDeps) {
  return makeLoopObject<TickStats>("ReachSender", async (ctx) => {
    const now = await nowFor(ctx, deps.clock);
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
          now,
          runId,
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
        client: null,
        workflow: cadenceId(s.sequence),
        from: `s${s.step}.sent`,
        events: [reachLead(s.contactId)],
      });
    if (stats && stats.sent > 0) wakeWatch(ctx);
    const previous = await lastPass<PassOutcome<TickStats>>(ctx);
    const failures = stats ? 0 : (previous?.failures ?? 0) + 1;
    const delayMs = stats && stats.sent > 0 ? deps.policy.gapSeconds * 1000 : IDLE_MS;
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
  });
}

export interface InvitesPass {
  account: string;
  sweep: SweepStats;
  topUp: TopUpStats | null;
}

export interface WatchStats {
  replies: RepliesStats;
  comments: { kept: number; errors: string[] };
  health: HealthStats;
  invites: InvitesPass | null;
  drafts: { written: number; errors: string[] };
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
  return { account: a.account, sweep, topUp: top };
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
  for (const id of due) {
    // A failed call is kept as its words, not thrown: the next pass asks again.
    const r = await ctx.run(`draft ${id}`, async () => {
      try {
        const draft = await draftDm(deps.db, llm, id, {
          sender: deps.senderName,
          ...(deps.drafts?.guide ? { guide: deps.drafts.guide } : {}),
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

export function makeReachWatch(deps: ReachDeps) {
  return makeLoopObject<WatchStats>("ReachWatch", async (ctx) => {
    const now = await nowFor(ctx, deps.clock);
    const channelFor = channelsFor(deps, ctx);
    const accounts = await ctx.run("accounts", () => listAccounts(deps.db));
    const live = accounts.filter((a) => a.state === "active" || a.state === "warming");
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
    const everyOf = new Map(
      live.map((a) => {
        const t = touches[a.id];
        return [a.id, warmEveryMs(t ? new Date(t) : null, now, ctx.rand.random())];
      }),
    );
    const isDue = (a: ReachAccount) =>
      now.getTime() - (reads[a.id] ?? 0) >= (everyOf.get(a.id) ?? 0);
    // Platform reads happen inside these helpers; each account's result is applied in its own step.
    const replies: RepliesStats = { checked: 0, received: 0, optedOut: 0, errors: [] };
    const health: HealthStats = { checked: 0, frozen: [], errors: [] };
    const kept: WatchStats["comments"] = { kept: 0, errors: [] };
    const ours = accounts.flatMap((a) => (a.handle ? [a.handle] : []));
    for (const a of live.filter(isDue)) {
      const ch = channelFor(a);
      if (!ch) continue;
      reads[a.id] = now.getTime();
      try {
        const got = await ch.replies(null);
        const r = await ctx.run(`replies ${a.account}`, () =>
          pullReplies(deps.db, [a], () => ({ ...ch, replies: async () => got }), now),
        );
        replies.checked += r.checked;
        replies.received += r.received;
        replies.optedOut += r.optedOut;
      } catch (err) {
        replies.errors.push(`${a.account}: ${errorText(err)}`);
      }
      // The same inbox read: the adapter asks the platform once for both.
      if (ch.comments)
        try {
          const got = await ch.comments();
          const rows = await ctx.run(`comments ${a.account}`, () =>
            keepComments(deps.db, a, got, ours),
          );
          kept.kept += rows.length;
          if (rows.length)
            spineEmit(ctx, {
              client: null,
              workflow: COMMENTS_FLOW,
              from: COMMENTS_FROM,
              events: rows.map(commentEvent),
            });
        } catch (err) {
          kept.errors.push(`${a.account}: ${errorText(err)}`);
        }
      if (now.getTime() - (checked[a.id] ?? 0) < COLD_EVERY_MS) continue;
      checked[a.id] = now.getTime();
      try {
        const h = await ch.health();
        const r = await ctx.run(`health ${a.account}`, () =>
          refreshHealth(deps.db, [a], () => ({ ...ch, health: async () => h }), now),
        );
        health.checked += r.checked;
        health.frozen.push(...r.frozen);
      } catch (err) {
        health.errors.push(`${a.account}: ${errorText(err)}`);
      }
    }
    let invites: InvitesPass | null = null;
    const swept = (await ctx.get<number>(INVITES)) ?? 0;
    if (now.getTime() - swept >= INVITES_EVERY_MS) {
      const settings = await ctx.run("invite settings", () => inviteSettings(deps.db));
      const a = invitesAccount(live, settings);
      if (a) {
        ctx.set(INVITES, now.getTime());
        try {
          invites = await invitesPass(deps, ctx, a, settings, now);
        } catch (err) {
          health.errors.push(`invites ${a.account}: ${errorText(err)}`);
        }
      }
    }
    const drafts = await draftsPass(deps, ctx, now);
    ctx.set(READS, reads);
    ctx.set(HEALTH, checked);
    const stats: WatchStats = { replies, comments: kept, health, invites, drafts };
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
    if (
      notifier &&
      (replies.received > 0 || kept.kept > 0 || accepted > 0 || health.frozen.length > 0)
    ) {
      const news = [
        replies.received ? `${replies.received} new DMs` : null,
        kept.kept ? `${kept.kept} new comments` : null,
        accepted ? `${accepted} accepted invites` : null,
      ].filter(Boolean);
      await ctx.run("notify", () =>
        notifier.notify(
          `reach: ${news.join(", ") || "no news"}${health.frozen.length ? `, paused ${health.frozen.join(", ")}` : ""}`,
          [
            news.length ? "Inbox → Waiting on you" : null,
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
  });
}

const PLATFORM = z.string().describe("reddit or linkedin");
const NICHE = z.string().nullish();
const CONTACT = z.looseObject({ contactId: z.number() });
const ADD_ACCOUNT = z.looseObject({
  platform: PLATFORM,
  account: z.string().describe("The autobrowse credential, e.g. reddit@alt"),
});
const ACCOUNT_STATE = z.looseObject({
  id: z.string(),
  state: z.enum(ACCOUNT_STATES),
  reason: z.string().nullish(),
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
const ANSWER = COMMENT.extend({
  body: z.string().nullish().describe("The words; the console leaves an untouched draft out"),
});
const DM = COMMENT.extend({ body: z.string() });
const PERSON = z.looseObject({
  id: z.string().describe("A People id: li:<people.id> or reddit:<handle>"),
});
const PERSON_MESSAGE = PERSON.extend({
  body: z.string().nullish().describe("The words; the console leaves an untouched draft out"),
});

export function makeReachDesk(deps: ReachDeps) {
  const terminal = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ReachRefusal) throw new restate.TerminalError(err.message);
      throw err;
    }
  };
  const nowOf = (ctx: restate.Context) => nowFor(ctx, deps.clock);
  const slots = slotsOf(deps.sequences.values());
  const nudge = (ctx: restate.Context) =>
    ctx
      .objectSendClient<{ sync: (c: restate.ObjectContext) => Promise<unknown> }>(
        { name: "ReachSender" },
        SENDER_KEY,
      )
      .sync();
  return restate.service({
    name: "ReachDesk",
    handlers: {
      accounts: serviceHandler(
        { input: NO_INPUT },
        async (ctx: restate.Context): Promise<AccountView[]> => {
          const now = await nowOf(ctx);
          const rows = await ctx.run("accounts", () => listAccounts(deps.db));
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
          req: { id: string; state: AccountState; reason?: string | null },
        ): Promise<AccountView> => {
          const now = await nowOf(ctx);
          const row = await ctx.run("set state", () =>
            terminal(() =>
              setAccountState(deps.db, req.id, req.state, { reason: req.reason ?? null, now }),
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
          const now = await nowOf(ctx);
          const by = req.by ?? req.viewer?.email ?? "console";
          return ctx.run("set template", () =>
            terminal(() =>
              setTemplate(deps.db, { slots, sender: deps.senderName, now }, { ...req, by }),
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
              return queueDraft(deps.db, contact, req.body, req.subject ?? null, now);
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
        async (
          ctx: restate.Context,
          req: { id: number; body?: string | null },
        ): Promise<{ ref: string | null }> => {
          const now = await nowOf(ctx);
          const plan = await ctx.run("plan", () =>
            terminal(() => planAnswer(deps.db, req.id, now)),
          );
          const body = (req.body ?? plan.comment.draft ?? "").trim();
          if (!body) throw new restate.TerminalError("the answer is empty");
          if (!plan.account) {
            // On our own post: the content channel answers (designs/2026-10-06-social-inbox.md).
            await ctx
              .serviceClient<ContentReply>({ name: "Content" })
              .reply({ platform: plan.comment.platform, commentId: plan.comment.ref, text: body });
            await ctx.run("answered", () =>
              markAnswered(deps.db, req.id, { body, ref: null, now }),
            );
            return { ref: null };
          }
          const ch = channelsFor(deps, ctx)(plan.account);
          if (!ch?.comment) throw new restate.TerminalError("this site can't answer comments");
          const authors = (await ch.threadAuthors?.(plan.comment.post)) ?? [];
          await terminal(async () => checkThread(authors, plan.others));
          const sent = await ch.comment(plan.comment.ref, body);
          await ctx.run("answered", () =>
            markAnswered(deps.db, req.id, { body, ref: sent.ref, now }),
          );
          wakeWatch(ctx);
          return { ref: sent.ref };
        },
      ),
      /** One DM to the comment's author, queued for the sender (its window and caps). */
      dmComment: serviceHandler(
        { input: DM, effect: "sends" },
        async (
          ctx: restate.Context,
          req: { id: number; body: string },
        ): Promise<{ contactId: number; messageId: number }> => {
          const now = await nowOf(ctx);
          const r = await ctx.run("queue", () =>
            terminal(() => dmCommenter(deps.db, { id: req.id, body: req.body, now })),
          );
          nudge(ctx);
          return r;
        },
      ),
      dropComment: serviceHandler(
        { input: COMMENT },
        async (ctx: restate.Context, req: { id: number }): Promise<void> => {
          await ctx.run("drop", () => dropComment(deps.db, req.id));
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
      /** The invites pass now: accepts, stale withdrawn, tomorrow's queued. */
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
              const msg = await queueDraft(deps.db, { ...c, accountId: a.id }, req.body, null, now);
              return { contactId: c.id, messageId: msg.id };
            }),
          );
          nudge(ctx);
          return r;
        },
      ),
      /** Invite a person from People on LinkedIn now: `linkedin-invite`, under the ramp. */
      invitePerson: serviceHandler(
        { input: PERSON, effect: "sends" },
        async (ctx: restate.Context, req: { id: string }): Promise<{ contactId: number }> => {
          const seq = deps.sequences.get(INVITE_SEQUENCE);
          if (!seq) throw new restate.TerminalError(`no sequence ${INVITE_SEQUENCE}`);
          const now = await nowOf(ctx);
          const contactId = await ctx.run("enroll", () =>
            terminal(async () => {
              const settings = await inviteSettings(deps.db);
              const a = invitesAccount(await listAccounts(deps.db), settings);
              if (!a) throw new ReachRefusal("no active account set in Shop → LinkedIn invites");
              const c = await personContact(deps.db, req.id);
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
                throw new ReachRefusal(
                  (await contactById(deps.db, c.id)).stateReason ?? "not enrolled",
                );
              return c.id;
            }),
          );
          nudge(ctx);
          return { contactId };
        },
      ),
      ...discoveryHandlers(deps),
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
export type { Platform };
