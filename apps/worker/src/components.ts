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
import { LEARN_COMPONENTS } from "@wren/learn/components";
import { OUTREACH_COMPONENTS } from "@wren/outreach/components";
import { REACTIVATION_COMPONENTS } from "@wren/reactivation/components";
import { RESEARCH_COMPONENTS } from "@wren/research/components";
import { VOICE_COMPONENTS } from "@wren/voice/components";
import { WATCH_COMPONENTS } from "@wren/watch/components";
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
  ...LEARN_COMPONENTS,
  ...VOICE_COMPONENTS,
  ...FOLLOW_COMPONENTS,
  ...FACTS_COMPONENTS,
  ...PLANNED_COMPONENTS,
];

/** Services and apps that are the platform itself, not a feature anyone installs. */
export const PLATFORM = {
  services: {
    ConsolePortal: "the console: loops, handlers, records, clients and installs",
    Ask: "a question to Claude Code on the Mac, answered on its runs row",
    Spine: "events along every workflow's routed wires, and the door's webhooks",
    SpineClock: "a Schedule trigger node's clock: ticks each slot into its workflow",
    AuditSealer: "seals the audit log every write lands in",
    TokenRenewal: "renews every site's tokens, for content and ads alike",
    TemplatesConsole: "the Library's templates: save, publish, approve, restore, reset",
    SetupWatch: "checks every set-up account again on its repeat, and starts a lost one over",
    SetupAgent: "a done-for-you setup step, run by autobrowse do in the account owner's autobrowse",
    AccountsConsole: "a client's accounts, setups and vendor modes",
    NotesConsole: "notes: docs with versions, sharing and links, in every workspace",
    HealthConsole: "each client's health and the flags about it: rate, override, raise, clear",
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
    library: "every template, prompt and sequence, with their numbers",
    notes: "docs for Wren's team and each client's people, with versions and sharing",
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
    "console.event": "every spine arrival, failed ones with Retry",
    "console.execution": "each subject's walk through a workflow, its path lit",
    "delivery.change": "who changed an account's rows, from the audit log",
    "wren.parked": "parked ideas and their triggers",
  },
} as const;
