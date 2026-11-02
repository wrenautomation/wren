/**
 * `ReachSender/fleet`: the send loop. One pass = one tick (tick.ts) over the journal: database
 * steps in `ctx.run`, platform calls as journaled calls to the Mac's desk. Next pass after the
 * gap when it sent, five minutes when nothing could go. Off until `wren reach queue start`.
 */
import * as restate from "@restatedev/restate-sdk";
import { finishRun, openRun } from "@wren/core";
import { executorEmit } from "@wren/core/executor";
import {
  clientOfKey,
  errorText,
  lastPass,
  makeLoopObject,
  type PassOutcome,
  setLastPass,
  stoppedPass,
} from "@wren/core/restate";
import { cadenceId } from "@wren/core/workflows";
import { clientReach, clientSends, syncLogins } from "../clients.js";
import { reachLead } from "../follow.js";
import { nextDue, type TickStats, tick } from "../tick.js";
import { channelsFor, clientDeps, nowFor, type ReachDeps, wakeWatch } from "./deps.js";

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
    executorEmit(ctx, {
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

export type ReachSender = ReturnType<typeof makeReachSender>;
