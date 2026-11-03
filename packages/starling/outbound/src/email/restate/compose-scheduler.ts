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
 * Copy is live data (`liveEmails`), and there may be none: a sequence whose templates are not
 * live is skipped with its reason in `skipped`, never composed and never thrown.
 *
 * Campaigns (designs/2026-11-02-campaigns.md, phase 3): the pass walks the shape's live
 * campaigns in body order (`liveCampaigns`, from the composition root), the default last. A campaign joins this niche's pass when its email
 * account is one of the niche's senders; it sends from that inbox only, takes the plan rules that
 * pitch its offer and the people in its segment, under its `email.opener` cap. Each enrollment
 * carries its campaign. The default runs as before on what is left, stamped null.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Company } from "@wren/core";
import { type Notifier, plural } from "@wren/core/notify";
import { clientOfKey, makeLoopObject, runPass, stoppedPass } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { capLeft, type LoopCampaign } from "@wren/starling-core/campaigns";
import type { SharedSuppressions } from "@wren/starling-email";
import { AUDIENCES, type Audience, type RecontactPolicy } from "@wren/starling-email";
import { type EnrollmentRule, ruleCovers } from "@wren/starling-email/outreach/plan";
import type { Sequence } from "@wren/starling-email/outreach/sequences";
import { untilNextLocalDay } from "@wren/starling-email/restate";
import { campaignPolicy } from "@wren/starling-email/send/campaign-controls";
import { fillTimezones, type TimezoneFillStats } from "@wren/starling-email/send/lead-timezone";
import type { SendPolicy } from "@wren/starling-email/send/policy";
import { sql } from "drizzle-orm";
import { type ComposeStats, compose } from "../outreach/compose.js";
import type { Filler } from "../outreach/fills.js";
import { copyGap, liveEmails } from "../outreach/live.js";
import { type RefreshStats, refreshQueue } from "../outreach/refresh.js";
import type { RampMap } from "../send/deliver.js";
import { clientCampaign, clientPolicy, clientSequences, sharedFor } from "../sequences.js";

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
  /** Casual names and prompt slots by a model (outreach/fills.ts), for compose, refresh and replies. */
  readonly fill?: Filler;
}

interface ComposeSchedulerDeps {
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
  /** A client's database, for `<client>/<niche>` keys (email sequences); absent, those keys refuse. */
  clientDb?: ((client: string) => Db) | null;
  /** The workspace's live campaigns on `now`, body order, the default left out. Absent: none. */
  liveCampaigns?: (db: Db, now: Date) => Promise<readonly LoopCampaign[]>;
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
  /** One compose run per campaign (null = the default) and plan rule that was needed: campaigns in body order, the default last; in each, first contact in plan order, then returning. */
  passes: { campaign: string | null; sequence: string; audience: Audience; stats: ComposeStats }[];
  /** Sequences left out of this pass for want of copy (`copyGap`): not live, no subject, or an offer term it quotes is unset. */
  skipped: { sequence: string; why: string }[];
  /** The plan ran dry before the target was met: nothing left to enroll today. */
  exhausted: boolean;
}

const COMPOSE_COMMAND = "outreach compose";
const DEFAULT_RETRY_MS = 60 * 60 * 1000;

/** Approved openers for this niche that have not sent yet; with `campaign`, that campaign's only. */
export async function queuedOpeners(db: Db, niche: string, campaign?: string): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT count(*)::int AS n
    FROM messages m JOIN enrollments e ON e.id = m.enrollment_id
    WHERE e.niche = ${niche} AND m.step = 0 AND m.state = 'approved'
      ${campaign === undefined ? sql`` : sql`AND e.campaign = ${campaign}`}
  `)) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
}

/** One campaign's part of a top-up. */
export interface CampaignSweep {
  /** The metro campaign id; null = the default. */
  campaign: string | null;
  senders: readonly string[];
  rules: { rule: EnrollmentRule; audience: Audience }[];
  /** Only the people in this segment; role inboxes then sit out. */
  segment: number | null;
  /** `email.opener`: openers a day. */
  cap?: number;
}

/** The plan's rules as sweeps: first contact in plan order, then returning. */
const sweepsOf = (plan: readonly EnrollmentRule[]) =>
  AUDIENCES.flatMap((audience) =>
    plan.filter((rule) => ruleCovers(rule, audience)).map((rule) => ({ rule, audience })),
  );

/**
 * The campaigns this niche's pass serves, in order, the default last. Pure. A campaign serves it
 * when its email account is one of the niche's senders, and its offer (if set) is one a plan rule
 * pitches. A `lines` audience does not narrow cold email yet.
 */
export function campaignSweeps(
  live: readonly LoopCampaign[],
  campaign: Pick<Campaign, "plan" | "offers" | "senders">,
): CampaignSweep[] {
  const out: CampaignSweep[] = [];
  for (const c of live) {
    const account = c.accounts.email?.toLowerCase();
    const sender = campaign.senders.find((s) => s.toLowerCase() === account);
    if (!sender) continue;
    const plan = campaign.plan.filter(
      (rule) => c.offer === undefined || campaign.offers.get(rule.sequence) === c.offer,
    );
    if (plan.length === 0) continue;
    const cap = c.caps["email.opener"];
    out.push({
      campaign: c.id,
      senders: [sender],
      rules: sweepsOf(plan),
      segment: c.audience?.segment === undefined ? null : Number(c.audience.segment),
      ...(cap === undefined ? {} : { cap }),
    });
  }
  out.push({
    campaign: null,
    senders: campaign.senders,
    rules: sweepsOf(campaign.plan),
    segment: null,
  });
  return out;
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
/** The campaign's queue re-rendered from the store's live templates. */
export async function refreshCampaign(
  db: Db,
  campaign: Campaign,
  trackOpens: boolean,
  staleOnly = false,
): Promise<RefreshStats> {
  return refreshQueue(db, {
    niche: campaign.niche,
    templates: await liveEmails(db, campaign.niche),
    factsView: campaign.factsView,
    offerFacts: campaign.offerFacts,
    site: campaign.site ?? null,
    senders: campaign.senders,
    signatures: campaign.signatures,
    trackOpens,
    staleOnly,
    ...(campaign.fill ? { fill: campaign.fill } : {}),
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
    /** A client's database: main's suppressions gate too. */
    shared?: SharedSuppressions | null;
    /** Live campaigns, body order, the default left out. */
    campaigns?: readonly LoopCampaign[];
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
    skipped: [],
    exhausted: false,
  };
  let remaining = stats.shortfall;
  const templates = await liveEmails(db, campaign.niche);
  for (const sweep of campaignSweeps(opts.campaigns ?? [], campaign)) {
    if (remaining <= 0) break;
    // The campaign cap holds a queue of `daysAhead` days, inside the global shortfall.
    const capped = sweep.cap === undefined ? undefined : sweep.cap * opts.daysAhead;
    let used =
      capped === undefined || sweep.campaign === null
        ? 0
        : await queuedOpeners(db, campaign.niche, sweep.campaign);
    for (const { rule, audience } of sweep.rules) {
      const limit = capLeft(remaining, capped, used);
      if (limit <= 0) break;
      const sequence = campaign.sequences.get(rule.sequence);
      if (!sequence) throw new Error(`campaign ${campaign.niche}: no sequence '${rule.sequence}'`);
      const offer = campaign.offers.get(rule.sequence);
      if (!offer)
        throw new Error(`campaign ${campaign.niche}: sequence '${rule.sequence}' has no offer`);
      // No live copy is no work, not a failure: the loop must not throw and retry hourly.
      const offerFacts = campaign.offerFacts.get(offer) ?? {};
      const why = copyGap(sequence, templates, offerFacts);
      if (why !== null) {
        if (!stats.skipped.some((k) => k.sequence === rule.sequence))
          stats.skipped.push({ sequence: rule.sequence, why });
        continue;
      }
      const pass = await compose(db, {
        niche: campaign.niche,
        sequence,
        offer,
        offerFacts,
        site: campaign.site ?? null,
        templates,
        verificationHorizonDays: opts.verificationHorizonDays,
        senders: sweep.senders,
        signatures: campaign.signatures,
        trackOpens: opts.trackOpens,
        roleInboxNeedsVerdict: opts.roleInboxNeedsVerdict,
        kind: campaign.mailsRoleInboxes ? "all" : "person",
        factsView: campaign.factsView,
        limit,
        autoApprove: true,
        runId: opts.runId,
        audience,
        recontact: campaign.recontact,
        shared: opts.shared ?? null,
        campaign: sweep.campaign,
        segment: sweep.segment,
        ...(rule.where ? { where: rule.where } : {}),
        ...(campaign.fill ? { fill: campaign.fill } : {}),
      });
      stats.passes.push({
        campaign: sweep.campaign,
        sequence: rule.sequence,
        audience,
        stats: pass,
      });
      stats.enrolled += pass.enrolled;
      stats.messages_drafted += pass.messages_drafted;
      remaining -= pass.enrolled;
      used += pass.enrolled;
    }
  }
  // Sweeps skipped for copy are not a dry pool: only a default sweep that ran and found nobody is.
  // A campaign that found nobody is that campaign dry, not the pool.
  stats.exhausted =
    remaining > 0 && (stats.skipped.length === 0 || stats.passes.some((p) => p.campaign === null));
  return stats;
}

export function makeComposeScheduler(deps: ComposeSchedulerDeps) {
  const retryMs = deps.retryMs ?? DEFAULT_RETRY_MS;
  const trackOpens = deps.trackOpens ?? false;
  return makeLoopObject("ComposeScheduler", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    // Wren's key is its niche; a client's is `<client>/<niche>`, on its database under its caps.
    const owner = clientOfKey(ctx.key);
    const niche = owner?.unit ?? ctx.key;
    let db = deps.db;
    let campaignOf = (): Campaign | undefined => deps.campaigns.get(niche);
    let policyOf = () => campaignPolicy(deps.db, deps.policy);
    let shared: SharedSuppressions | null = null;
    if (owner) {
      const clientDb = deps.clientDb;
      if (!clientDb) throw new restate.TerminalError("no client databases here");
      const plan = await ctx.run("client", () => clientSequences(deps.db, owner.client));
      if (plan.kind === "gone") return stoppedPass<TopUpStats>(ctx, now, plan.why);
      const { settings } = plan;
      if (settings.niche !== niche)
        return stoppedPass<TopUpStats>(
          ctx,
          now,
          `the client's niche is ${settings.niche ?? "unset"}`,
        );
      const cdb = clientDb(owner.client);
      db = cdb;
      campaignOf = () => {
        const base = deps.campaigns.get(niche);
        return base && clientCampaign(base, settings);
      };
      policyOf = () => clientPolicy(cdb, settings, deps.policy);
      shared = sharedFor(deps.db, owner.client);
    }
    const outcome = await runPass<TopUpStats>(ctx, db, {
      now,
      name: "compose top-up",
      ledger: {
        command: COMPOSE_COMMAND,
        argv: { daemon: true, niche, days_ahead: deps.daysAhead, approve: true },
        niche,
      },
      body: async (runId) => {
        const campaign = campaignOf();
        if (!campaign) {
          throw new Error(
            `no campaign for niche '${niche}' (known: ${[...deps.campaigns.keys()].sort().join(", ")})`,
          );
        }
        if (campaign.senders.length === 0) {
          throw new Error(`niche '${niche}' has no active sender on the roster`);
        }
        return topUp(db, campaign, {
          // The console's overrides of this pass, so a stop or resume needs no deploy.
          policy: await policyOf(),
          shared,
          now,
          campaigns: deps.liveCampaigns ? await deps.liveCampaigns(db, now) : [],
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
          `${ctx.key}: the pool ran dry`,
          `${stats.queued + stats.enrolled} of ${stats.target} openers queued after ` +
            `${plural(stats.enrolled, "new enrollment")}; import more leads or verify more addresses`,
          "warning",
        ),
      );
    }
    if (notifier && stats?.skipped?.length) {
      await ctx.run("notify no copy", () =>
        notifier.notify(
          `${ctx.key}: no copy to compose from`,
          `${plural(stats.skipped.length, "sequence")} skipped: ` +
            stats.skipped.map((k) => `${k.sequence} (${k.why})`).join("; "),
          "warning",
        ),
      );
    }
    return outcome;
  });
}

export type ComposeScheduler = ReturnType<typeof makeComposeScheduler>;
