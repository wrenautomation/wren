/**
 * The queue-keeper: `ComposeScheduler/{niche}` keeps the approved opener queue a few
 * send days ahead of what the fleet may send, so the send loops never starve and nobody
 * composes by hand. A pass measures tomorrow's capacity (today's caps summed over this niche's
 * active inboxes, each on its own ramp if it has one, under the fleet and niche opener brakes), counts approved openers not
 * yet sent, and composes the shortfall through the niche's enrollment plan, rule by rule,
 * auto-approved: first-contact companies first, then returning ones (lead recycling) with
 * what is left. Before counting, it refreshes the queue (`refreshQueue`): queued email takes
 * today's templates and tracking switch. Then it sleeps to the next local midnight.
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
import { type EnrollmentRule, ruleCovers } from "../outreach/plan.js";
import { type RefreshStats, refreshQueue } from "../outreach/refresh.js";
import type { Sequence } from "../outreach/sequences.js";
import type { Template } from "../outreach/templates.js";
import { AUDIENCES, type Audience, type RecontactPolicy } from "../recontact.js";
import { campaignPolicy } from "../send/campaign-controls.js";
import type { RampMap } from "../send/deliver.js";
import { fillTimezones, type TimezoneFillStats } from "../send/lead-timezone.js";
import type { SendPolicy } from "../send/policy.js";
import { untilNextLocalDay } from "./postmaster-scheduler.js";

/** Everything compose needs for one niche, assembled by the composition root. */
export interface Campaign {
  readonly niche: string;
  readonly plan: readonly EnrollmentRule[];
  /** False: openers go to named people only, never to the inbox a pick chose. */
  readonly mailsRoleInboxes: boolean;
  readonly sequences: ReadonlyMap<string, Sequence>;
  /** The offer each sequence pitches, by sequence name (the niche's arm → offer map). */
  readonly offers: ReadonlyMap<string, string>;
  /** Each offer's terms as `offer.*` facts, by offer id, for copy that quotes them. */
  readonly offerFacts: ReadonlyMap<string, Readonly<Record<string, string>>>;
  /** The site's origin, for each draft's `link.*` facts. Left out: copy gets no links. */
  readonly site?: string | null;
  readonly templates: ReadonlyMap<string, Template>;
  readonly factsView: string | null;
  /** Active roster addresses this niche may send from, roster order. */
  readonly senders: readonly string[];
  /** Those of them on their own ramp. */
  readonly ramps?: RampMap;
  /** Plain sign-off per sender, page slot already filled. */
  readonly signatures: Readonly<Record<string, string>>;
  /** Where the company keeps office hours, as the source wrote it, for the lead's clock. */
  readonly companyLocation: (company: Company) => string | null;
  /** When a company may get another cold sequence. */
  readonly recontact: RecontactPolicy;
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
  /** Queued email re-rendered from today's templates, tokens matched to the tracking switch. */
  refresh: RefreshStats;
  /** `companies.timezone` filled for the niche before composing (the lead window's clock). */
  timezones: TimezoneFillStats;
  /** Openers the fleet may send this niche per day, as of this pass. */
  capacity_per_day: number;
  queued: number;
  target: number;
  shortfall: number;
  enrolled: number;
  messages_drafted: number;
  /** One compose run per plan rule that was needed: first contact in plan order, then returning. */
  passes: { sequence: string; audience: Audience; stats: ComposeStats }[];
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

/** Openers per day this niche's inboxes may open (each at its own ramp), under the fleet and niche brakes when set. */
export function dailyOpenerCapacity(
  policy: SendPolicy,
  niche: string,
  senders: readonly string[],
  now: Date,
  ramps?: RampMap,
): number {
  const brakes = [policy.newOpenersPerDay, policy.nicheOpenerCap(niche)].filter(
    (cap): cap is number => cap !== null,
  );
  const inboxes = senders.reduce((sum, s) => sum + policy.perInboxCap(now, ramps?.[s] ?? null), 0);
  return Math.min(inboxes, ...brakes);
}

/** One top-up for `campaign`, as a plain function so an operator command and the loop agree. */
/** The campaign's queue re-rendered from the templates this deployment carries. */
export function refreshCampaign(
  db: Db,
  campaign: Campaign,
  trackOpens: boolean,
  staleOnly = false,
): Promise<RefreshStats> {
  return refreshQueue(db, {
    niche: campaign.niche,
    templates: campaign.templates,
    factsView: campaign.factsView,
    offerFacts: campaign.offerFacts,
    site: campaign.site ?? null,
    senders: campaign.senders,
    signatures: campaign.signatures,
    trackOpens,
    staleOnly,
  });
}

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
  const capacity = dailyOpenerCapacity(
    opts.policy,
    campaign.niche,
    campaign.senders,
    opts.now,
    campaign.ramps,
  );
  const refresh = await refreshCampaign(db, campaign, opts.trackOpens);
  const queued = await queuedOpeners(db, campaign.niche);
  const target = capacity * opts.daysAhead;
  const stats: TopUpStats = {
    niche: campaign.niche,
    refresh,
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
  const sweeps = AUDIENCES.flatMap((audience) =>
    campaign.plan.filter((rule) => ruleCovers(rule, audience)).map((rule) => ({ rule, audience })),
  );
  for (const { rule, audience } of sweeps) {
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
      offerFacts: campaign.offerFacts.get(offer) ?? {},
      site: campaign.site ?? null,
      templates: campaign.templates,
      verificationHorizonDays: opts.verificationHorizonDays,
      senders: campaign.senders,
      signatures: campaign.signatures,
      trackOpens: opts.trackOpens,
      roleInboxNeedsVerdict: opts.roleInboxNeedsVerdict,
      kind: campaign.mailsRoleInboxes ? "all" : "person",
      factsView: campaign.factsView,
      limit: remaining,
      autoApprove: true,
      runId: opts.runId,
      audience,
      recontact: campaign.recontact,
      ...(rule.where ? { where: rule.where } : {}),
    });
    stats.passes.push({ sequence: rule.sequence, audience, stats: pass });
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
      body: async (runId) => {
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
          // The console's overrides of this pass, so a stop or resume needs no deploy.
          policy: await campaignPolicy(deps.db, deps.policy),
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
