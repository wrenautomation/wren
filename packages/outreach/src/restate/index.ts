/**
 * Cold outreach on Restate:
 *
 * - `ReachSender/fleet`: the send loop. One pass = one tick (tick.ts) over
 *   the journal: database steps in `ctx.run`, platform calls as journaled
 *   calls to the Mac's desk. Next pass after the gap when it sent, five
 *   minutes when nothing could go. Off until `wren reach queue start`.
 * - `ReachWatch/daily`: every 30 minutes, pulls replies from every account
 *   and reads each account's health (the warmup ladder runs on it).
 * - `ReachDesk`: the operator's reads and writes (accounts, finds, enrich,
 *   enroll, templates, threads), each one journaled.
 */
import * as restate from "@restatedev/restate-sdk";
import { linkedinOutreach } from "@wren/channel-linkedin";
import { redditOutreach } from "@wren/channel-reddit";
import { finishRun, openRun } from "@wren/core";
import type { SiteClient } from "@wren/core/content";
import type { Notifier } from "@wren/core/notify";
import type { Found, OutreachChannel, Profile } from "@wren/core/outreach";
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
import type { Db } from "@wren/db";
import { z } from "zod";
import {
  type AccountView,
  accountById,
  addAccount,
  type HealthStats,
  listAccounts,
  platformOf,
  refreshHealth,
  setAccountState,
  viewOf,
} from "../accounts.js";
import {
  type AddStats,
  addContact,
  addProspects,
  contactById,
  enrichContact,
  listContacts,
} from "../contacts.js";
import { type EnrollStats, enroll } from "../enroll.js";
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
import { queueManual, type TickStats, tick } from "../tick.js";

export const SENDER_KEY = "fleet";
export const WATCH_KEY = "daily";
const IDLE_MS = 5 * 60 * 1000;
const WATCH_EVERY_MS = 30 * 60 * 1000;

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
}

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

export interface WatchStats {
  replies: RepliesStats;
  health: HealthStats;
}

export function makeReachWatch(deps: ReachDeps) {
  return makeLoopObject<WatchStats>("ReachWatch", async (ctx) => {
    const now = await nowFor(ctx, deps.clock);
    const channelFor = channelsFor(deps, ctx);
    const accounts = await ctx.run("accounts", () => listAccounts(deps.db));
    const live = accounts.filter((a) => a.state === "active" || a.state === "warming");
    // Platform reads happen inside these helpers; each account's result is applied in its own step.
    const replies: RepliesStats = { checked: 0, received: 0, optedOut: 0, errors: [] };
    const health: HealthStats = { checked: 0, frozen: [], errors: [] };
    for (const a of live) {
      const ch = channelFor(a);
      if (!ch) continue;
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
    const stats: WatchStats = { replies, health };
    const outcome: PassOutcome<WatchStats> = {
      stats,
      error: null,
      failures: 0,
      delayMs: WATCH_EVERY_MS,
      now: now.toISOString(),
    };
    await setLastPass(ctx, outcome);
    const notifier = deps.notifier;
    if (notifier && (replies.received > 0 || health.frozen.length > 0)) {
      await ctx.run("notify", () =>
        notifier.notify(
          `reach: ${replies.received} new replies${health.frozen.length ? `, paused ${health.frozen.join(", ")}` : ""}`,
          [...replies.errors, ...health.errors].join("\n"),
          health.frozen.length ? "warning" : replies.received > 0 ? "action" : "info",
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
  body: z.string(),
  subject: z.string().nullish().describe("Reddit only"),
});
const STATS = z.looseObject({ platform: PLATFORM.nullish(), days: z.number().nullish() }).nullish();

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
          req: { contactId: number; body: string; subject?: string | null },
        ): Promise<{ messageId: number }> => {
          const now = await nowOf(ctx);
          const msg = await ctx.run("queue", () =>
            terminal(async () => {
              const contact = await contactById(deps.db, req.contactId);
              if (contact.state === "opted_out") throw new ReachRefusal("they asked to stop");
              return queueManual(deps.db, {
                contact,
                body: req.body,
                subject: req.subject ?? null,
                now,
              });
            }),
          );
          await ctx.run("mark read", () => markRead(deps.db, req.contactId, now));
          nudge(ctx);
          return { messageId: msg.id };
        },
      ),
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
export type { Platform };
