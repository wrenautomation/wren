/** Reactivation: past clients checked for a reason to call, with a brief and an email for each. */
import type { Module } from "../../module.js";
import { Emails } from "./Emails.js";
import { Health } from "./Health.js";
import { REACTIVATION } from "./nav.js";
import { Overview } from "./Overview.js";
import { People } from "./People.js";
import { Replies } from "./Replies.js";
import { Run } from "./Run.js";
import { Setup } from "./Setup.js";
import { Sources } from "./Sources.js";
import "./reactivation.css";

export const reactivation: Module = {
  id: REACTIVATION,
  name: "Reactivation",
  action: { page: "run", label: "Watch it run", icon: "play" },
  pages: [
    { id: "overview", label: "Home", icon: "home", Page: Overview },
    { id: "run", label: "Run", icon: "play", Page: Run },
    { id: "people", label: "People", icon: "people", Page: People },
    { id: "emails", label: "Emails", icon: "mail", Page: Emails },
    { id: "replies", label: "Replies", icon: "reply", Page: Replies },
    { id: "health", label: "Data health", icon: "pulse", Page: Health },
    { id: "sources", label: "Sources", icon: "link", Page: Sources },
    { id: "setup", label: "Setup", icon: "sliders", Page: Setup },
  ],
};
