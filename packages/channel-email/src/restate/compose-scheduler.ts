/**
 * The queue-keeper: `ComposeScheduler/{niche}` keeps the approved opener queue a few
 * send days ahead of what the fleet may send, so the send loops never starve and nobody
 * composes by hand. A pass measures tomorrow's capacity (active inboxes for this niche ×
 * today's per-inbox cap, under the fleet-wide opener brake), counts approved openers not
 * yet sent, and composes the shortfall through the niche's enrollment plan, rule by rule,
 * auto-approved. Then it sleeps to the next local midnight.
 *
 * Compose commits one company per transaction and the partial unique indexes make a
 * retry safe, so the whole pass is one journaled step. An empty pool is not an error:
 * `exhausted` says so and the next pass looks again (a new import shows up on its own).
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Company } from "@wren/core";
import { type Notifier, plural } from "@wren/core/notify";
import { makeLoopObject, runPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { sql } from "drizzle-orm";
import { type ComposeStats, compose } from "../outreach/compose.js";
import type { EnrollmentRule } from "../outreach/plan.js";
import type { Sequence } from "../outreach/sequences.js";
import type { Template } from "../outreach/templates.js";
import { fillTimezones, type TimezoneFillStats } from "../send/lead-timezone.js";
import type { SendPolicy } from "../send/policy.js";
import { untilNextLocalDay } from "./postmaster-scheduler.js";

/** Everything compose needs for one niche, assembled by the composition root. */
export interface Campaign {
  readonly niche: string;
  readonly plan: readonly EnrollmentRule[];
  readonly sequences: ReadonlyMap<string, Sequence>;
  /** The offer each sequence pitches, by sequence name (the niche's arm → offer map). */
  readonly offers: ReadonlyMap<string, string>;
  readonly templates: ReadonlyMap<string, Template>;
  readonly factsView: string | null;
  /** Active roster addresses this niche may send from, roster order. */
  readonly senders: readonly string[];
  /** Plain sign-off per sender, page slot already filled. */
  readonly signatures: Readonly<Record<string, string>>;
  /** Where the company keeps office hours, as the source wrote it, for the lead's clock. */
  readonly companyLocation: (company: Company) => string | null;
}

export interface ComposeSchedulerDeps {
  db: Db;
  policy: SendPolicy;
  campaigns: ReadonlyMap<string, Campaign>;
  /** How many send days of openers to keep approved ahead. */
  daysAhead: number;
  verificationHorizonDays: number;
  trackOpens?: boolean;
  /** Role inboxes wait for a valid/catch_all verdict (on when the verifier is free). */
  roleInboxNeedsVerdict?: boolean;
  /** Wait after a pass that threw (default 1 h). */
  retryMs?: number;
  /** Told when the plan ran dry (the pool needs an import) and when a pass fails. */
  notifier?: Notifier;
}

export interface TopUpStats {
  niche: string;
  /** `companies.timezone` filled for the niche before composing (the lead window's clock). */
  timezones: TimezoneFillStats;
  /** Openers the fleet may send this niche per day, as of this pass. */
  capacity_per_day: number;
  queued: number;
  target: number;
  shortfall: number;
  enrolled: number;
  messages_drafted: number;
  /** One compose run per plan rule that was needed, in plan order. */
  passes: { sequence: string; stats: ComposeStats }[];
  /** The plan ran dry before the target was met: nothing left to enroll today. */
  exhausted: boolean;
}

export const COMPOSE_COMMAND = "outreach compose";
const DEFAULT_RETRY_MS = 60 * 60 * 1000;

/** Approved openers for this niche that have not sent yet. */
export async function queuedOpeners(db: Db, niche: string): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT count(*)::int AS n
    FROM messages m JOIN enrollments e ON e.id = m.enrollment_id
    WHERE e.niche = ${niche} AND m.step = 0 AND m.state = 'approved'
  `)) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
}

/** Openers per day this niche's inboxes may open, under the fleet brake when there is one. */
export function dailyOpenerCapacity(policy: SendPolicy, senders: number, now: Date): number {
  const perInbox = policy.perInboxCap(now) * senders;
  return policy.newOpenersPerDay === null ? perInbox : Math.min(perInbox, policy.newOpenersPerDay);
}

/** One top-up for `campaign`, as a plain function so an operator command and the loop agree. */
export async function topUp(
  db: Db,
  campaign: Campaign,
  opts: {
    policy: SendPolicy;
    now: Date;
    daysAhead: number;
    verificationHorizonDays: number;
    trackOpens: boolean;
    roleInboxNeedsVerdict: boolean;
    runId: string | null;
  },
): Promise<TopUpStats> {
  const timezones = await fillTimezones(db, {
    niche: campaign.niche,
    locationOf: campaign.companyLocation,
  });
  const capacity = dailyOpenerCapacity(opts.policy, campaign.senders.length, opts.now);
  const queued = await queuedOpeners(db, campaign.niche);
  const target = capacity * opts.daysAhead;
  const stats: TopUpStats = {
    niche: campaign.niche,
    timezones,
    capacity_per_day: capacity,
    queued,
    target,
    shortfall: Math.max(0, target - queued),
    enrolled: 0,
    messages_drafted: 0,
    passes: [],
    exhausted: false,
  };
  let remaining = stats.shortfall;
  for (const rule of campaign.plan) {
    if (remaining <= 0) break;
    const sequence = campaign.sequences.get(rule.sequence);
    if (!sequence) throw new Error(`campaign ${campaign.niche}: no sequence '${rule.sequence}'`);
    const offer = campaign.offers.get(rule.sequence);
    if (!offer)
      throw new Error(`campaign ${campaign.niche}: sequence '${rule.sequence}' has no offer`);
    const pass = await compose(db, {
      niche: campaign.niche,
      sequence,
      offer,
      templates: campaign.templates,
      verificationHorizonDays: opts.verificationHorizonDays,
      senders: campaign.senders,
      signatures: campaign.signatures,
      trackOpens: opts.trackOpens,
      roleInboxNeedsVerdict: opts.roleInboxNeedsVerdict,
      factsView: campaign.factsView,
      limit: remaining,
      autoApprove: true,
      runId: opts.runId,
      ...(rule.where ? { where: rule.where } : {}),
    });
    stats.passes.push({ sequence: rule.sequence, stats: pass });
    stats.enrolled += pass.enrolled;
    stats.messages_drafted += pass.messages_drafted;
    remaining -= pass.enrolled;
  }
  stats.exhausted = remaining > 0;
  return stats;
}

export function makeComposeScheduler(deps: ComposeSchedulerDeps) {
  const retryMs = deps.retryMs ?? DEFAULT_RETRY_MS;
  const trackOpens = deps.trackOpens ?? false;
  return makeLoopObject("ComposeScheduler", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    const niche = ctx.key;
    const outcome = await runPass<TopUpStats>(ctx, deps.db, now, {
      name: "compose top-up",
      ledger: {
        command: COMPOSE_COMMAND,
        argv: { daemon: true, niche, days_ahead: deps.daysAhead, approve: true },
        niche,
      },
      body: (runId) => {
        const campaign = deps.campaigns.get(niche);
        if (!campaign) {
          throw new Error(
            `no campaign for niche '${niche}' (known: ${[...deps.campaigns.keys()].sort().join(", ")})`,
          );
        }
        if (campaign.senders.length === 0) {
          throw new Error(`niche '${niche}' has no active sender on the roster`);
        }
        return topUp(deps.db, campaign, {
          policy: deps.policy,
          now,
          daysAhead: deps.daysAhead,
          verificationHorizonDays: deps.verificationHorizonDays,
          trackOpens,
          roleInboxNeedsVerdict: deps.roleInboxNeedsVerdict ?? false,
          runId,
        });
      },
      delayAfter: () => untilNextLocalDay(deps.policy, now),
      retryMs,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    });
    const stats = outcome.stats;
    const notifier = deps.notifier;
    if (notifier && stats?.exhausted) {
      await ctx.run("notify exhausted", () =>
        notifier.notify(
          `${niche}: the pool ran dry`,
          `${stats.queued + stats.enrolled} of ${stats.target} openers queued after ` +
            `${plural(stats.enrolled, "new enrollment")}; import more leads or verify more addresses`,
          "warning",
        ),
      );
    }
    return outcome;
  });
}

export type ComposeScheduler = ReturnType<typeof makeComposeScheduler>;
