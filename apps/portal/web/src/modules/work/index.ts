/** The work we do for a client, whatever they bought: plan, timeline, deliverables, asks, results. */
import type { Module } from "../../module.js";
import { Deliverables } from "./Deliverables.js";
import { Glance } from "./Glance.js";
import { Home } from "./Home.js";
import { Needs } from "./Needs.js";
import { WORK } from "./nav.js";
import { Plan } from "./Plan.js";
import { Results } from "./Results.js";
import { Settings } from "./Settings.js";
import { Updates } from "./Updates.js";
import "./work.css";

export const work: Module = {
  id: WORK,
  name: "Your project",
  icon: "flag",
  blurb: "How far along the work is, and what we need from you next.",
  Glance,
  // The demo shows the products; a client's project lives on app. only.
  noDemo: true,
  pages: [
    { id: "home", label: "Overview", Page: Home },
    { id: "plan", label: "Plan", Page: Plan },
    { id: "updates", label: "Updates", Page: Updates },
    { id: "deliverables", label: "Deliverables", Page: Deliverables },
    { id: "needs-you", label: "Needs you", Page: Needs },
    { id: "results", label: "Results", Page: Results },
    { id: "settings", label: "Settings", Page: Settings },
  ],
};
