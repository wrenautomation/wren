/**
 * Wren's own email work as console records (`@wren/core/records`): campaigns, inboxes, warm
 * replies, the firms in the pipeline, model usage. Team only, on the main database, unmasked.
 * Campaigns and inboxes read the roster and the send policy, so they're built from them; the
 * policy each read is env with the console's campaign overrides on top (`campaign_controls`).
 */

import { formOf } from "@wren/core/console";
import {
  cited,
  company,
  date,
  defineRecord,
  name,
  number,
  percent,
  type RecordType,
  rate,
  score,
  status,
  text,
} from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { parseSettings, settingsSchema } from "@wren/experiments";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { points, versionTemplate } from "./evolve/genome.js";
import { activePauses, domainHealth, domainOf, wouldTrip } from "./inbox/health.js";
import { alleleKey } from "./outreach/templates.js";
import { experimentAlleles, experiments, templateVersions } from "./schema.js";
import { campaignPolicy, loadCampaignControls } from "./send/campaign-controls.js";
import { todaysSends } from "./send/deliver.js";
import type { SendPolicy } from "./send/policy.js";
import type { Sender } from "./send/roster.js";

const AGES = {
  this_month: { label: "This month", tone: "good" },
  last_month: { label: "Last month", tone: "neutral" },
  earlier: { label: "Earlier", tone: "neutral" },
} as const;

/** The views' rule (0072): "sec_ria" -> "Sec ria". */
const campaignName = (niche: string) =>
  niche.charAt(0).toUpperCase() + niche.slice(1).replaceAll("_", " ");

export const campaignRecord = (env: SendPolicy): RecordType =>
  defineRecord({
    id: "email.campaign",
    name: { one: "campaign", many: "campaigns" },
    rows: async (db) => {
      const controls = new Map((await loadCampaignControls(db)).map((c) => [c.campaign, c]));
      const policy = env.withCampaigns([...controls.values()]);
      return (
        await db.execute<Record<string, unknown>>(sql`select * from email_campaign_records`)
      ).map((r) => {
        const id = String(r.id);
        const c = controls.get(id);
        const set = [
          c?.killSwitch != null && "kill switch",
          c?.openersPerDay != null && "openers",
        ].filter(Boolean);
        return {
          ...r,
          state: policy.nicheOpenerCap(id) === 0 ? "follow_ups" : "opening",
          kill_switch: policy.killSwitchOn(id) ? "on" : "off",
          openers_per_day: policy.nicheOpenerCap(id),
          overrides: set.length ? set.join(", ") : null,
          set_by: set.length ? c?.updatedBy : null,
          set_at: set.length ? c?.updatedAt : null,
        };
      });
    },
    key: "id",
    title: "campaign",
    fields: {
      // "Agencies" in its list, panel and Overview alike; the id stays the niche's key.
      campaign: text("Campaign", { from: "name" }),
      state: status({
        opening: { label: "Opening", tone: "good" },
        follow_ups: { label: "Follow-ups only", tone: "warn" },
      }),
      killSwitch: status(
        { on: { label: "On", tone: "good" }, off: { label: "Off", tone: "warn" } },
        "Kill switch",
      ),
      sent: number("Sent"),
      replies: number("Replied"),
      replyRate: rate("reached", "Reply rate", { from: "replies" }),
      bounces: rate("sent", "Hard bounces"),
      enrolled: number(),
      interested: number(),
      lastSent: date("Last send"),
      openersPerDay: number("Openers a day"),
      overrides: text("Set in the console"),
      setBy: text("Set by"),
      setAt: date("Set"),
    },
    views: [
      { id: "all", label: "All", sort: "-sent" },
      { id: "opening", label: "Opening", where: { state: "opening" }, sort: "-sent" },
    ],
    related: [
      { record: "email.firm", by: "niche" },
      { record: "email.reply", by: "niche" },
    ],
    actions: [
      "email.killSwitchOff",
      "email.killSwitchOn",
      "email.stopOpeners",
      "email.resumeOpeners",
    ],
  });

export const inboxRecord = (roster: readonly Sender[], env: SendPolicy): RecordType =>
  defineRecord({
    id: "email.inbox",
    name: { one: "inbox", many: "inboxes" },
    rows: async (db: Queryable) => {
      const now = new Date();
      const policy = await campaignPolicy(db, env);
      const senders = roster.map((s) => s.address);
      const { sentToday } = await todaysSends(db, policy, now);
      const pauses = await activePauses(db);
      const health = new Map(
        (await domainHealth(db, { policy, now, senders })).map((h) => [h.domain, h]),
      );
      return roster.map((s) => {
        const pause = pauses.get(s.address);
        const h = health.get(domainOf(s.address));
        return {
          address: s.address,
          domain: domainOf(s.address),
          state: s.suspended ? "suspended" : pause ? "paused" : "sending",
          reason: pause?.reason ?? null,
          paused_at: pause?.pausedAt ?? null,
          cap: policy.perInboxCap(now, s.ramp),
          sent_today: sentToday.get(s.address) ?? 0,
          health: !h || h.sent === 0 ? "quiet" : wouldTrip(h, policy) ? "tripping" : "clean",
          bounces: h?.hardBounces ?? 0,
          sent_window: h?.sent ?? 0,
          campaigns: s.niches === null ? "every campaign" : s.niches.map(campaignName).join(", "),
        };
      });
    },
    key: "address",
    title: "address",
    subtitle: "domain",
    fields: {
      address: text("Inbox"),
      domain: text(),
      state: status({
        sending: { label: "Sending", tone: "good" },
        paused: { label: "Paused", tone: "bad" },
        suspended: { label: "Suspended", tone: "neutral" },
      }),
      sentToday: number("Sent today"),
      cap: number("Daily cap"),
      health: status({
        tripping: { label: "Over the line", tone: "bad" },
        clean: { label: "Clean", tone: "good" },
        quiet: { label: "No sends", tone: "neutral" },
      }),
      bounces: rate("sent_window", "Hard bounces (window)"),
      reason: text("Why paused"),
      pausedAt: date("Paused"),
      campaigns: text(),
    },
    views: [
      { id: "sending", label: "Sending", where: { state: "sending" }, sort: "-sentToday" },
      { id: "paused", label: "Paused", where: { state: "paused" }, sort: "-pausedAt" },
      { id: "all", label: "All", sort: "state" },
    ],
    actions: ["email.pause", "email.resume"],
  });

export const replyRecord = defineRecord({
  id: "email.reply",
  name: { one: "reply", many: "replies" },
  view: "email_reply_records",
  key: "id",
  title: "who",
  subtitle: "company",
  fields: {
    who: name("From"),
    company: company("Company", { domain: "domain" }),
    state: status({
      needs_you: { label: "Needs you", tone: "bad" },
      proposed: { label: "Draft ready", tone: "warn" },
      booking: { label: "Booking", tone: "neutral" },
      booked: { label: "Booked", tone: "good" },
      already_booked: { label: "Already booked", tone: "good" },
      sent: { label: "Answered", tone: "good" },
      dropped: { label: "Dropped", tone: "neutral" },
    }),
    received: date(),
    start: date("Proposed time"),
    timeZone: text("Time zone"),
    campaign: text("Campaign"),
    subject: text(),
    words: cited("Their words"),
    draft: cited("Our draft"),
    detail: cited("Why it needs you"),
    email: text("Email"),
  },
  views: [
    {
      id: "waiting",
      label: "Waiting on you",
      where: { state: ["needs_you", "proposed"] },
      sort: "-received",
      at: "received",
    },
    {
      id: "booked",
      label: "Booked",
      where: { state: ["booked", "already_booked"] },
      sort: "-received",
      at: "received",
    },
    { id: "all", label: "All", sort: "-received", at: "received" },
  ],
  activity: { view: "email_reply_thread", by: "reply_id" },
  actions: ["email.approve", "email.drop"],
});

const IN_PLAY = { declined: { empty: true } } as const;
export const firmRecord = defineRecord({
  id: "email.firm",
  name: { one: "firm", many: "firms" },
  view: "email_firm_records",
  key: "id",
  title: "name",
  subtitle: "campaign",
  fields: {
    name: company("Firm", { domain: "domain" }),
    campaign: text("Campaign"),
    stage: status({
      lead: { label: "Verified lead", tone: "good" },
      named: { label: "Named person", tone: "neutral" },
      crawled: { label: "Crawled", tone: "neutral" },
      domain: { label: "Has a domain", tone: "neutral" },
      found: { label: "Found", tone: "neutral" },
      declined: { label: "Declined", tone: "warn" },
    }),
    domain: text(),
    declined: text("Declined because"),
    added: date(),
    crawled: date(),
    named: date("Person named"),
    lead: date("Verified lead"),
  },
  // One per `pipeline_funnel` column, with the same rule.
  views: [
    { id: "in_play", label: "In play", where: IN_PLAY, sort: "-added", at: "added" },
    {
      id: "with_domain",
      label: "With a domain",
      where: { ...IN_PLAY, domain: { empty: false } },
      sort: "-added",
      at: "added",
    },
    {
      id: "crawled",
      label: "Crawled",
      where: { ...IN_PLAY, crawled: { empty: false } },
      sort: "-crawled",
      at: "crawled",
    },
    {
      id: "named",
      label: "Named person",
      where: { ...IN_PLAY, named: { empty: false } },
      sort: "-named",
      at: "named",
    },
    {
      id: "lead",
      label: "Verified lead",
      where: { ...IN_PLAY, lead: { empty: false } },
      sort: "-lead",
      at: "lead",
    },
    { id: "declined", label: "Declined", where: { stage: "declined" }, sort: "-added" },
  ],
});

export const modelRecord = defineRecord({
  id: "email.model",
  name: { one: "model usage", many: "model usage" },
  view: "email_model_records",
  key: "id",
  title: "model",
  subtitle: "kind",
  fields: {
    model: text(),
    provider: text(),
    kind: text("Used for"),
    month: date(),
    calls: number(),
    inputTokens: number("Tokens in"),
    outputTokens: number("Tokens out"),
    rejectedCalls: number("Rejected"),
    parseFailures: number("Unparsed"),
    age: status(AGES, "When"),
  },
  views: [
    { id: "this_month", label: "This month", where: { age: "this_month" }, sort: "-calls" },
    { id: "last_month", label: "Last month", where: { age: "last_month" }, sort: "-calls" },
    { id: "all", label: "All", sort: "-month", at: "month" },
  ],
});

/** One copy version of one step, with sends: `reply_by_arm_step`, versions never sent left out. */
export const variantRecord = defineRecord({
  id: "email.variant",
  name: { one: "variant", many: "variants" },
  rows: async (db) =>
    (
      await db.execute<Record<string, unknown>>(sql`select * from reply_by_arm_step where sent > 0`)
    ).map((r) => ({
      ...r,
      id: `${r.template}@${r.template_version}`,
      campaign: campaignName(String(r.niche)),
      step: Number(r.step) === 0 ? "Opener" : `Follow-up ${r.step}`,
    })),
  key: "id",
  title: "arm",
  subtitle: "campaign",
  fields: {
    arm: text("Variant"),
    campaign: text("Campaign"),
    step: text(),
    templateVersion: text("Copy version"),
    sent: number("Sent"),
    replyRate: rate("sent", "Reply rate", { from: "replies" }),
    interested: number(),
    bounces: rate("sent", "Hard bounces", { from: "hard_bounces" }),
  },
  views: [{ id: "all", label: "All", sort: "-sent" }],
});

/** Per campaign, the named people and firms stuck before a send: `pipeline_leaks`. */
export const stallRecord = defineRecord({
  id: "email.stall",
  name: { one: "stall", many: "stalls" },
  rows: async (db) =>
    (await db.execute<Record<string, unknown>>(sql`select * from pipeline_leaks`)).map((r) => ({
      ...r,
      campaign: campaignName(String(r.niche)),
    })),
  key: "niche",
  title: "campaign",
  fields: {
    campaign: text("Campaign"),
    catchAllLeads: number("Catch-all leads"),
    riskyLeads: number("Risky leads"),
    queuedFirms: number("Firms in the resolution queue"),
    crawledNoPersonFirms: number("Crawled, no person"),
  },
  views: [{ id: "all", label: "All", sort: "-queuedFirms" }],
});

const EXPERIMENT_STATES = {
  running: { label: "Running", tone: "good" },
  paused: { label: "Paused", tone: "warn" },
  settled: { label: "Settled", tone: "neutral" },
  stopped: { label: "Stopped", tone: "neutral" },
} as const;
const ALLELE_STATES = {
  candidate: { label: "Waiting on you", tone: "warn" },
  live: { label: "Live", tone: "good" },
  retired: { label: "Retired", tone: "neutral" },
  rejected: { label: "Rejected", tone: "neutral" },
} as const;
const ORIGINS = {
  seed: { label: "Model seed", tone: "neutral" },
  mutation: { label: "Model", tone: "neutral" },
  template: { label: "Template", tone: "neutral" },
  import: { label: "File edit", tone: "neutral" },
} as const;

/** One version of a genome: what it added and retired against its parent. */
export interface LineageNode {
  version: string;
  parent: string | null;
  at: string;
  live: boolean;
  added: { locus: string; text: string }[];
  retired: { locus: string; text: string }[];
}

/** An experiment's versions, oldest first, each diffed against its parent by allele key. */
export async function experimentLineage(db: Queryable, id: number): Promise<LineageNode[]> {
  const [exp] = await db.select().from(experiments).where(eq(experiments.id, id));
  if (!exp) return [];
  const rows = await db
    .select({
      version: templateVersions.version,
      parent: templateVersions.parentVersion,
      at: templateVersions.createdAt,
    })
    .from(templateVersions)
    .where(eq(templateVersions.experimentId, id))
    .orderBy(asc(templateVersions.id));
  const texts = new Map(
    (
      await db
        .select({
          locus: experimentAlleles.locus,
          allele: experimentAlleles.allele,
          text: experimentAlleles.text,
        })
        .from(experimentAlleles)
        .where(eq(experimentAlleles.experimentId, id))
    ).map((a) => [`${a.locus}/${a.allele}`, a.text]),
  );
  const keysOf = async (version: string | null) => {
    const tpl = version ? await versionTemplate(db, exp.niche, exp.template, version) : null;
    const out = new Map<string, { locus: string; text: string }>();
    for (const p of tpl ? points(tpl) : [])
      for (const o of p.options) {
        const k = `${p.name}/${alleleKey(o)}`;
        out.set(k, { locus: p.name, text: texts.get(k) ?? k });
      }
    return out;
  };
  // A parent outside the experiment (the file it started from) is the first version's root.
  const mine = new Set(rows.map((r) => r.version));
  const nodes: LineageNode[] = [];
  for (const r of rows) {
    const [now, before] = await Promise.all([
      keysOf(r.version),
      keysOf(r.parent !== null && mine.has(r.parent) ? r.parent : null),
    ]);
    const first = nodes.length === 0;
    nodes.push({
      version: r.version,
      parent: r.parent !== null && mine.has(r.parent) ? r.parent : null,
      at: r.at.toISOString(),
      live: r.version === exp.liveVersion,
      added: first ? [] : [...now].filter(([k]) => !before.has(k)).map(([, v]) => v),
      retired: first ? [] : [...before].filter(([k]) => !now.has(k)).map(([, v]) => v),
    });
  }
  return nodes;
}

/** The settings as form boxes, all optional: only what's typed changes. Seeding is start only. */
const SETTINGS_FORM = (formOf(z.toJSONSchema(settingsSchema, { io: "input" })) ?? []).filter(
  (f) => f.field !== "seeding",
);

/** The settings form, each box saying what it's set to now. */
export function settingsForm(raw: unknown) {
  const now = parseSettings(raw);
  return SETTINGS_FORM.map((f) => {
    const value = f.field
      .split(".")
      .reduce<unknown>((at, k) => (at as Record<string, unknown> | undefined)?.[k], now);
    const said = typeof value === "string" ? value : JSON.stringify(value);
    return { ...f, hint: `Now ${said}.${f.hint ? ` ${f.hint}.` : ""}` };
  });
}

export const experimentRecord = defineRecord({
  id: "email.experiment",
  name: { one: "experiment", many: "experiments" },
  view: "email_experiment_records",
  key: "id",
  title: "name",
  subtitle: "state",
  fields: {
    name: text("Experiment"),
    state: status(EXPERIMENT_STATES),
    waiting: number("Waiting on you"),
    generation: number(),
    loci: number("Points"),
    live: number("Live options"),
    retired: number("Retired"),
    selection: text(),
    fitness: text("Counts as a win"),
    stopReason: text("Stopped because"),
    lastTick: date("Last tick"),
    started: date(),
  },
  views: [
    { id: "running", label: "Running", where: { state: ["running", "paused"] }, sort: "-started" },
    { id: "all", label: "All", sort: "-started", at: "started" },
  ],
  related: [
    { record: "email.allele", by: "experiment_id" },
    { record: "email.candidate", by: "experiment_id" },
  ],
  activity: { view: "email_experiment_journal", by: "experiment_id" },
  actions: ["email.pauseExperiment", "email.resumeExperiment", "email.stopExperiment"],
  load: async (db, id) => {
    const [exp] = await db
      .select()
      .from(experiments)
      .where(eq(experiments.id, Number(id)));
    return exp
      ? { lineage: await experimentLineage(db, exp.id), settings: settingsForm(exp.settings) }
      : null;
  },
});

export const alleleRecord = defineRecord({
  id: "email.allele",
  name: { one: "option", many: "options" },
  view: "email_allele_records",
  key: "id",
  title: "text",
  subtitle: "locus",
  fields: {
    text: text("Copy"),
    locus: text("Point"),
    state: status(ALLELE_STATES),
    share: percent("Share"),
    pBest: percent("Chance it's best"),
    replyRate: rate("exposures", "Reply rate", { from: "replies" }),
    interestedRate: rate("exposures", "Interested rate", { from: "interested" }),
    exposures: number("Recipients"),
    origin: status(ORIGINS, "From"),
    angle: text(),
    judgeScore: score("Judge score", { max: 10 }),
    retiredReason: text("Retired because"),
    experiment: text("Experiment"),
    created: date("Added"),
  },
  views: [
    { id: "live", label: "Live", where: { state: "live" }, sort: "locus" },
    { id: "all", label: "All", sort: "locus" },
  ],
});

/** A candidate's context: the live options at its point, best first. */
async function winnersOf(db: Queryable, id: string) {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select w.text, w.share, w.p_best, w.exposures, w.replies, w.interested
    from email_allele_records c
    join email_allele_records w on w.experiment_id = c.experiment_id and w.locus = c.locus
      and w.state = 'live'
    where c.id = ${Number(id)} order by w.p_best desc nulls last, w.id`);
  return { winners: [...rows] };
}

export const candidateRecord = defineRecord({
  id: "email.candidate",
  name: { one: "copy candidate", many: "copy candidates" },
  view: "email_candidate_records",
  key: "id",
  title: "text",
  subtitle: "experiment",
  fields: {
    text: text("Copy"),
    experiment: text("Experiment"),
    locus: text("Point"),
    state: status(ALLELE_STATES),
    judgeScore: score("Judge score", { max: 10 }),
    angle: text(),
    reason: text("Why the model wrote it"),
    origin: status(ORIGINS, "From"),
    decidedBy: text("Decided by"),
    decided: date(),
    created: date("Written"),
  },
  views: [
    {
      id: "waiting",
      label: "Waiting on you",
      where: { state: "candidate" },
      sort: "-created",
      at: "created",
    },
    {
      id: "approved",
      label: "Approved",
      where: { state: ["live", "retired"] },
      sort: "-decided",
      at: "decided",
    },
    {
      id: "rejected",
      label: "Rejected",
      where: { state: "rejected" },
      sort: "-decided",
      at: "decided",
    },
    { id: "all", label: "All", sort: "-created", at: "created" },
  ],
  actions: ["email.approveCandidate", "email.editCandidate", "email.rejectCandidate"],
  load: winnersOf,
});

/** Every email record type; the worker passes them to `makeConsolePortal`. */
export const emailRecords = (roster: readonly Sender[], policy: SendPolicy): RecordType[] => [
  campaignRecord(policy),
  inboxRecord(roster, policy),
  replyRecord,
  firmRecord,
  modelRecord,
  variantRecord,
  stallRecord,
  experimentRecord,
  alleleRecord,
  candidateRecord,
];
