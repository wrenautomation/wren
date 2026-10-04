/**
 * Wren's own email work as console records (`@wren/core/records`): campaigns, inboxes, warm
 * replies, the firms in the pipeline, model usage. Team only, on the main database, unmasked.
 * Campaigns and inboxes read the roster and the send policy, so they're built from them; the
 * policy each read is env with the console's campaign overrides on top (`campaign_controls`).
 */

import {
  cited,
  company,
  date,
  defineRecord,
  name,
  number,
  type RecordType,
  rate,
  status,
  text,
} from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { activePauses, domainHealth, domainOf, wouldTrip } from "./inbox/health.js";
import { campaignPolicy, loadCampaignControls } from "./send/campaign-controls.js";
import { todaysSends } from "./send/deliver.js";
import type { SendPolicy } from "./send/policy.js";
import type { Sender } from "./send/roster.js";

const AGES = {
  this_month: { label: "This month", tone: "good" },
  last_month: { label: "Last month", tone: "neutral" },
  earlier: { label: "Earlier", tone: "neutral" },
} as const;

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
          name: id.charAt(0).toUpperCase() + id.slice(1).replaceAll("_", " "),
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
          campaigns: s.niches === null ? "every campaign" : s.niches.join(", "),
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
    campaign: text("Campaign", { from: "niche" }),
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
    campaign: text("Campaign", { from: "niche" }),
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

/** Every email record type; the worker passes them to `makeConsolePortal`. */
export const emailRecords = (roster: readonly Sender[], policy: SendPolicy): RecordType[] => [
  campaignRecord(policy),
  inboxRecord(roster, policy),
  replyRecord,
  firmRecord,
  modelRecord,
];
