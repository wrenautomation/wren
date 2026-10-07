/** The client's account, reached from their name at top left: the company, its people, each person's own settings, billing. */
import { createElement } from "react";
import type { Module } from "../../module.js";
import { inboxPages, managePages } from "../access/index.js";
import { Domain } from "./Domain.js";
import { Included } from "./Included.js";
import { Look } from "./Look.js";
import { Overview } from "./Overview.js";
import { People } from "./People.js";
import { You } from "./You.js";

export const account: Module = {
  id: "account",
  name: "Account",
  icon: "sliders",
  blurb:
    "Your company's details, who can see your projects, your email settings, your look, invoices and who changed what.",
  menu: true,
  // The demo is nobody's account.
  requires: { audience: "client" },
  pages: [
    { id: "overview", label: "Overview", Page: Overview },
    { id: "people", label: "People", Page: People },
    { id: "you", label: "Your settings", Page: You },
    { id: "look", label: "Look", Page: Look, requires: { needs: "manage" } },
    { id: "domain", label: "Domain", Page: Domain },
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
    ...managePages(false),
    ...inboxPages(),
    {
      id: "changes",
      label: "Changes",
      requires: { needs: "manage" },
      template: "list",
      record: "delivery.change",
      empty: { today: "No changes today.", people: "Nobody changed anything by hand this week." },
      columns: ["at", "who", "op", "table", "change"],
    },
  ],
};
