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
 *   10DLC campaign once carriers approve it, labels new replies and runs the
 *   health checks; once a fleet day, one summary line.
 */
import * as restate from "@restatedev/restate-sdk";
import { recordedRun } from "@wren/core";
import type { Notifier } from "@wren/core/notify";
import { LAST, makeLoopObject, type PassOutcome, runPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { type ClassifyStats, classifyReplies, labelReply } from "../classify.js";
import { addContact } from "../contacts.js";
import { queueManual, type TickStats, tick } from "../deliver.js";
import { type EnrollStats, enroll } from "../enroll.js";
import { applyEvent } from "../events.js";
import { checkHealth, type HealthPolicy, type HealthReport } from "../health.js";
import { type LiftStats, liftPhones } from "../lift.js";
import { formatPhone } from "../phone.js";
import { fleetDay, type SmsPolicy } from "../policy.js";
import { pauseNumber, poolToday, resumeNumber, type SyncStats, syncNumbers } from "../pool.js";
import type { SmsProvider } from "../provider.js";
import { SmsRefusal } from "../refusal.js";
import { type RegistrationStats, watchRegistration } from "../registration.js";
import type { ContactBasis, Disposition } from "../schema.js";
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
  notifier?: Notifier;
  /** Reply labels are bought only with a real model. */
  llm?: LlmClient | null;
  /** A pinned clock (tests: quiet hours are real). Must return the same instant on replay. Unset = Restate's. */
  clock?: () => Date;
}

async function nowFor(
  ctx: restate.Context | restate.ObjectContext,
  clock?: () => Date,
): Promise<Date> {
  return clock ? clock() : new Date(await ctx.date.now());
}

export function makeSmsSender(deps: SmsDeps) {
  return makeLoopObject<TickStats>("SmsSender", async (ctx) => {
    const now = await nowFor(ctx, deps.clock);
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
      delayAfter: (s) => (s.sent > 0 || s.retried > 0 ? deps.policy.gapSeconds * 1000 : IDLE_MS),
      retryMs: RETRY_MS,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    });
  });
}

export function makeSmsEvents(deps: Pick<SmsDeps, "db" | "provider" | "notifier" | "clock">) {
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
        return ctx.run("apply", () =>
          applyEvent(deps.db, body, event, {
            provider: deps.provider.name,
            now,
            notifier: deps.notifier ?? null,
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
      threads: async (
        ctx: restate.Context,
        req: { filter?: ThreadFilter; limit?: number; offset?: number } = {},
      ): Promise<ThreadSummary[]> => ctx.run("threads", () => listThreads(deps.db, req ?? {})),
      thread: async (ctx: restate.Context, req: { contactId: number }): Promise<Thread | null> =>
        ctx.run("thread", () => getThread(deps.db, req.contactId)),
      markRead: async (ctx: restate.Context, req: { contactId: number }): Promise<void> => {
        const now = await nowOf(ctx);
        await ctx.run("mark read", () => markRead(deps.db, req.contactId, now));
      },
      /** Queue a text on a thread; the sender loop is nudged so it leaves within seconds. */
      reply: async (
        ctx: restate.Context,
        req: { contactId: number; body: string },
      ): Promise<{ messageId: number }> => {
        const now = await nowOf(ctx);
        const msg = await ctx.run("queue", () =>
          terminal(() => queueManual(deps.db, { contactId: req.contactId, body: req.body, now })),
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
      label: async (
        ctx: restate.Context,
        req: { messageId: number; disposition: Disposition },
      ): Promise<void> => {
        const now = await nowOf(ctx);
        await ctx.run("label", () => terminal(() => labelReply(deps.db, { ...req, now })));
      },
      numbers: async (ctx: restate.Context): Promise<NumbersView> => {
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
      syncNumbers: async (ctx: restate.Context): Promise<SyncStats> => {
        const now = await nowOf(ctx);
        return ctx.run("sync numbers", () =>
          terminal(() => syncNumbers(deps.db, deps.provider, deps.policy, now)),
        );
      },
      /** Every text William writes, empty or filled. */
      templates: async (ctx: restate.Context): Promise<SlotView[]> =>
        ctx.run("templates", () => listTemplates(deps.db, slots, deps.senderName)),
      /** Save or clear one; a keyword reply goes live on the provider first. */
      setTemplate: async (ctx: restate.Context, req: SetTemplate): Promise<SlotView> => {
        const now = await nowOf(ctx);
        return ctx.run("set template", () =>
          terminal(() =>
            setTemplate(
              deps.db,
              { provider: deps.provider, slots, sender: deps.senderName, now },
              req,
            ),
          ),
        );
      },
      /** The registration pass now (SmsWatch runs it every 30 minutes). */
      register: async (ctx: restate.Context): Promise<RegistrationStats> => {
        const now = await nowOf(ctx);
        return ctx.run("register", () =>
          watchRegistration(deps.db, deps.provider, deps.campaignId, now),
        );
      },
      pause: async (
        ctx: restate.Context,
        req: { e164: string; reason?: string },
      ): Promise<boolean> => {
        const now = await nowOf(ctx);
        return ctx.run("pause", () =>
          pauseNumber(deps.db, req.e164, req.reason ?? "paused by hand", now),
        );
      },
      resume: async (ctx: restate.Context, req: { e164: string }): Promise<boolean> =>
        ctx.run("resume", () => resumeNumber(deps.db, req.e164)),
      stats: async (
        ctx: restate.Context,
        req: { days?: number; niche?: string } = {},
      ): Promise<SmsStats> => {
        const now = await nowOf(ctx);
        const since = new Date(now.getTime() - (req?.days ?? 30) * 86_400_000);
        return ctx.run("stats", () => smsStats(deps.db, { since, niche: req?.niche ?? null }));
      },
      /** A number added by hand, with the reason it may be texted. Enroll picks it up like any `new` contact. */
      addContact: async (
        ctx: restate.Context,
        req: { phone: string; basis: ContactBasis; why: string; niche?: string },
      ): Promise<{ contactId: number; e164: string; created: boolean }> =>
        ctx.run("add contact", async () => {
          const { contact, created } = await terminal(() => addContact(deps.db, req));
          return { contactId: contact.id, e164: contact.e164, created };
        }),
      /** Lift numbers from crawled pages: plain rows, no spend. Held niches are never read. */
      lift: async (
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
      /** Enroll: carrier lookups cost a fraction of a cent each, so it is journaled whole. */
      enroll: async (
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
    },
  });
}

export interface WatchStats {
  registration: RegistrationStats;
  classify: ClassifyStats | null;
  health: Pick<HealthReport, "paused" | "warnings" | "balanceUsd" | "fleet">;
  summarized: string | null;
}

const SUMMARIZED = "summarized";
const CAMPAIGN = "campaign";

export function makeSmsWatch(deps: SmsDeps) {
  return makeLoopObject<WatchStats>("SmsWatch", async (ctx) => {
    const now = await nowFor(ctx, deps.clock);
    const outcome: PassOutcome<WatchStats> = await runPass(ctx, deps.db, now, {
      name: "sms watch",
      ledger: { command: "sms watch", argv: {} },
      body: async (runId) => {
        const registration = await watchRegistration(deps.db, deps.provider, deps.campaignId, now);
        if (deps.notifier && registration.registered.length > 0)
          await deps.notifier.notify(
            "SMS: US numbers registered",
            `${registration.registered.map(formatPhone).join(", ")} ${registration.registered.length === 1 ? "is" : "are"} on the 10DLC campaign and can text US phones now. The ramp starts today.`,
          );
        const classify = deps.llm ? await classifyReplies(deps.db, deps.llm, { runId, now }) : null;
        const report = await checkHealth(deps.db, {
          now,
          policy: deps.health,
          provider: deps.provider,
          notifier: deps.notifier ?? null,
        });
        return {
          registration,
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
              ? "Carriers approved it. US numbers get attached over the next few watch runs."
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
      ctx.set(LAST, outcome);
    }
    return outcome;
  });
}

export type SmsSender = ReturnType<typeof makeSmsSender>;
export type SmsEventsService = ReturnType<typeof makeSmsEvents>;
export type SmsDeskService = ReturnType<typeof makeSmsDesk>;
export type SmsWatchObject = ReturnType<typeof makeSmsWatch>;
