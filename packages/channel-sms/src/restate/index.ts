/**
 * The SMS channel on Restate:
 *
 * - `SmsSender/fleet`: the send loop. One pass = one tick (reconcile, then at
 *   most one text per ready number). Next pass after the gap when it sent,
 *   five minutes when nothing could go. Off until `wren sms queue start`.
 * - `SmsEvents.ingest`: every webhook, forwarded by the phone Worker with the
 *   provider's event id as the idempotency key. Applying is idempotent anyway.
 * - `SmsDesk`: the operator's reads and writes, for the phone app and the CLI.
 * - `SmsWatch/daily`: every 30 minutes, attaches waiting US numbers to the
 *   10DLC campaign once carriers approve it, follows up site applicants who
 *   ticked the texts box (form.ts), queues day-before reminders for booked
 *   calls (reminders.ts), labels new replies and runs the health checks; once
 *   a fleet day, one summary line.
 *
 * A client's texts (`sms.texts`) run as `SmsSender/<client>/fleet` and
 * `SmsWatch/<client>/daily` on its database and numbers; its webhooks come in
 * through `SmsEvents.ingestFor`. The desk's templates and reminders take `client`.
 */
import * as restate from "@restatedev/restate-sdk";
import { recordedRun } from "@wren/core";
import { findClient } from "@wren/core/clients";
import { type Notifier, namedFor } from "@wren/core/notify";
import {
  clientOfKey,
  makeLoopObject,
  NO_INPUT,
  type PassOutcome,
  runPass,
  serviceHandler,
  setLastPass,
  stoppedPass,
} from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { z } from "zod";
import type { Bookings } from "../bookings.js";
import { type ClassifyStats, classifyReplies, labelReply } from "../classify.js";
import { type ClientSms, clientSms } from "../clients.js";
import { addContact, startThread } from "../contacts.js";
import { queueManual, type TickStats, tick } from "../deliver.js";
import { type EnrollStats, enroll } from "../enroll.js";
import { applyEvent } from "../events.js";
import { type FormOptions, type FormStats, followUpForms, type SiteSource } from "../form.js";
import { checkHealth, type HealthPolicy, type HealthReport } from "../health.js";
import { type LiftStats, liftPhones } from "../lift.js";
import { formatPhone } from "../phone.js";
import { fleetDay, type SmsPolicy } from "../policy.js";
import { pauseNumber, poolToday, resumeNumber, type SyncStats, syncNumbers } from "../pool.js";
import type { SmsProvider } from "../provider.js";
import {
  type Pusher,
  type PushSubscriptionInput,
  pushOne,
  subscribe,
  unsubscribe,
} from "../push.js";
import { SmsRefusal } from "../refusal.js";
import { type RegistrationStats, watchRegistration } from "../registration.js";
import { type ReminderStats, remindBookings } from "../reminders.js";
import { CONTACT_BASES, type ContactBasis, DISPOSITIONS, type Disposition } from "../schema.js";
import { type SmsStats, smsStats } from "../stats.js";
import {
  listTemplates,
  type SetTemplate,
  type SlotView,
  setTemplate,
  slotsOf,
} from "../template-store.js";
import type { SmsSequence } from "../templates.js";
import {
  getThread,
  listThreads,
  markRead,
  type Thread,
  type ThreadFilter,
  type ThreadSummary,
} from "../threads.js";

export const SENDER_KEY = "fleet";
export const WATCH_KEY = "daily";
const IDLE_MS = 5 * 60 * 1000;
/** No active number: nothing can send, so the loop sleeps long. A new or resumed number wakes it. */
const NO_NUMBER_MS = 6 * 60 * 60 * 1000;

/** The wait after a send pass: the gap while sending, 6 h with no number to send from, else idle. */
export function senderDelayMs(s: TickStats, gapSeconds: number): number {
  if (s.sent > 0 || s.retried > 0) return gapSeconds * 1000;
  return s.activeNumbers === 0 ? NO_NUMBER_MS : IDLE_MS;
}
const RETRY_MS = 15 * 60 * 1000;
const WATCH_EVERY_MS = 30 * 60 * 1000;

export interface SmsDeps {
  db: Db;
  provider: SmsProvider;
  policy: SmsPolicy;
  health: HealthPolicy;
  /** The live gate: false = a real provider sends nothing (the campaign is not approved yet). */
  live: boolean;
  /** The 10DLC campaign US numbers are attached to; null = none to watch. */
  campaignId: string | null;
  sequences: ReadonlyMap<string, SmsSequence>;
  senderName: string;
  heldNiches: readonly string[];
  /** The lander's export, read for form opt-ins. Null = no form follow-up. */
  site?: SiteSource | null;
  /** Asked before a form applicant's first text, and listed for reminders. Null = neither. */
  bookings?: Bookings | null;
  notifier?: Notifier;
  /** Reply alerts on the phone app. Null = off (no push keys). */
  pusher?: Pusher | null;
  /** Reply labels are bought only with a real model. */
  llm?: LlmClient | null;
  /** A pinned clock (tests: quiet hours are real). Must return the same instant on replay. Unset = Restate's. */
  clock?: () => Date;
  /** A client's deps from its plan, for `<client>/…` keys and `client` requests; absent, those refuse. */
  forClient?: ((plan: Extract<ClientSms, { kind: "work" }>) => SmsDeps) | null;
  /** A client's database, for its webhooks (they land even after texts come off). */
  clientDb?: ((client: string) => Db) | null;
}

/** The deps `client` runs on (Wren's for null), or why it has none now. `deps.db` is main. */
async function depsOf(
  ctx: restate.Context | restate.ObjectContext,
  deps: SmsDeps,
  client: string | null,
): Promise<SmsDeps | string> {
  if (!client) return deps;
  const forClient = deps.forClient;
  if (!forClient) throw new restate.TerminalError("client texts are not wired on this worker");
  const plan = await ctx.run("client", () => clientSms(deps.db, client));
  return plan.kind === "gone" ? plan.why : forClient(plan);
}

/** `depsOf` for a desk request: a client with no work is a refusal. */
async function deskDeps(ctx: restate.Context, deps: SmsDeps, client: string | null | undefined) {
  const d = await depsOf(ctx, deps, client ?? null);
  if (typeof d === "string") throw new restate.TerminalError(`${client}: ${d}`);
  return d;
}

async function nowFor(
  ctx: restate.Context | restate.ObjectContext,
  clock?: () => Date,
): Promise<Date> {
  return clock ? clock() : new Date(await ctx.date.now());
}

function formOptions(
  deps: SmsDeps,
  site: SiteSource,
  now: Date,
  runId: string | null,
): FormOptions {
  return {
    site,
    bookings: deps.bookings ?? null,
    sequences: deps.sequences,
    policy: deps.policy,
    provider: deps.provider,
    senderName: deps.senderName,
    heldNiches: deps.heldNiches,
    now,
    runId,
  };
}

/** A new or resumed number: the sender may be in its 6 h sleep. */
function wakeSender(ctx: restate.Context) {
  ctx
    .objectSendClient<{ wake: (c: restate.ObjectContext) => Promise<boolean> }>(
      { name: "SmsSender" },
      SENDER_KEY,
    )
    .wake();
}

export function makeSmsSender(wren: SmsDeps) {
  return makeLoopObject<TickStats>("SmsSender", async (ctx) => {
    const now = await nowFor(ctx, wren.clock);
    const deps = await depsOf(ctx, wren, clientOfKey(ctx.key)?.client ?? null);
    if (typeof deps === "string") return stoppedPass<TickStats>(ctx, now, deps);
    return runPass(ctx, deps.db, now, {
      name: "sms tick",
      ledger: { command: "sms tick", argv: { provider: deps.provider.name, live: deps.live } },
      body: (runId) =>
        tick(deps.db, {
          provider: deps.provider,
          policy: deps.policy,
          live: deps.live,
          sequences: deps.sequences,
          senderName: deps.senderName,
          now,
          runId,
        }),
      delayAfter: (s) => senderDelayMs(s, deps.policy.gapSeconds),
      retryMs: RETRY_MS,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    });
  });
}

/** Say which US numbers just landed on the campaign. */
async function noticeRegistered(notifier: Notifier | undefined, stats: RegistrationStats) {
  if (!notifier || stats.registered.length === 0) return;
  await notifier.notify(
    "SMS: US numbers registered",
    `${stats.registered.map(formatPhone).join(", ")} ${stats.registered.length === 1 ? "is" : "are"} on the 10DLC campaign and can text US phones now. The ramp starts today.`,
  );
}

export function makeSmsEvents(
  deps: Pick<
    SmsDeps,
    "db" | "provider" | "notifier" | "pusher" | "clock" | "campaignId" | "clientDb"
  >,
) {
  return restate.service({
    name: "SmsEvents",
    handlers: {
      /** One webhook body, as the provider sent it. A body we cannot read is terminal: retrying will not help. */
      ingest: async (
        ctx: restate.Context,
        body: unknown,
      ): Promise<{ duplicate: boolean; outcome: string }> => {
        let event: ReturnType<SmsProvider["parseEvent"]>;
        try {
          event = deps.provider.parseEvent(body);
        } catch (err) {
          throw new restate.TerminalError(
            `unreadable webhook: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        const now = await nowFor(ctx, deps.clock);
        const applied = await ctx.run("apply", () =>
          applyEvent(deps.db, body, event, {
            provider: deps.provider.name,
            now,
            notifier: deps.notifier ?? null,
            pusher: deps.pusher ?? null,
          }),
        );
        // Telnyx says when the campaign or a number's attachment changes: run the
        // registration pass now, not at the next watch, so a US number is asked for
        // the moment carriers approve and marked ready the moment it attaches.
        if (!applied.duplicate && event.type.startsWith("10dlc.")) {
          const stats = await ctx.run("register", () =>
            watchRegistration(deps.db, deps.provider, deps.campaignId, now),
          );
          await ctx.run("registered notice", () => noticeRegistered(deps.notifier, stats));
        }
        return applied;
      },
      /**
       * One webhook from a client's messaging profile, into its database. It lands even
       * with texts off: a STOP is kept whatever is installed. Registration waits for its watch.
       */
      ingestFor: async (
        ctx: restate.Context,
        req: { client: string; body: unknown },
      ): Promise<{ duplicate: boolean; outcome: string }> => {
        const clientDb = deps.clientDb;
        if (!clientDb) throw new restate.TerminalError("client texts are not wired on this worker");
        const id = req?.client;
        if (!id) throw new restate.TerminalError("no client");
        const known = await ctx.run("client", async () => (await findClient(deps.db, id)) !== null);
        if (!known) throw new restate.TerminalError(`no such client: ${id}`);
        let event: ReturnType<SmsProvider["parseEvent"]>;
        try {
          event = deps.provider.parseEvent(req.body);
        } catch (err) {
          throw new restate.TerminalError(
            `unreadable webhook: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        const now = await nowFor(ctx, deps.clock);
        const notifier = deps.notifier ? namedFor(deps.notifier, req.client) : null;
        return ctx.run("apply", () =>
          // The phone app reads Wren's threads only: no push for a client's reply.
          applyEvent(clientDb(req.client), req.body, event, {
            provider: deps.provider.name,
            now,
            notifier,
            pusher: null,
          }),
        );
      },
    },
  });
}

export interface NumbersView {
  day: string;
  live: boolean;
  provider: string;
  remaining: number;
  sentToday: number;
  dailyCap: number;
  numbers: {
    e164: string;
    display: string;
    state: string;
    pausedReason: string | null;
    country: string;
    /** ISO time the carriers attached it; null for a US number still waiting (Canada needs none). */
    registeredAt: string | null;
    cap: number;
    sentToday: number;
    rampStartedOn: string;
  }[];
}

const CONTACT = z.looseObject({ contactId: z.number() });
const NUMBER = z.looseObject({ e164: z.string().describe("The number, as +15551234567") });
const NICHE = z.string().nullish();
const THREADS = z
  .looseObject({
    filter: z.enum(["all", "unread", "replied"]).nullish(),
    limit: z.number().nullish(),
    offset: z.number().nullish(),
  })
  .nullish();
const START = z.looseObject({
  phone: z.string(),
  why: z.string().describe("Why this person may be texted; kept on the contact"),
  body: z.string().describe("The first text"),
});
const SUBSCRIBE = z.looseObject({
  subscription: z.looseObject({
    endpoint: z.string(),
    keys: z.looseObject({ p256dh: z.string(), auth: z.string() }),
  }),
  by: z.string().describe("The operator's email"),
});
const LABEL = z.looseObject({ messageId: z.number(), disposition: z.enum(DISPOSITIONS) });
/** Empty = Wren's; a client id = that client's texts (`sms.texts` installed). */
const CLIENT = z
  .looseObject({ client: z.string().nullish().describe("A client's texts; empty = Wren's") })
  .nullish();
const SET_TEMPLATE = z.looseObject({
  key: z.string(),
  body: z.string().describe("Empty clears it"),
  by: z.string().describe("Who saved it"),
  client: z.string().nullish().describe("A client's texts; empty = Wren's"),
});
const STATS = z.looseObject({ days: z.number().nullish(), niche: NICHE }).nullish();
const ADD_CONTACT = z.looseObject({
  phone: z.string(),
  basis: z.enum(CONTACT_BASES).describe("Published on their site, or they opted in"),
  why: z.string(),
  niche: NICHE,
});
const LIFT = z
  .looseObject({ niche: NICHE, limit: z.number().nullish().describe("Documents to read") })
  .nullish();
const ENROLL = z.looseObject({
  sequence: z.string(),
  niche: NICHE,
  limit: z.number().describe("Contacts to enroll"),
});

export function makeSmsDesk(deps: SmsDeps) {
  const terminal = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      // Our own refusals (bad input, opted out) are answers, not outages.
      if (err instanceof SmsRefusal) throw new restate.TerminalError(err.message);
      throw err;
    }
  };
  const nowOf = (ctx: restate.Context) => nowFor(ctx, deps.clock);
  const slots = slotsOf(deps.sequences.values());
  return restate.service({
    name: "SmsDesk",
    handlers: {
      threads: serviceHandler(
        { input: THREADS },
        async (
          ctx: restate.Context,
          req: { filter?: ThreadFilter; limit?: number; offset?: number } = {},
        ): Promise<ThreadSummary[]> => ctx.run("threads", () => listThreads(deps.db, req ?? {})),
      ),
      thread: serviceHandler(
        { input: CONTACT },
        async (ctx: restate.Context, req: { contactId: number }): Promise<Thread | null> => {
          const now = await nowOf(ctx);
          return ctx.run("thread", () =>
            getThread(deps.db, req.contactId, { now, cap: deps.policy.monthlyPerContact }),
          );
        },
      ),
      markRead: serviceHandler(
        { input: CONTACT },
        async (ctx: restate.Context, req: { contactId: number }): Promise<void> => {
          const now = await nowOf(ctx);
          await ctx.run("mark read", () => markRead(deps.db, req.contactId, now));
        },
      ),
      /** Queue a text on a thread; the sender loop is nudged so it leaves within seconds. */
      reply: serviceHandler(
        { input: CONTACT.extend({ body: z.string() }), effect: "sends" },
        async (
          ctx: restate.Context,
          req: { contactId: number; body: string },
        ): Promise<{ messageId: number }> => {
          const now = await nowOf(ctx);
          const msg = await ctx.run("queue", () =>
            terminal(() =>
              queueManual(deps.db, {
                contactId: req.contactId,
                body: req.body,
                now,
                policy: deps.policy,
              }),
            ),
          );
          await ctx.run("mark read", () => markRead(deps.db, req.contactId, now));
          ctx
            .objectSendClient<{ sync: (c: restate.ObjectContext) => Promise<unknown> }>(
              { name: "SmsSender" },
              SENDER_KEY,
            )
            .sync();
          return { messageId: msg.id };
        },
      ),
      /** A new thread from the app: someone who asked to be texted, why, the first words. */
      start: serviceHandler(
        { input: START, effect: "sends" },
        async (
          ctx: restate.Context,
          req: { phone: string; why: string; body: string },
        ): Promise<{ contactId: number; messageId: number }> => {
          const now = await nowOf(ctx);
          const got = await ctx.run("start", () =>
            terminal(() => startThread(deps.db, { ...req, now, policy: deps.policy })),
          );
          ctx
            .objectSendClient<{ sync: (c: restate.ObjectContext) => Promise<unknown> }>(
              { name: "SmsSender" },
              SENDER_KEY,
            )
            .sync();
          return got;
        },
      ),
      /** The key a device subscribes with; null = alerts are off. */
      pushKey: serviceHandler(
        { input: NO_INPUT },
        async (): Promise<{ publicKey: string | null }> => ({
          publicKey: deps.pusher?.publicKey ?? null,
        }),
      ),
      /** Save this device for reply alerts, then send it one so it is known to work. */
      subscribe: serviceHandler(
        { input: SUBSCRIBE },
        async (
          ctx: restate.Context,
          req: { subscription: PushSubscriptionInput; by: string },
        ): Promise<{ pushed: boolean; error: string | null }> => {
          const pusher = deps.pusher;
          if (!pusher) throw new restate.TerminalError("reply alerts are off: no push keys");
          await ctx.run("subscribe", () =>
            terminal(() => subscribe(deps.db, req.subscription, req.by)),
          );
          return ctx.run("first alert", () =>
            pushOne(deps.db, pusher, req.subscription.endpoint, {
              title: "Reply alerts are on",
              body: "You'll get one when someone texts back.",
              url: "/#/",
              tag: "alerts-on",
            }),
          );
        },
      ),
      unsubscribe: serviceHandler(
        { input: z.looseObject({ endpoint: z.string() }) },
        async (ctx: restate.Context, req: { endpoint: string }): Promise<{ removed: boolean }> => ({
          removed: await ctx.run("unsubscribe", () => unsubscribe(deps.db, req.endpoint)),
        }),
      ),
      label: serviceHandler(
        { input: LABEL },
        async (
          ctx: restate.Context,
          req: { messageId: number; disposition: Disposition },
        ): Promise<void> => {
          const now = await nowOf(ctx);
          await ctx.run("label", () => terminal(() => labelReply(deps.db, { ...req, now })));
        },
      ),
      numbers: serviceHandler(
        { input: NO_INPUT },
        async (ctx: restate.Context): Promise<NumbersView> => {
          const now = await nowOf(ctx);
          return ctx.run("numbers", async () => {
            const pool = await poolToday(deps.db, deps.policy, now);
            return {
              day: pool.day,
              live: deps.live,
              provider: deps.provider.name,
              remaining: pool.remaining,
              sentToday: pool.sentToday,
              dailyCap: deps.policy.dailyCap,
              numbers: pool.numbers.map((n) => ({
                e164: n.number.e164,
                display: formatPhone(n.number.e164),
                state: n.number.state,
                pausedReason: n.number.pausedReason,
                country: n.number.country,
                registeredAt: n.number.registeredAt?.toISOString() ?? null,
                cap: n.cap,
                sentToday: n.sentToday,
                rampStartedOn: n.number.rampStartedOn,
              })),
            };
          });
        },
      ),
      syncNumbers: serviceHandler(
        { input: NO_INPUT },
        async (ctx: restate.Context): Promise<SyncStats> => {
          const now = await nowOf(ctx);
          const stats = await ctx.run("sync numbers", () =>
            terminal(() => syncNumbers(deps.db, deps.provider, deps.policy, now)),
          );
          if (stats.added.length > 0) wakeSender(ctx);
          return stats;
        },
      ),
      /** Every text William writes, empty or filled. */
      templates: serviceHandler(
        { input: CLIENT },
        async (ctx: restate.Context, req?: { client?: string | null }): Promise<SlotView[]> => {
          const d = await deskDeps(ctx, deps, req?.client);
          return ctx.run("templates", () => listTemplates(d.db, slots, d.senderName));
        },
      ),
      /** Save or clear one; a keyword reply goes live on the provider first. */
      setTemplate: serviceHandler(
        { input: SET_TEMPLATE },
        async (
          ctx: restate.Context,
          req: SetTemplate & { client?: string | null },
        ): Promise<SlotView> => {
          const now = await nowOf(ctx);
          const d = await deskDeps(ctx, deps, req.client);
          return ctx.run("set template", () =>
            terminal(() =>
              setTemplate(d.db, { provider: d.provider, slots, sender: d.senderName, now }, req),
            ),
          );
        },
      ),
      /** The registration pass now (SmsWatch runs it every 30 minutes). */
      register: serviceHandler(
        { input: NO_INPUT },
        async (ctx: restate.Context): Promise<RegistrationStats> => {
          const now = await nowOf(ctx);
          return ctx.run("register", () =>
            watchRegistration(deps.db, deps.provider, deps.campaignId, now),
          );
        },
      ),
      pause: serviceHandler(
        { input: NUMBER.extend({ reason: z.string().nullish() }) },
        async (ctx: restate.Context, req: { e164: string; reason?: string }): Promise<boolean> => {
          const now = await nowOf(ctx);
          return ctx.run("pause", () =>
            pauseNumber(deps.db, req.e164, req.reason ?? "paused by hand", now),
          );
        },
      ),
      resume: serviceHandler(
        { input: NUMBER },
        async (ctx: restate.Context, req: { e164: string }): Promise<boolean> => {
          const resumed = await ctx.run("resume", () => resumeNumber(deps.db, req.e164));
          if (resumed) wakeSender(ctx);
          return resumed;
        },
      ),
      stats: serviceHandler(
        { input: STATS },
        async (
          ctx: restate.Context,
          req: { days?: number; niche?: string } = {},
        ): Promise<SmsStats> => {
          const now = await nowOf(ctx);
          const since = new Date(now.getTime() - (req?.days ?? 30) * 86_400_000);
          return ctx.run("stats", () => smsStats(deps.db, { since, niche: req?.niche ?? null }));
        },
      ),
      /** A number added by hand, with the reason it may be texted. Enroll picks it up like any `new` contact. */
      addContact: serviceHandler(
        { input: ADD_CONTACT },
        async (
          ctx: restate.Context,
          req: { phone: string; basis: ContactBasis; why: string; niche?: string },
        ): Promise<{ contactId: number; e164: string; created: boolean }> =>
          ctx.run("add contact", async () => {
            const { contact, created } = await terminal(() => addContact(deps.db, req));
            return { contactId: contact.id, e164: contact.e164, created };
          }),
      ),
      /** Lift numbers from crawled pages: plain rows, no spend. Held niches are never read. */
      lift: serviceHandler(
        { input: LIFT },
        async (
          ctx: restate.Context,
          req: { niche?: string; limit?: number } = {},
        ): Promise<LiftStats> =>
          ctx.run("lift", async () => {
            const { stats } = await recordedRun(
              deps.db,
              { command: "sms lift", argv: { ...req }, niche: req?.niche ?? null },
              () =>
                liftPhones(deps.db, {
                  niche: req?.niche ?? null,
                  heldNiches: deps.heldNiches,
                  limit: req?.limit ?? null,
                }),
            );
            return stats;
          }),
      ),
      /** The form follow-up now (SmsWatch runs it every 30 minutes). */
      forms: serviceHandler(
        { input: NO_INPUT, effect: "sends" },
        async (ctx: restate.Context): Promise<FormStats> => {
          const site = deps.site;
          if (!site)
            throw new restate.TerminalError("no form follow-up: WREN_SITE_EXPORT_TOKEN is unset");
          const now = await nowOf(ctx);
          return ctx.run("forms", async () => {
            const { stats } = await terminal(() =>
              recordedRun(deps.db, { command: "sms forms", argv: {} }, (run) =>
                followUpForms(deps.db, formOptions(deps, site, now, run.id)),
              ),
            );
            return stats;
          });
        },
      ),
      /** The reminder pass now (SmsWatch runs it every 30 minutes). */
      reminders: serviceHandler(
        { input: CLIENT, effect: "sends" },
        async (ctx: restate.Context, req?: { client?: string | null }): Promise<ReminderStats> => {
          const d = await deskDeps(ctx, deps, req?.client);
          const bookings = d.bookings;
          if (!bookings)
            throw new restate.TerminalError(
              req?.client
                ? "no reminders: sms.reminders or its cal.com account is missing"
                : "no reminders: WREN_CALCOM_API_KEY is unset",
            );
          const now = await nowOf(ctx);
          return ctx.run("reminders", async () => {
            const { stats } = await terminal(() =>
              recordedRun(d.db, { command: "sms reminders", argv: {} }, (run) =>
                remindBookings(d.db, {
                  bookings,
                  policy: d.policy,
                  senderName: d.senderName,
                  now,
                  runId: run.id,
                }),
              ),
            );
            return stats;
          });
        },
      ),
      /** Enroll: carrier lookups cost a fraction of a cent each, so it is journaled whole. */
      enroll: serviceHandler(
        { input: ENROLL, effect: "sends" },
        async (
          ctx: restate.Context,
          req: { sequence: string; niche?: string; limit: number },
        ): Promise<EnrollStats> => {
          const sequence = deps.sequences.get(req.sequence);
          if (!sequence)
            throw new restate.TerminalError(
              `no sms sequence ${req.sequence} (have: ${[...deps.sequences.keys()].join(", ")})`,
            );
          const now = await nowOf(ctx);
          return ctx.run("enroll", async () => {
            const { stats } = await terminal(() =>
              recordedRun(
                deps.db,
                { command: "sms enroll", argv: { ...req }, niche: req.niche ?? null },
                (run) =>
                  enroll(deps.db, {
                    sequence,
                    policy: deps.policy,
                    provider: deps.provider,
                    senderName: deps.senderName,
                    niche: req.niche ?? null,
                    heldNiches: deps.heldNiches,
                    limit: req.limit,
                    now,
                    runId: run.id,
                  }),
              ),
            );
            return stats;
          });
        },
      ),
    },
  });
}

export interface WatchStats {
  registration: RegistrationStats;
  /** Null = no site to read, or `formsError` says why the read failed. */
  forms: FormStats | null;
  formsError?: string;
  /** Null = no cal.com key, or `remindersError` says why the pass failed. */
  reminders: ReminderStats | null;
  remindersError?: string;
  classify: ClassifyStats | null;
  health: Pick<HealthReport, "paused" | "warnings" | "balanceUsd" | "fleet">;
  summarized: string | null;
}

const SUMMARIZED = "summarized";
const CAMPAIGN = "campaign";

export function makeSmsWatch(wren: SmsDeps) {
  return makeLoopObject<WatchStats>("SmsWatch", async (ctx) => {
    const now = await nowFor(ctx, wren.clock);
    const deps = await depsOf(ctx, wren, clientOfKey(ctx.key)?.client ?? null);
    if (typeof deps === "string") return stoppedPass<WatchStats>(ctx, now, deps);
    const outcome: PassOutcome<WatchStats> = await runPass(ctx, deps.db, now, {
      name: "sms watch",
      ledger: { command: "sms watch", argv: {} },
      body: async (runId) => {
        const registration = await watchRegistration(deps.db, deps.provider, deps.campaignId, now);
        await noticeRegistered(deps.notifier, registration);
        // A site outage costs this pass its form follow-up, not its health checks.
        let forms: FormStats | null = null;
        let formsError: string | undefined;
        if (deps.site) {
          try {
            forms = await followUpForms(deps.db, formOptions(deps, deps.site, now, runId));
          } catch (err) {
            formsError = err instanceof Error ? err.message : String(err);
          }
        }
        let reminders: ReminderStats | null = null;
        let remindersError: string | undefined;
        if (deps.bookings) {
          try {
            reminders = await remindBookings(deps.db, {
              bookings: deps.bookings,
              policy: deps.policy,
              senderName: deps.senderName,
              now,
              runId,
            });
          } catch (err) {
            remindersError = err instanceof Error ? err.message : String(err);
          }
        }
        const classify = deps.llm ? await classifyReplies(deps.db, deps.llm, { runId, now }) : null;
        const report = await checkHealth(deps.db, {
          now,
          policy: deps.health,
          provider: deps.provider,
          notifier: deps.notifier ?? null,
        });
        return {
          registration,
          forms,
          ...(formsError ? { formsError } : {}),
          reminders,
          ...(remindersError ? { remindersError } : {}),
          classify,
          health: {
            paused: report.paused,
            warnings: report.warnings,
            balanceUsd: report.balanceUsd,
            fleet: report.fleet,
          },
          summarized: null,
        };
      },
      delayAfter: () => WATCH_EVERY_MS,
      retryMs: RETRY_MS,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    });
    // The campaign's word, said once each time it changes (a rejection needs a fix by hand).
    const campaign = outcome.stats?.registration.campaign;
    if (deps.notifier && campaign && (await ctx.get<string>(CAMPAIGN)) !== campaign.raw) {
      const notifier = deps.notifier;
      await ctx.run("campaign notice", () =>
        notifier.notify(
          `SMS campaign: ${campaign.raw}`,
          campaign.status === "rejected"
            ? `Rejected (${campaign.detail ?? "no reason given"}). Fix it and resubmit in Telnyx.`
            : campaign.status === "approved"
              ? "Carriers approved it. US numbers get attached within minutes."
              : "Still in review.",
          campaign.status === "rejected" ? "warning" : "info",
        ),
      );
      ctx.set(CAMPAIGN, campaign.raw);
    }
    // One line a fleet day, after 18:00 ET, when anything went out.
    const day = fleetDay(now);
    const hourEt = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hourCycle: "h23",
      }).format(now),
    );
    if (
      deps.notifier &&
      outcome.stats &&
      hourEt >= 18 &&
      (await ctx.get<string>(SUMMARIZED)) !== day
    ) {
      const notifier = deps.notifier;
      const line = await ctx.run("summary", async () => {
        const s = await smsStats(deps.db, { since: new Date(now.getTime() - 86_400_000) });
        if (s.texted === 0) return null;
        const text = `${s.texted} texted · delivered ${s.delivery.text} · replies ${s.reply.text} · opt-outs ${s.optOut.text} · $${s.costUsd.toFixed(2)}`;
        await notifier.notify("SMS today", text);
        return text;
      });
      ctx.set(SUMMARIZED, day);
      outcome.stats.summarized = line;
      await setLastPass(ctx, outcome);
    }
    return outcome;
  });
}

export type SmsSender = ReturnType<typeof makeSmsSender>;
export type SmsEventsService = ReturnType<typeof makeSmsEvents>;
export type SmsDeskService = ReturnType<typeof makeSmsDesk>;
export type SmsWatchObject = ReturnType<typeof makeSmsWatch>;
