/**
 * Every component, from every package: the source for the catalog, installs and
 * gating. `components.test.ts` checks every service, record and app is in one.
 */
import { BOOKS_COMPONENTS } from "@wren/books/components";
import { CALENDAR_COMPONENTS } from "@wren/calendar/components";
import { EMAIL_COMPONENTS } from "@wren/channel-email/components";
import { META_COMPONENTS } from "@wren/channel-meta/components";
import { SEARCH_COMPONENTS } from "@wren/channel-search/components";
import { SMS_COMPONENTS } from "@wren/channel-sms/components";
import { CONTENT_COMPONENTS } from "@wren/content/components";
import type { Component } from "@wren/core/components";
import { FACTS_COMPONENTS } from "@wren/core/facts";
import { FOLLOW_COMPONENTS } from "@wren/core/follow";
import { DELIVERY_COMPONENTS } from "@wren/delivery/components";
import { DOCUMENTS_COMPONENTS } from "@wren/documents/components";
import { LEARN_COMPONENTS } from "@wren/learn/components";
import { OUTREACH_COMPONENTS } from "@wren/outreach/components";
import { PAYMENTS_COMPONENTS } from "@wren/payments/components";
import { PIPELINE_COMPONENTS } from "@wren/pipeline/components";
import { REACTIVATION_COMPONENTS } from "@wren/reactivation/components";
import { RESEARCH_COMPONENTS } from "@wren/research/components";
import { SITES_COMPONENTS } from "@wren/sites/components";
import { VOICE_COMPONENTS } from "@wren/voice/components";
import { MAIL_COMPONENTS, WATCH_COMPONENTS } from "@wren/watch/components";
import { PLANNED_COMPONENTS } from "./planned.js";

export const COMPONENTS: readonly Component[] = [
  ...RESEARCH_COMPONENTS,
  ...EMAIL_COMPONENTS,
  ...SMS_COMPONENTS,
  ...REACTIVATION_COMPONENTS,
  ...DELIVERY_COMPONENTS,
  ...CONTENT_COMPONENTS,
  ...META_COMPONENTS,
  ...SEARCH_COMPONENTS,
  ...OUTREACH_COMPONENTS,
  ...BOOKS_COMPONENTS,
  ...CALENDAR_COMPONENTS,
  ...WATCH_COMPONENTS,
  ...MAIL_COMPONENTS,
  ...LEARN_COMPONENTS,
  ...VOICE_COMPONENTS,
  ...FOLLOW_COMPONENTS,
  ...FACTS_COMPONENTS,
  ...SITES_COMPONENTS,
  ...PAYMENTS_COMPONENTS,
  ...DOCUMENTS_COMPONENTS,
  ...PIPELINE_COMPONENTS,
  ...PLANNED_COMPONENTS,
];

/** Services and apps that are the platform itself, not a feature anyone installs. */
export const PLATFORM = {
  services: {
    ConsolePortal: "the console: loops, handlers, records, clients and installs",
    Ask: "a question to Claude Code on the Mac, answered on its runs row",
    Tokens: "who an AI tool's access token acts as, for the portal's agent door",
    Executor: "events along every workflow's routed wires, and the door's webhooks",
    ExecutorClock: "a Schedule trigger node's clock: ticks each slot into its workflow",
    AuditSealer: "seals the audit log every write lands in",
    TokenRenewal: "renews every site's tokens, for content and ads alike",
    VaultKeys:
      "mirrors the operator's API keys from autobrowse's vault; rotate, revoke, mark spent",
    TemplatesConsole: "the Library's templates: save, publish, approve, restore, reset",
    SetupWatch: "checks every set-up account again on its repeat, and starts a lost one over",
    DeadLetters: "files every call Restate gave up on as a dead letter and tells Discord once",
    LoopWatch: "wakes a loop that stopped on its own and names one stuck behind a call, once each",
    SetupAgent: "a done-for-you setup step, run by autobrowse do in the account owner's autobrowse",
    AccountsConsole: "a client's accounts, setups and vendor modes",
    PeopleConsole: "People in every workspace: records, groups, Describe group, broadcasts",
    Segments:
      "a workspace's groups kept true; entries, exits, traits and dates told to the executor",
    SegmentsNet: "wakes every workspace's groups pass every 15 minutes",
    PeopleMap: "a workspace's people map: each person's stage, warmth and persona rebuilt",
    PeopleMapNet: "wakes every workspace's people map every 15 minutes",
    TouchFeed: "every minute: each workspace's new social touches told to the executor, once each",
    SourcedFeed: "people added to a list a sourced source takes people from open journeys there",
    Decide:
      "every 10 minutes: drafted comments and Learn items judged by Jev, each answer logged beside his call",
    ProfileResearch:
      "Research this person: Exa, Google and the account look for a profile's pages elsewhere, findings kept per profile",
    Broadcast: "one approved broadcast: started on its time, then a batch of its people per run",
    MailAccess: "Account → Mail: a client's mailboxes, its admin's step, each mailbox's sign-in",
    MailCallback: "where Google and Microsoft send a mailbox's sign-in and an admin's consent back",
    SocialAccess: "Account → Social: a client's own social accounts, each one's state and sign-in",
    SocialCallback: "where each social platform sends an account's sign-in back",
    Connectors: "Account → Connectors: a client's HubSpot, QuickBooks or Jobber, each one sign-in",
    ConnectorCallback: "where HubSpot, QuickBooks and Jobber send a connection's sign-in back",
    ConnectorSync: "one connected app's hourly read: people into the CRM, changes to the executor",
    MailReply: "a reply from the Inbox to a client's mail, sent through its own mailbox",
    SocialInbox: "a client's DMs in, and its DM and comment answers out, on its own accounts",
    NotesConsole: "notes: docs with versions, sharing and links, in every workspace",
    HealthConsole: "each client's health and the flags about it: rate, override, raise, clear",
    BillingWatch:
      "Wren's own billing: the month's invoices made and mailed, money in read from Wise and matched",
    BillingConsole: "money in by bank transfer: put a credit on an invoice, or set it aside",
    Webhooks:
      "a client's own URLs hear its events: subscriptions, signed deliveries, the retry ladder",
  },
  apps: {
    account: "every client's account: people, look, billing",
    loops: "every loop, whoever's it is",
    handlers: "every handler, as a form",
    clients: "the client registry",
    team: "Wren's team and their roles",
    marketplace: "every component, and the browser mods",
    workflows: "every workflow, drawn with live numbers",
    ask: "questions to Claude Code about the system, read only",
    review: "the Friday review of parked ideas",
    settings: "your layout and look, and a guide to every app and key",
    library: "every template, prompt and sequence, with their numbers",
    notes: "docs for Wren's team and each client's people, with versions and sharing",
    learn: "saved links and followed sources, read and kept like a drive, in every workspace",
    people: "everyone a workspace knows, and every message sent to them",
  },
  records: {
    "console.ask": "every question asked of Claude Code",
    "console.client": "the client registry",
    "console.health": "each client's health, its four parts and the override beside it",
    "console.health_day": "every client's health, a row a day, kept",
    "console.health_input": "the rows behind each client's latest health",
    "console.flag": "risks and opportunities about each client, raised to cleared",
    "console.loop": "every loop",
    "console.handler": "every handler",
    "console.component": "every component",
    "console.team": "Wren's team",
    "console.change": "who changed what, from the audit log",
    "console.event": "every executor arrival, failed ones with Retry",
    "console.execution": "each subject's walk through a workflow, its path lit",
    "delivery.change": "who changed an account's rows, from the audit log",
    "delivery.messaging": "an account's message rules: the per-person cap and link tags",
    "wren.parked": "parked ideas and their triggers",
    "people.sent": "every message we sent, on any channel, with one state ladder",
    "people.profile": "one person, by every address they use",
    "people.event": "each line of a person's timeline, read from its own table",
    "people.key": "each email, phone, handle or cookie a person goes by",
    "people.trait": "what we know of a person, one value per trait, every change kept",
    "people.merge": "two profiles found to be one person, and what moved",
    "people.datum": "every address kind, trait and timeline kind, who has it, what uses it",
    "people.segment": "a saved list of people: live, by hand or a snapshot",
    "people.member": "who is in each group, and since when",
    "people.finding":
      "what a research run found about a person: a handle, a page, a job, kept or dropped",
    "people.broadcast": "one message to a group, from draft to sent",
    "people.recipient": "who each broadcast went to, and how each send ended",
    "templates.template": "every template, with its live copy and its numbers",
    "templates.version": "each saved version of a template, to restore",
    "templates.variant": "a template's variants and how each one does",
    "templates.sequence": "a sequence of touches, and what each one sends",
    "templates.step": "one touch of a sequence",
    "library.snippet": "a saved piece of copy any template can use",
    "library.workflow": "every workflow, as a Library row",
    "console.credit": "money in by bank transfer, and the invoice each paid",
    "console.setting": "each part's settings block, as a form",
    "console.hold": "units held out of a stage and sources paused on one, with Release",
    "console.check": "each check's pass rate per stage and source; a low rate pauses a source",
    "console.automation":
      "every automation in one list: workflows, loops, keyword DMs, auto-replies",
    "loops.flag": "feature flags and their rules, for logins and the site",
    "notes.mention": "where you were @ed in a note",
    "notes.task": "a board's cards, as a list",
    "access.role": "the roles and what each may do",
    "access.grant": "a scoped grant: an app, channel or record, with a time limit",
    "access.review": "each person's access, for review",
    "access.issue": "a problem found in who can do what",
    "access.ask": "a request for access, approved or declined",
  },
} as const;
