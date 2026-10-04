/**
 * Wren's own apps, in Wren's workspace only (team view): each an Overview of its numbers, then
 * its records on the templates. The console serves every record here.
 */
import type { Action } from "@wren/ui";
import { createElement } from "react";
import type { Module } from "../../module.js";
import { AddClient, AI_SPEND, AiSpend } from "./heads.js";

const TEAM = { audience: "team" } as const;
const overview = { id: "overview", label: "Overview", template: "overview" } as const;
const said = (line: string) => () => line;

const CAMPAIGN_ACTIONS: Action[] = [
  {
    id: "email.stopOpeners",
    label: "Stop openers",
    handler: "email/stopOpeners",
    undo: "email/resumeOpeners",
    bulk: true,
    when: { state: ["opening"] },
    done: said("Openers stopped"),
  },
  {
    id: "email.resumeOpeners",
    label: "Resume openers",
    handler: "email/resumeOpeners",
    undo: "email/stopOpeners",
    bulk: true,
    when: { state: ["follow_ups"] },
    done: said("Openers resumed"),
  },
  {
    id: "email.killSwitchOff",
    label: "Turn off kill switch",
    handler: "email/killSwitchOff",
    undo: "email/killSwitchOn",
    bulk: true,
    when: { killSwitch: ["on"] },
    done: said("Kill switch off"),
  },
  {
    id: "email.killSwitchOn",
    label: "Turn on kill switch",
    handler: "email/killSwitchOn",
    undo: "email/killSwitchOff",
    bulk: true,
    when: { killSwitch: ["off"] },
    done: said("Kill switch on"),
  },
];

const INBOX_ACTIONS: Action[] = [
  {
    id: "email.pause",
    label: "Pause",
    handler: "email/pause",
    ask: { field: "reason", label: "Why?" },
    undo: "email/resume",
    bulk: true,
    when: { state: ["sending"] },
    done: said("Paused"),
  },
  {
    id: "email.resume",
    label: "Resume",
    handler: "email/resume",
    confirm: "Start sending from it again?",
    bulk: true,
    when: { state: ["paused"] },
    done: said("Sending again"),
  },
];

const WAITING = { state: ["needs_you", "proposed"] };
const REPLY_ACTIONS: Action[] = [
  {
    id: "email.approve",
    label: "Send",
    handler: "email/approve",
    ask: { field: "body", label: "Your reply", from: "draft" },
    key: "a",
    when: WAITING,
    done: said("Sent"),
  },
  {
    id: "email.drop",
    label: "Don't answer",
    handler: "email/drop",
    confirm: "Leave this reply unanswered?",
    key: "s",
    when: WAITING,
    done: said("Left unanswered"),
  },
];

const LOOP_ACTIONS: Action[] = [
  {
    id: "console.stopLoop",
    label: "Stop",
    handler: "console/stopLoop",
    undo: "console/startLoop",
    bulk: true,
    when: { state: ["running"] },
    done: said("Stopped"),
  },
  {
    id: "console.startLoop",
    label: "Start",
    handler: "console/startLoop",
    undo: "console/stopLoop",
    bulk: true,
    when: { state: ["stopped"] },
    done: said("Started"),
  },
];

export const outbound: Module = {
  id: "outbound",
  name: "Outbound",
  icon: "mail",
  blurb: "Campaigns and the inboxes that send them.",
  requires: TEAM,
  pages: [
    {
      ...overview,
      tiles: [
        { label: "Replies", record: "email.reply", href: "/inbox/replies?view=all", period: 30 },
        { label: "Booked", record: "email.reply", href: "/inbox/replies?view=booked", period: 30 },
        {
          label: "Inboxes sending",
          record: "email.inbox",
          href: "/outbound/inboxes?view=sending",
        },
        {
          label: "Inboxes paused",
          record: "email.inbox",
          href: "/outbound/inboxes?view=paused",
          needs: true,
        },
        {
          label: "Campaigns opening",
          record: "email.campaign",
          href: "/outbound/campaigns?view=opening",
        },
      ],
      top: [
        {
          label: "Campaigns",
          record: "email.campaign",
          href: "/outbound/campaigns?view=all",
          fields: ["sent", "replyRate", "killSwitch"],
          empty: "No campaigns yet.",
        },
        {
          label: "Paused inboxes",
          record: "email.inbox",
          href: "/outbound/inboxes?view=paused",
          fields: ["reason", "pausedAt"],
          empty: "Every inbox is sending.",
        },
      ],
    },
    {
      id: "campaigns",
      label: "Campaigns",
      template: "list",
      record: "email.campaign",
      empty: "Campaigns show here once they start.",
      actions: CAMPAIGN_ACTIONS,
    },
    {
      id: "inboxes",
      label: "Inboxes",
      template: "list",
      record: "email.inbox",
      empty: { paused: "Every inbox is sending.", sending: "No inbox is sending." },
      actions: INBOX_ACTIONS,
    },
  ],
};

export const inbox: Module = {
  id: "inbox",
  name: "Inbox",
  icon: "reply",
  blurb: "Warm replies, each with a draft answer waiting for you.",
  requires: TEAM,
  pages: [
    {
      ...overview,
      tiles: [
        {
          label: "Waiting on you",
          record: "email.reply",
          href: "/inbox/replies?view=waiting",
          needs: true,
        },
        { label: "Replies", record: "email.reply", href: "/inbox/replies?view=all", period: 30 },
        { label: "Booked", record: "email.reply", href: "/inbox/replies?view=booked", period: 30 },
      ],
      top: [
        {
          label: "Waiting on you",
          record: "email.reply",
          href: "/inbox/replies?view=waiting",
          fields: ["company", "received"],
          empty: "Nothing is waiting on you.",
        },
      ],
    },
    {
      id: "replies",
      label: "Replies",
      template: "queue",
      record: "email.reply",
      empty: {
        waiting: "Warm replies wait here, each with a draft answer.",
        booked: "Booked calls show here.",
        all: "Warm replies show here.",
      },
      actions: REPLY_ACTIONS,
    },
  ],
};

export const loops: Module = {
  id: "loops",
  name: "Loops",
  icon: "clock",
  blurb: "Every scheduled job and which ones fail.",
  requires: TEAM,
  pages: [
    {
      ...overview,
      tiles: [
        { label: "Failing", record: "console.loop", href: "/loops/all?view=failing", needs: true },
        { label: "Stopped", record: "console.loop", href: "/loops/all?view=stopped" },
        { label: "Running", record: "console.loop", href: "/loops/all?view=all&state=running" },
      ],
      top: [
        {
          label: "Failing",
          record: "console.loop",
          href: "/loops/all?view=failing",
          fields: ["failures", "lastAt"],
          empty: "Nothing is failing.",
        },
      ],
    },
    {
      id: "all",
      label: "Loops",
      template: "list",
      record: "console.loop",
      empty: { failing: "Nothing is failing.", stopped: "Every loop is running." },
      actions: LOOP_ACTIONS,
    },
  ],
};

export const money: Module = {
  id: "money",
  name: "Money",
  icon: "money",
  blurb: "What Wren spends and what renews soon.",
  requires: TEAM,
  pages: [
    {
      ...overview,
      tiles: [
        {
          label: "Spend",
          record: "books.spend",
          href: "/money/spend?view=all",
          period: "month",
          sum: "amount",
        },
        {
          label: "AI spend",
          record: "books.spend",
          href: `/money/spend?view=all&${AI_SPEND}`,
          period: "month",
          sum: "amount",
        },
        {
          label: "Model calls",
          record: "email.model",
          href: "/money/models?view=all",
          period: "month",
          sum: "calls",
        },
        { label: "Subscriptions", record: "books.subscription", href: "/money/subscriptions" },
        {
          label: "Renewing soon",
          record: "books.subscription",
          href: "/money/subscriptions?view=soon",
          needs: true,
        },
      ],
      top: [
        {
          label: "Biggest spend this month",
          record: "books.spend",
          href: "/money/spend?view=this_month&sort=-amount",
          fields: ["account", "amount"],
          empty: "No spend this month yet.",
        },
        {
          label: "Renewing soon",
          record: "books.subscription",
          href: "/money/subscriptions?view=soon",
          fields: ["renewsOn", "cost"],
          empty: "Nothing renews soon.",
        },
      ],
    },
    {
      id: "spend",
      label: "Spend",
      template: "list",
      record: "books.spend",
      empty: "Spend shows here once the books import it.",
    },
    {
      id: "models",
      label: "Model usage",
      template: "list",
      record: "email.model",
      empty: "Model calls show here once a run makes them.",
      head: () => createElement(AiSpend),
    },
    {
      id: "subscriptions",
      label: "Subscriptions",
      template: "list",
      record: "books.subscription",
      empty: "Subscriptions show here once the books find them.",
    },
  ],
};

export const pipeline: Module = {
  id: "pipeline",
  name: "Pipeline",
  icon: "pulse",
  blurb: "Firms from found to verified lead, and where they stall.",
  requires: TEAM,
  pages: [
    {
      ...overview,
      tiles: [
        {
          label: "Firms found",
          record: "email.firm",
          href: "/pipeline/firms?view=in_play",
          period: 30,
        },
        {
          label: "With a domain",
          record: "email.firm",
          href: "/pipeline/firms?view=with_domain",
          period: 30,
        },
        {
          label: "Crawled",
          record: "email.firm",
          href: "/pipeline/firms?view=crawled",
          period: 30,
        },
        {
          label: "Named a person",
          record: "email.firm",
          href: "/pipeline/firms?view=named",
          period: 30,
        },
        {
          label: "Verified leads",
          record: "email.firm",
          href: "/pipeline/firms?view=lead",
          period: 30,
        },
        {
          label: "Crawled, no person",
          record: "email.firm",
          href: "/pipeline/firms?view=crawled&named=-",
          needs: true,
        },
        {
          label: "No domain yet",
          record: "email.firm",
          href: "/pipeline/firms?view=in_play&domain=-",
        },
      ],
      top: [
        {
          label: "Newest verified leads",
          record: "email.firm",
          href: "/pipeline/firms?view=lead&sort=-lead",
          fields: ["campaign", "lead"],
          empty: "No verified leads yet.",
        },
      ],
    },
    {
      id: "firms",
      label: "Firms",
      template: "list",
      record: "email.firm",
      empty: "Firms show here once a source finds them.",
    },
  ],
};

export const clients: Module = {
  id: "clients",
  name: "Clients",
  icon: "people",
  blurb: "Every client and when its team last looked.",
  requires: TEAM,
  pages: [
    {
      ...overview,
      tiles: [
        { label: "Clients", record: "console.client", href: "/clients/all?view=clients" },
        { label: "Added", record: "console.client", href: "/clients/all?view=all", period: 30 },
      ],
      top: [
        {
          label: "Last seen",
          record: "console.client",
          href: "/clients/all?view=all&sort=-lastSeen",
          fields: ["members", "lastSeen"],
          empty: "No clients yet.",
        },
      ],
    },
    {
      id: "all",
      label: "Clients",
      template: "list",
      record: "console.client",
      empty: "Clients show here once you add one.",
      head: (meta, reload) =>
        meta.actions.includes("console.addClient") ? createElement(AddClient, { reload }) : null,
    },
  ],
};

export const WREN_APPS = [outbound, inbox, loops, money, pipeline, clients];
