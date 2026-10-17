/**
 * Wren's own email work as console records (`@wren/core/records`): campaigns, inboxes, warm
 * replies, the firms in the pipeline, model usage. Team only, on the main database, unmasked.
 * Campaigns and inboxes read the roster and the send policy, so they're built from them; the
 * policy each read is env with the console's campaign overrides on top (`campaign_controls`).
 */

import { MEETING_OUTCOMES, outcomeStatus } from "@wren/core/calls";
import {
  actor,
  choice,
  cited,
  company,
  date,
  defineRecord,
  modelName,
  money,
  name,
  named,
  number,
  type RecordType,
  rate,
  status,
  text,
} from "@wren/core/records";
// A niche or arm as people read it: "sec_ria" is its niche's label, "SEC RIA".
import { labelOf, namedParts } from "@wren/core/templates/labels";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { briefOf } from "./calls/brief.js";
import { activePauses, domainHealth, domainOf, wouldTrip } from "./inbox/health.js";
import { campaignPolicy, loadCampaignControls } from "./send/campaign-controls.js";
import { todaysSends } from "./send/deliver.js";
import type { SendPolicy } from "./send/policy.js";
import type { Sender } from "./send/roster.js";

/**
 * A campaign: the row keeps its niche key, so filters and links match keys, and shows the
 * niche's label ("SEC RIA") from the labels the niches register (`nameParts`).
 */
const campaign = (from = "niche") => choice(namedParts, "Campaign", { from });

const AGES = {
  this_month: { label: "This month", tone: "good" },
  last_month: { label: "Last month", tone: "neutral" },
  earlier: { label: "Earlier", tone: "neutral" },
} as const;

export const campaignRecord = (env: SendPolicy): RecordType =>
  defineRecord({
    id: "email.campaign",
    app: "outbound",
    channel: "email",
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
      campaign: campaign("id"),
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
      setBy: actor("Set by"),
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
    app: "outbound",
    channel: "email",
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
          campaigns: s.niches === null ? "every campaign" : s.niches.map(labelOf).join(", "),
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
  app: "outbound",
  channel: "email",
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
    campaign: campaign(),
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

/** Where a call shows: ahead, over and unmarked, how it went, or cancelled. */
export const CALL_STATUS = {
  upcoming: { label: "Upcoming", tone: "warn" },
  past: { label: "Say how it went", tone: "neutral" },
  ...outcomeStatus(MEETING_OUTCOMES),
  cancelled: { label: "Cancelled", tone: "neutral" },
} as const;
const MARKED = [...MEETING_OUTCOMES];

/**
 * Every booked call (`call_bookings`): cal.com's, from its webhook, and our calendar's mirror,
 * matched to an enrollment or not. Its detail is the pre-call brief (`calls/brief.ts`); its
 * actions say how it went (`EmailConsole.call*`).
 */
export const callRecord = defineRecord({
  id: "email.call",
  app: "calls",
  channel: "email",
  name: { one: "call", many: "calls" },
  rows: async (db) =>
    await db.execute<Record<string, unknown>>(sql`
        select cb.id, cb.state::text state, cb.start, cb.booked_at booked, cb.email::text email,
          cb.offer::text offer, e.niche::text niche, co.name::text company, co.domain::text domain,
          case when cb.state = 'cancelled' then 'cancelled'
            when cb.outcome is not null then cb.outcome::text
            when cb.start > now() then 'upcoming' else 'past' end status,
          cb.outcome_reason reason, cb.outcome_by marked_by, cb.outcome_at marked,
          coalesce(nullif(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, '')), ''),
            p.full_name, cb.name, cb.email)::text who
        from call_bookings cb
        left join enrollments e on e.id = cb.enrollment_id
        left join people p on p.id = e.person_id
        left join companies co on co.id = e.company_id`),
  key: "id",
  title: "who",
  subtitle: "company",
  fields: {
    who: name("Who"),
    company: company("Company", { domain: "domain" }),
    status: status(CALL_STATUS),
    start: date("Call"),
    reason: text("Why"),
    booked: date("Booked"),
    campaign: campaign(),
    offer: text("Offer"),
    email: text("Email"),
    markedBy: text("Marked by"),
    marked: date("Marked"),
  },
  views: [
    {
      id: "upcoming",
      label: "Upcoming",
      where: { status: "upcoming" },
      sort: "start",
      at: "booked",
    },
    { id: "past", label: "To mark", where: { status: "past" }, sort: "-start", at: "start" },
    { id: "marked", label: "Marked", where: { status: MARKED }, sort: "-start", at: "start" },
    {
      id: "booked",
      label: "All booked",
      where: { status: ["upcoming", "past", ...MARKED] },
      sort: "-booked",
      at: "booked",
    },
    { id: "cancelled", label: "Cancelled", where: { status: "cancelled" }, sort: "-booked" },
    { id: "all", label: "All", sort: "-booked", at: "booked" },
  ],
  actions: [
    "email.callWon",
    "email.callNotYet",
    "email.callNoShow",
    "email.callNotFit",
    "email.callBrief",
  ],
  load: (db, id) => briefOf(db, id),
});

const IN_PLAY = { declined: { empty: true } } as const;
export const firmRecord = defineRecord({
  id: "email.firm",
  app: "pipeline",
  channel: null,
  name: { one: "company", many: "companies" },
  view: "email_firm_records",
  key: "id",
  title: "name",
  subtitle: "campaign",
  fields: {
    name: company("Company", { domain: "domain" }),
    campaign: campaign(),
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
  related: [{ record: "research.signal", by: "company_id" }],
});

export const modelRecord = defineRecord({
  id: "email.model",
  app: "money",
  channel: null,
  needs: "money",
  name: { one: "model usage", many: "model usage" },
  view: "email_model_records",
  key: "id",
  title: "model",
  subtitle: "kind",
  fields: {
    model: modelName(),
    provider: named("Provider"),
    kind: named("Used for"),
    month: date("Month", { grain: "month" }),
    calls: number(),
    inputTokens: number("Tokens in"),
    outputTokens: number("Tokens out"),
    rejectedCalls: number("Rejected"),
    parseFailures: number("Unparsed"),
    usd: money("Cost"),
    age: status(AGES, "When"),
  },
  views: [
    { id: "this_month", label: "This month", where: { age: "this_month" }, sort: "-calls" },
    { id: "last_month", label: "Last month", where: { age: "last_month" }, sort: "-calls" },
    { id: "all", label: "All", sort: "-month", at: "month" },
  ],
});

/**
 * Per campaign, the named people and firms stuck before a send (`pipeline_leaks`), and threads
 * stuck between sends: a follow-up still held an hour after the step before it went (its touch
 * on the spine failed or never came; the spine's failed events say why).
 */
export const stallRecord = defineRecord({
  id: "email.stall",
  app: "pipeline",
  channel: null,
  name: { one: "stall", many: "stalls" },
  rows: async (db) => {
    const touchless = new Map(
      (
        await db.execute<{ niche: string; n: number }>(sql`
          select e.niche, count(*)::int n from enrollments e
          join messages h on h.enrollment_id = e.id and h.held
          join messages p on p.enrollment_id = e.id and p.step = h.step - 1 and p.state = 'sent'
          where e.state = 'active' and p.sent_at < now() - interval '1 hour'
          group by e.niche`)
      ).map((r) => [r.niche, r.n]),
    );
    return (await db.execute<Record<string, unknown>>(sql`select * from pipeline_leaks`)).map(
      (r) => ({
        ...r,
        waiting_on_touch: touchless.get(String(r.niche)) ?? 0,
      }),
    );
  },
  key: "niche",
  title: "campaign",
  fields: {
    campaign: campaign(),
    catchAllLeads: number("Catch-all leads"),
    riskyLeads: number("Risky leads"),
    queuedFirms: number("Companies queued"),
    crawledNoPersonFirms: number("Crawled, no person"),
    waitingOnTouch: number("Follow-ups waiting on their touch"),
  },
  views: [{ id: "all", label: "All", sort: "-queuedFirms" }],
});

/** Every email record type; the worker passes them to `makeConsolePortal`. */
export const emailRecords = (roster: readonly Sender[], policy: SendPolicy): RecordType[] => [
  campaignRecord(policy),
  inboxRecord(roster, policy),
  replyRecord,
  callRecord,
  firmRecord,
  modelRecord,
  stallRecord,
];
