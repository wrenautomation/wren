/**
 * Wren's own apps, in Wren's workspace only (team view): each an Overview of its numbers, then
 * its records on the templates. The console serves every record here.
 */

import { type Action, said } from "@wren/ui";
import { createElement } from "react";
import { findRecords } from "../../find.js";
import type { Module } from "../../module.js";
import { grantsPage } from "../access/index.js";
import { PersonAccess } from "../access/PersonAccess.js";
import { Domain } from "../account/Domain.js";
import { ClientComponents } from "../account/Installed.js";
import { ClientLook } from "../account/Look.js";
import { People } from "../account/People.js";
import { ClientAccounts } from "../account/summary.js";
import { ClientAutonomy } from "../agent/autonomy.js";
import { CREDIT_ACTIONS } from "./credits.js";
import { AiSpend, idOf } from "./heads.js";
import { MoneyOverview } from "./money.js";

const TEAM = { audience: "team" } as const;
const overview = { id: "overview", label: "Overview", template: "overview" } as const;

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
    icon: "play",
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
    icon: "pause",
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
    icon: "play",
    handler: "email/resume",
    confirm: "Start sending from it again?",
    bulk: true,
    when: { state: ["paused"] },
    done: said("Sending again"),
  },
];

const CLIENT_ACTIONS: Action[] = [
  {
    id: "console.addClient",
    label: "Add client",
    handler: "console/addClient",
    form: [
      { field: "name", label: "Name" },
      {
        field: "id",
        label: "Short name",
        hint: "Lowercase letters, numbers and underscores. It can't change later.",
        pattern: "[a-z][a-z0-9_]{0,39}",
        from: ({ name = "" }) => idOf(name),
      },
    ],
    done: (made) => `Added ${(made as { name?: string }).name ?? "the client"}`,
  },
  {
    // An owner, so they can invite the rest of their team from Account.
    id: "delivery.invite",
    label: "Invite",
    icon: "addPerson",
    handler: "delivery/invite",
    each: true,
    form: [
      {
        field: "email",
        label: "Their work email",
        hint: "They sign in with it, as an owner: they invite the rest of their team.",
      },
    ],
    when: { kind: ["client"] },
    done: () => "Invited",
  },
];

export const outbound: Module = {
  id: "outbound",
  name: "Outbound",
  component: "email.sequences",
  icon: "mail",
  blurb: "Cold email campaigns and the inboxes that send them.",
  requires: TEAM,
  pages: [
    {
      ...overview,
      about: "Cold email campaigns and inboxes, at a glance.",
      tiles: [
        {
          label: "Inboxes sending",
          record: "email.inbox",
          href: "/campaigns/inboxes?view=sending",
        },
        {
          label: "Inboxes paused",
          record: "email.inbox",
          href: "/campaigns/inboxes?view=paused",
          needs: true,
        },
        {
          label: "Campaigns opening",
          record: "email.campaign",
          href: "/campaigns/email-campaigns?view=opening",
        },
      ],
      top: [
        {
          label: "Campaigns",
          record: "email.campaign",
          href: "/campaigns/email-campaigns?view=all",
          fields: ["sent", "replyRate", "killSwitch"],
          empty: "No campaigns yet.",
        },
        {
          label: "Paused inboxes",
          record: "email.inbox",
          href: "/campaigns/inboxes?view=paused",
          fields: ["reason", "pausedAt"],
          empty: "Every inbox is sending.",
        },
      ],
    },
    {
      id: "campaigns",
      label: "Campaigns",
      about: "Every cold email campaign, and how it's doing.",
      template: "list",
      record: "email.campaign",
      empty: "Campaigns show here once they start.",
      actions: CAMPAIGN_ACTIONS,
    },
    {
      id: "inboxes",
      label: "Inboxes",
      about: "The mailboxes we send cold email from, and their health.",
      template: "list",
      record: "email.inbox",
      empty: { paused: "Every inbox is sending.", sending: "No inbox is sending." },
      actions: INBOX_ACTIONS,
    },
  ],
};

export const money: Module = {
  id: "money",
  name: "Money",
  component: "books",
  icon: "money",
  blurb: "What Wren spends, what renews soon, and what a client costs and earns.",
  requires: { ...TEAM, needs: "money" },
  pages: [
    {
      id: "overview",
      label: "Overview",
      about: "Where Wren's money goes, at a glance.",
      Page: MoneyOverview,
      wide: true,
    },
    {
      id: "spend",
      label: "Spend",
      about: "Everything we spend, by vendor and month.",
      template: "list",
      record: "books.spend",
      empty: "Spend shows here once the books import it.",
    },
    {
      id: "subscriptions",
      label: "Subscriptions",
      about: "Every subscription we pay for.",
      template: "list",
      record: "books.subscription",
      empty: "Subscriptions show here once the books find them.",
    },
    {
      id: "models",
      label: "Model usage",
      about: "AI model calls, and what they cost.",
      template: "list",
      record: "email.model",
      empty: "Model calls show here once a run makes them.",
      head: () => createElement(AiSpend),
    },
    {
      id: "payments-in",
      label: "Payments in",
      about: "Bank transfers from clients, and the invoice each one paid.",
      template: "list",
      record: "console.credit",
      actions: CREDIT_ACTIONS,
      count: { status: ["review"] },
      empty: {
        review: "No payments waiting.",
        matched: "Paid invoices show here.",
        all: "Payments show here when a client sends one.",
        own: "Transfers between our own balances show here.",
      },
      columns: ["status", "amount", "invoice", "client", "why", "at"],
    },
  ],
};

export const clients: Module = {
  id: "clients",
  name: "Clients",
  icon: "people",
  blurb: "Every client: what they bought and how it goes.",
  requires: TEAM,
  find: findRecords({ record: "console.client", path: "/people/clients", kind: "Client" }),
  pages: [
    {
      id: "all",
      label: "Clients",
      about: "Every client, with what they bought and how it's going.",
      template: "list",
      record: "console.client",
      empty: "Clients show here once you add one.",
      actions: CLIENT_ACTIONS,
      // The subaccount, set up from here: its people and roles, apps, look and domain. Its
      // portal look shows on the demo too, so the demo can show one.
      extras: (_, { row }) => {
        const client = String(row.id);
        const as = { client, demo: false, team: true, params: new URLSearchParams(), bare: true };
        const real = row.kind === "client";
        return {
          sections: [
            ["People", real ? createElement(People, as) : "A demo has no people."],
            ["Products", createElement(ClientComponents, { client })],
            ["Accounts", createElement(ClientAccounts, { client })],
            ["Look", createElement(ClientLook, { client })],
            ["Agent", createElement(ClientAutonomy, { client })],
            ["Domain", real ? createElement(Domain, as) : "A demo keeps Wren's address."],
          ],
        };
      },
    },
  ],
};

const ROLES = ["operator", "viewer", "admin"] as const;
const CLIENTS_HINT =
  'Client ids split by commas, and "wren" for Wren\'s own apps. Blank is every client.';
const ROLE_HINT = "A custom role, like a manager: Roles, then Give to.";
const TEAM_ACTS: Action[] = [
  {
    id: "console.teamInvite",
    label: "Invite",
    icon: "addPerson",
    handler: "console/teamSet",
    form: [
      { field: "email", label: "Their work email", hint: "They sign in with it." },
      { field: "role", label: "Role", type: "select", options: ROLES, hint: ROLE_HINT },
      { field: "clients", label: "Clients", optional: true, hint: CLIENTS_HINT },
    ],
    done: () => "Invited",
  },
  {
    id: "console.teamRole",
    label: "Change role",
    handler: "console/teamRole",
    each: true,
    form: [{ field: "role", label: "Role", type: "select", options: ROLES, hint: ROLE_HINT }],
    done: said("Role changed"),
  },
  {
    id: "console.teamClients",
    label: "Set clients",
    handler: "console/teamClients",
    each: true,
    form: [{ field: "clients", label: "Clients", optional: true, hint: CLIENTS_HINT }],
    done: said("Clients set"),
  },
  {
    id: "console.teamRemove",
    label: "Remove",
    icon: "trash",
    handler: "console/teamRemove",
    confirm: "Remove them from the team? They're signed out at once.",
    done: said("Removed"),
  },
];
const TEAM_ACTIONS = TEAM_ACTS.map((a): Action => ({ ...a, requires: { needs: "team" } }));

/** How Wren itself runs: portal speed per route (designs/2026-11-13-portal-speed.md). */
export const system: Module = {
  id: "system",
  name: "System",
  icon: "gauge",
  blurb: "How fast the portal answers, per route.",
  requires: TEAM,
  pages: [
    {
      id: "speed",
      label: "Speed",
      about:
        "How long each call a person waits on takes, slowest first: wait in the queue, then run.",
      template: "list",
      record: "console.speed",
      empty: "Speed shows here once people use the portal.",
      columns: ["route", "lane", "calls", "p50", "p90", "p99", "waitP90", "runP90", "failed"],
      views: { today: { phone: "p90" }, week: { phone: "p90" } },
    },
  ],
};

/** Wren's team: who signs in, as what, over which clients. An admin's alone. */
export const team: Module = {
  id: "team",
  name: "Team",
  // Roles and access; Clients has the people.
  icon: "shield",
  blurb: "Who on Wren's team signs in, their role, which clients they see, and who changed what.",
  requires: { ...TEAM, needs: "team" },
  pages: [
    {
      id: "all",
      label: "Team",
      about: "Your team, and when each person last signed in.",
      template: "list",
      record: "console.team",
      empty: "Your team shows here once someone is invited.",
      actions: TEAM_ACTIONS,
      // Their role and extra grants, as sentences, with Add and End now.
      extras: (_detail, { client, row }) => ({
        sections: [
          [
            "Access",
            createElement(PersonAccess, {
              client,
              email: String(row.id),
              role: String(row.role),
            }),
          ],
        ],
      }),
    },
    grantsPage(true),
  ],
};
