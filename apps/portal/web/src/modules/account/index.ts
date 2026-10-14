/** The client's account, reached from their name at top left: the company, its people, each person's own settings, billing. */
import { createElement } from "react";
import type { ListPage, Module } from "../../module.js";
import { inboxPages, managePages } from "../access/index.js";
import { Accounts } from "./Accounts.js";
import { AiTools } from "./AiTools.js";
import { Connectors } from "./Connectors.js";
import { Domain } from "./Domain.js";
import { Facts, Fields } from "./Fields.js";
import { Included } from "./Included.js";
import { Look } from "./Look.js";
import { Mail } from "./Mail.js";
import { nowCount } from "./Now.js";
import { Overview } from "./Overview.js";
import { People } from "./People.js";
import { Social } from "./Social.js";
import { Vendors } from "./Vendors.js";
import { Webhooks } from "./Webhooks.js";
import { You } from "./You.js";

/** Pages under one sidebar heading; with `id`, only that one. */
const inGroup = (pages: ListPage[], group: string, id?: string): ListPage[] =>
  pages.filter((p) => !id || p.id === id).map((p) => ({ ...p, group }));

export const account: Module = {
  id: "account",
  name: "Account",
  icon: "sliders",
  blurb:
    "Your company's details, who can see your projects, your email settings, your look, your mailboxes, your social accounts, the accounts and vendors Wren works in, webhooks, AI tools, your own fields and business facts, invoices and who changed what.",
  menu: true,
  // The demo is nobody's account.
  requires: { audience: "client" },
  // Grouped, so a phone reads two short rows of tabs.
  pages: [
    {
      id: "overview",
      label: "Overview",
      about: "What you have with us, who's on your account and what's owed.",
      Page: Overview,
    },
    { id: "you", label: "Your settings", about: "Settings that are just for you.", Page: You },
    {
      id: "people",
      label: "People",
      about: "Everyone on your account, and their roles.",
      Page: People,
      group: "People",
    },
    ...inGroup(managePages(false), "People"),
    ...inGroup(inboxPages(), "People", "asks"),
    {
      id: "look",
      label: "Look",
      about: "Your workspace's colors.",
      Page: Look,
      requires: { needs: "manage" },
      group: "Setup",
    },
    {
      id: "domain",
      label: "Domain",
      about: "Open this portal at your own web address.",
      Page: Domain,
      group: "Setup",
    },
    {
      id: "accounts",
      label: "Accounts",
      about: "Each account Wren works in for you, and what's left to set up.",
      Page: Accounts,
      group: "Setup",
      badge: nowCount,
    },
    {
      id: "mail",
      label: "Mail",
      about: "The mailboxes Wren sends from and reads.",
      Page: Mail,
      group: "Setup",
    },
    {
      id: "social",
      label: "Social",
      about: "The social accounts Wren posts from and answers on.",
      Page: Social,
      group: "Setup",
    },
    {
      id: "connectors",
      label: "Connectors",
      about: "The apps you already use, which Wren reads every hour.",
      Page: Connectors,
      group: "Setup",
    },
    {
      id: "vendors",
      label: "Vendors",
      about: "The services your work runs on, and this month's use.",
      Page: Vendors,
      group: "Setup",
    },
    {
      id: "webhooks",
      label: "Webhooks",
      about: "Send events to your own tools as they happen.",
      Page: Webhooks,
      group: "Setup",
    },
    {
      id: "ai",
      label: "AI tools",
      about: "Let Claude Code or your own script use your Wren.",
      Page: AiTools,
      group: "Setup",
    },
    {
      id: "fields",
      label: "Fields",
      about: "Your own fields on your lists.",
      Page: Fields,
      group: "Setup",
    },
    {
      id: "facts",
      label: "Business facts",
      about: "Your phone, address, hours and the like, kept in one place.",
      Page: Facts,
      group: "Setup",
    },
    {
      id: "billing",
      label: "Billing",
      about: "Your invoices from Wren, paid and due.",
      requires: { needs: "money" },
      template: "list",
      record: "delivery.invoice",
      empty: {
        all: "Invoices show here when Wren sends one. Each also comes by email with a link to pay in Wise.",
        open: "Nothing to pay.",
      },
      columns: ["status", "amount", "due", "description", "link"],
      head: (_meta, _reload, { client }) => createElement(Included, { client }),
    },
    ...inGroup(inboxPages(), "Activity", "issues"),
    {
      id: "changes",
      label: "Changes",
      about: "Who changed what in your account.",
      group: "Activity",
      requires: { needs: "manage" },
      template: "list",
      record: "delivery.change",
      empty: { today: "No changes today.", people: "Nobody changed anything by hand this week." },
      columns: ["at", "who", "op", "table", "change"],
    },
  ],
};
