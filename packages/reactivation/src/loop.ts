/**
 * `Reactivation`: one loop per client, keyed by client id. Each pass reads the
 * client's settings, works what is due (verify when it's free, score, briefs,
 * emails), forwards interested and booked replies to the recruiters (R13),
 * fills the client's delivery portal (results, bill, a daily line),
 * then points the client's mailboxes' loops at the settings: an inbox
 * loop per mailbox while the client is on, a send loop per unsuspended mailbox
 * while sending is on. `on` is the one switch; turning it off stops the lot,
 * and the loop keeps looking so turning it on again needs nothing else.
 *
 * `stop` stops every mailbox loop this key started, so `crm loop stop` is one call.
 *
 * Lookup and signals stay `crm run`: they read through a personal account.
 * Each pass does a bounded slice of each stage, so a pass fits one invocation;
 * the next pass picks up the rest.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Transport } from "@wren/channel-email";
import type { InboxScheduler, SendScheduler } from "@wren/channel-email/restate";
import { runFeed } from "@wren/core";
import { type Client, findClient } from "@wren/core/clients";
import { type Notifier, plural } from "@wren/core/notify";
import {
  clientKey,
  errorText,
  failuresInARow,
  lastPass,
  MIN_DELAY_MS,
  makeLoopObject,
  notifyErrorEdges,
  type PassOutcome,
  retryDelayMs,
  runPass,
  setLastPass,
} from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { type FeedStats, feedDelivery } from "./delivery.js";
import { type ForwardStats, forwardHandoffs } from "./forward.js";
import { readVisits, type VisitStats } from "./keep.js";
import { readClientProfile } from "./profile.js";
import { type CrmRunDeps, type CrmStageResult, runCrm } from "./run.js";
import { sendingOff, settingsOrNull } from "./sending.js";
import type { ReactivationSettings } from "./settings.js";
import type { CrmStage } from "./status.js";

export const REACTIVATION_COMMAND = "reactivation pass";

export interface ReactivationLoopDeps {
  /** The client registry. */
  main: Db;
  open(client: Pick<Client, "database">): Db;
  /** What `crm run` uses, minus the personal-account stages. */
  crm: Omit<CrmRunDeps, "sites" | "fetcher">;
  /**
   * The client's model for one pass: its own key or Wren's, metered on its share
   * (designs/2026-10-07-vendor-keys.md). Absent, `crm.llm` as is.
   */
  clientLlm?: ((client: string, llm: LlmClient) => LlmClient) | null;
  /** Verify only when the verifier spends no credits. */
  freeVerify: boolean;
  /** Forwards replies from the client's mailboxes: they are in Wren's Workspace. */
  transport: Transport;
  /** Units per stage per pass (default 10). */
  limit?: number;
  /** Between passes (default 10 min). */
  passMs?: number;
  /** The longest wait after failed passes (default 10 min). */
  retryMs?: number;
  notifier?: Notifier;
}

/** The mailbox loops this client should have running. */
export interface MailboxLoops {
  send: string[];
  inbox: string[];
}

export interface ReactivationPassStats {
  /** Why no stage ran, or null. */
  off: string | null;
  stages: CrmStageResult[];
  /** Replies forwarded this pass; null when `stages.handoff` is off or nothing ran. */
  handoff: ForwardStats | null;
  loops: MailboxLoops;
  /** What went into the client's delivery portal; a failure there never fails the pass. */
  portal?: FeedStats | { error: string };
  /** Forms the client's accounts sent on its site, for Keep; a failure never fails the pass. */
  visits?: VisitStats | { error: string };
}

const STARTED = "started";
/** The step and notice name of a pass. */
const PASS = "reactivation";
const ASSERTED = "asserted";
/** Loops a key already started are started again this often, in case one stopped itself. */
const REASSERT_MS = 60 * 60_000;
const NO_LOOPS: MailboxLoops = { send: [], inbox: [] };

/** From the settings: which mailbox loops should run. */
export function mailboxLoops(
  clientId: string,
  client: Pick<Client, "demo">,
  settings: ReactivationSettings,
): MailboxLoops {
  if (client.demo || !settings.on) return NO_LOOPS;
  const sends = sendingOff(client, settings) === null;
  return {
    send: sends
      ? settings.senders.filter((s) => !s.suspended).map((s) => clientKey(clientId, s.address))
      : [],
    inbox: settings.senders.map((s) => clientKey(clientId, s.address)),
  };
}

/** The stages a pass runs: research and compose as the settings say, verify only when free. */
export function passStages(settings: ReactivationSettings, freeVerify: boolean): CrmStage[] {
  return [
    ...(freeVerify ? (["verify"] as const) : []),
    ...(settings.stages.research ? (["score", "brief"] as const) : []),
    ...(settings.stages.compose ? (["compose"] as const) : []),
  ];
}

type Plan =
  | { kind: "gone"; why: string }
  | { kind: "off"; why: string }
  | { kind: "work"; database: string; settings: ReactivationSettings; loops: MailboxLoops }
  | { kind: "error"; error: string };

async function planFor(main: Db, id: string): Promise<Plan> {
  const client = await findClient(main, id);
  if (!client) return { kind: "gone", why: "no such client" };
  if (client.demo) return { kind: "gone", why: "the demo is never worked" };
  const settings = settingsOrNull(client.products);
  if (!settings) return { kind: "off", why: "the reactivation block does not parse" };
  if (!settings.on) return { kind: "off", why: "reactivation is off" };
  return {
    kind: "work",
    database: client.database,
    settings,
    loops: mailboxLoops(id, client, settings),
  };
}

export function makeReactivation(deps: ReactivationLoopDeps) {
  const limit = deps.limit ?? 10;
  const passMs = deps.passMs ?? 10 * 60_000;
  const retryMs = deps.retryMs ?? 10 * 60_000;

  /** Record a pass the runner did not: the one `status` reads, told like any other. */
  const settle = async (
    ctx: restate.ObjectContext,
    previous: PassOutcome<ReactivationPassStats> | null,
    outcome: PassOutcome<ReactivationPassStats>,
  ): Promise<PassOutcome<ReactivationPassStats>> => {
    const settled = { ...outcome, delayMs: Math.max(outcome.delayMs, MIN_DELAY_MS) };
    await setLastPass(ctx, settled);
    if (deps.notifier) await notifyErrorEdges(ctx, deps.notifier, PASS, previous, settled);
    return settled;
  };

  return makeLoopObject<ReactivationPassStats>(
    "Reactivation",
    async (ctx: restate.ObjectContext): Promise<PassOutcome<ReactivationPassStats>> => {
      const now = new Date(await ctx.date.now());
      const previous = await lastPass<PassOutcome<ReactivationPassStats>>(ctx);
      // A long gap: a mailbox loop may have stopped itself meanwhile, so start them all.
      const resumed = !previous || now.getTime() - Date.parse(previous.now) > 2 * passMs;
      const plan = await ctx.run(
        "client",
        async (): Promise<Plan> =>
          planFor(deps.main, ctx.key).catch((err) => ({ kind: "error", error: errorText(err) })),
      );
      if (plan.kind === "error") {
        // The mailboxes are left as they were: no settings to point them by.
        const failures = await failuresInARow(ctx, true);
        const had = (await ctx.get<MailboxLoops>(STARTED)) ?? NO_LOOPS;
        return settle(ctx, previous, {
          stats: { off: null, stages: [], handoff: null, loops: had },
          error: plan.error,
          failures,
          delayMs: retryDelayMs(failures, retryMs),
          now: now.toISOString(),
        });
      }
      if (plan.kind !== "work") {
        const loops = await pointLoops(ctx, NO_LOOPS, now, resumed);
        return settle(ctx, previous, {
          stats: { off: plan.why, stages: [], handoff: null, loops },
          error: null,
          failures: 0,
          delayMs: passMs,
          now: now.toISOString(),
          ...(plan.kind === "gone" ? { stopped: plan.why } : {}),
        });
      }

      const db = deps.open({ database: plan.database });
      const { settings } = plan;
      const outcome = await runPass<ReactivationPassStats>(ctx, db, now, {
        name: PASS,
        ledger: { command: REACTIVATION_COMMAND, argv: { client: ctx.key, limit } },
        body: async (runId) => {
          const profile = await readClientProfile(db);
          const llm =
            deps.crm.llm && deps.clientLlm ? deps.clientLlm(ctx.key, deps.crm.llm) : deps.crm.llm;
          const stages = await runCrm(
            db,
            { ...deps.crm, llm, sites: null, fetcher: null },
            {
              linkedin: null,
              limit,
              runId,
              feed: runFeed(db, runId),
              compose: { settings, profile },
              only: passStages(settings, deps.freeVerify),
            },
          );
          const handoff = settings.stages.handoff
            ? await forwardHandoffs(db, deps.transport, { profile, settings, limit, now })
            : null;
          const portal = await feedDelivery(deps.main, db, ctx.key, settings, now).catch(
            (err: unknown) => ({ error: errorText(err) }),
          );
          const visits = await readVisits(deps.main, db, ctx.key, now).catch((err: unknown) => ({
            error: errorText(err),
          }));
          return { off: null, stages, handoff, loops: plan.loops, portal, visits };
        },
        delayAfter: () => passMs,
        retryMs,
        ...(deps.notifier ? { notifier: deps.notifier } : {}),
      });
      // The mailboxes follow the settings whether or not the work failed.
      await pointLoops(ctx, plan.loops, now, resumed);
      if (outcome.stats !== null) {
        if (deps.notifier) await tellHandoffs(ctx, deps.notifier, outcome.stats.handoff);
        return outcome;
      }
      // A failed pass still names the loops it left running: `status` lists them.
      const failed = {
        ...outcome,
        stats: { off: null, stages: [], handoff: null, loops: plan.loops },
      };
      await setLastPass(ctx, failed);
      return failed;
    },
    { onStop: stopLoops },
  );
}

/** Whether the last pass that forwarded had failures; a pass that failed whole leaves it. */
const FORWARDS_FAILING = "forwardsFailing";

/**
 * The operator hears each forward that went (no contact names), and once when
 * forwards start failing; a forward that fails every pass is one message.
 */
async function tellHandoffs(
  ctx: restate.ObjectContext,
  notifier: Notifier,
  handoff: ForwardStats | null,
): Promise<void> {
  if (!handoff) return;
  const wasFailing = (await ctx.get<boolean>(FORWARDS_FAILING)) ?? false;
  ctx.set(FORWARDS_FAILING, handoff.failed > 0);
  const where = `handoff · ${ctx.key}`;
  if (handoff.sent.length > 0) {
    await ctx.run("notify forwards", () =>
      notifier.notify(
        `${where}: ${plural(handoff.sent.length, "reply", "replies")} forwarded`,
        handoff.sent.join("\n"),
      ),
    );
  }
  if (handoff.failed > 0 && !wasFailing) {
    await ctx.run("notify forward failed", () =>
      notifier.notify(
        `${where}: ${plural(handoff.failed, "forward")} failed`,
        `${handoff.errors.join("\n")}\neach is tried again next pass`,
        "warning",
      ),
    );
  }
}

/** Stop every mailbox loop this key started, and forget them: the next start starts them all. */
async function stopLoops(ctx: restate.ObjectContext): Promise<void> {
  const had = (await ctx.get<MailboxLoops>(STARTED)) ?? NO_LOOPS;
  for (const key of had.send)
    ctx.objectSendClient<SendScheduler>({ name: "SendScheduler" }, key).stop();
  for (const key of had.inbox)
    ctx.objectSendClient<InboxScheduler>({ name: "InboxScheduler" }, key).stop();
  ctx.clear(STARTED);
  ctx.clear(ASSERTED);
}

/**
 * Start the mailbox loops that should run and stop the ones that shouldn't.
 * Starting is a no-op for a running loop; a loop that stopped itself (its
 * client went off between passes) is started again within the hour, and all
 * of them when this loop comes back from a stop.
 */
async function pointLoops(
  ctx: restate.ObjectContext,
  want: MailboxLoops,
  now: Date,
  resumed: boolean,
): Promise<MailboxLoops> {
  const had = (await ctx.get<MailboxLoops>(STARTED)) ?? NO_LOOPS;
  const asserted = (await ctx.get<string>(ASSERTED)) ?? null;
  const all = resumed || asserted === null || now.getTime() - Date.parse(asserted) >= REASSERT_MS;
  const send = (key: string) => ctx.objectSendClient<SendScheduler>({ name: "SendScheduler" }, key);
  const inbox = (key: string) =>
    ctx.objectSendClient<InboxScheduler>({ name: "InboxScheduler" }, key);
  for (const key of want.send) if (all || !had.send.includes(key)) send(key).start();
  for (const key of had.send) if (!want.send.includes(key)) send(key).stop();
  for (const key of want.inbox) if (all || !had.inbox.includes(key)) inbox(key).start();
  for (const key of had.inbox) if (!want.inbox.includes(key)) inbox(key).stop();
  ctx.set(STARTED, want);
  if (all) ctx.set(ASSERTED, now.toISOString());
  return want;
}

export type Reactivation = ReturnType<typeof makeReactivation>;
