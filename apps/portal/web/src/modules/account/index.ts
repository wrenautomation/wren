/** The client's account, reached from their name at top left: the company, its people, each person's own settings, billing. */
import type { Module } from "../../module.js";
import { Billing } from "./Billing.js";
import { Overview } from "./Overview.js";
import { People } from "./People.js";
import { You } from "./You.js";

export const account: Module = {
  id: "account",
  name: "Account",
  icon: "sliders",
  blurb: "Your company's details, who can see your projects, your email settings and invoices.",
  menu: true,
  // The demo is nobody's account.
  requires: { audience: "client" },
  pages: [
    { id: "overview", label: "Overview", Page: Overview },
    { id: "people", label: "People", Page: People },
    { id: "you", label: "Your settings", Page: You },
    { id: "billing", label: "Billing", Page: Billing },
  ],
};
