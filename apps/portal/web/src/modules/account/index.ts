import { createElement } from "react";
import type { Module } from "../../module.js";
import { grantsPage } from "../access/index.js";
import { Accounts } from "./Accounts.js";
import { invoiceExtras } from "./billing.js";
import { Included } from "./Included.js";
import { Look } from "./Look.js";
import { Mail } from "./Mail.js";
import { nowCount } from "./Now.js";
import { Overview } from "./Overview.js";
import { People } from "./People.js";
import { Social } from "./Social.js";
import { You } from "./You.js";

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
    { ...grantsPage(false), group: "People" },
    {
      id: "look",
      label: "Look",
      about: "Your workspace's colors.",
      Page: Look,
      requires: { needs: "manage" },
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
      id: "billing",
      label: "Billing",
      about: "Your invoices from Wren, paid and due.",
      requires: { needs: "money" },
      template: "list",
      record: "delivery.invoice",
      empty: {
        all: "Your invoices from Wren show up here. We email each one too, with the bank details to pay it.",
        open: "Nothing to pay.",
      },
      columns: ["status", "amount", "due", "description"],
      extras: invoiceExtras,
      head: (_meta, _reload, { client }) => createElement(Included, { client }),
    },
  ],
};
