/** Reactivation: past clients checked for a reason to call, with a brief and an email for each. */
import type { Module } from "../../module.js";
import { ENGAGEMENT_PAGES } from "../work/index.js";
import { EMAIL_ACTIONS, EMAIL_EMPTY, emailExtras, emailLegacy } from "./email.js";
import { Glance } from "./Glance.js";
import { Health } from "./Health.js";
import { REACTIVATION } from "./nav.js";
import { Overview } from "./Overview.js";
import { personExtras, personLegacy } from "./person.js";
import { Replies } from "./Replies.js";
import { Run } from "./Run.js";
import { Setup } from "./Setup.js";
import { Sources } from "./Sources.js";
import "./reactivation.css";

export const reactivation: Module = {
  id: REACTIVATION,
  name: "Reactivation",
  icon: "cycle",
  blurb:
    "Checks your past clients for a reason to call now. Each gets a brief and an email that waits for your OK.",
  Glance,
  action: { page: "run", label: "Watch it run", icon: "play" },
  pages: [
    { id: "overview", label: "Overview", Page: Overview },
    { id: "run", label: "Run", Page: Run },
    {
      id: "people",
      label: "People",
      template: "list",
      record: "reactivation.person",
      empty: "Everyone on your list shows here once it loads, ranked by why to call now.",
      columns: ["title", "company", "now", "score", "lastContact", "email"],
      extras: personExtras,
      legacy: personLegacy,
    },
    {
      id: "emails",
      label: "Emails",
      template: "queue",
      record: "reactivation.email",
      empty: EMAIL_EMPTY,
      actions: EMAIL_ACTIONS,
      extras: emailExtras,
      legacy: emailLegacy,
    },
    { id: "replies", label: "Replies", Page: Replies },
    { id: "health", label: "Data health", Page: Health },
    { id: "sources", label: "Sources", Page: Sources },
    { id: "setup", label: "Setup", Page: Setup },
    // The client's plan and paperwork, here and not in an app of their own.
    ...ENGAGEMENT_PAGES,
  ],
};
