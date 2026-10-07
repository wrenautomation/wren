/** The client's account, reached from their name at top left: the company, its people, each person's own settings, billing. */
import { createElement } from "react";
import type { ListPage, Module } from "../../module.js";
import { inboxPages, managePages } from "../access/index.js";
import { Accounts } from "./Accounts.js";
import { Domain } from "./Domain.js";
import { Included } from "./Included.js";
import { Look } from "./Look.js";
import { nowCount } from "./Now.js";
import { Overview } from "./Overview.js";
import { People } from "./People.js";
import { Vendors } from "./Vendors.js";
import { You } from "./You.js";

/** Pages under one sidebar heading; with `id`, only that one. */
const inGroup = (pages: ListPage[], group: string, id?: string): ListPage[] =>
  pages.filter((p) => !id || p.id === id).map((p) => ({ ...p, group }));

export const account: Module = {
  id: "account",
  name: "Account",
  icon: "sliders",
  blurb:
    "Your company's details, who can see your projects, your email settings, your look, the accounts and vendors Wren works in, invoices and who changed what.",
  menu: true,
  // The demo is nobody's account.
  requires: { audience: "client" },
  // Grouped, so a phone reads two short rows of tabs.
  pages: [
    { id: "overview", label: "Overview", Page: Overview },
    { id: "you", label: "Your settings", Page: You },
    { id: "people", label: "People", Page: People, group: "People" },
    ...inGroup(managePages(false), "People"),
    ...inGroup(inboxPages(), "People", "asks"),
    { id: "look", label: "Look", Page: Look, requires: { needs: "manage" }, group: "Setup" },
    { id: "domain", label: "Domain", Page: Domain, group: "Setup" },
    { id: "accounts", label: "Accounts", Page: Accounts, group: "Setup", badge: nowCount },
    { id: "vendors", label: "Vendors", Page: Vendors, group: "Setup" },
    {
      id: "billing",
      label: "Billing",
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
      group: "Activity",
      requires: { needs: "manage" },
      template: "list",
      record: "delivery.change",
      empty: { today: "No changes today.", people: "Nobody changed anything by hand this week." },
      columns: ["at", "who", "op", "table", "change"],
    },
  ],
};
