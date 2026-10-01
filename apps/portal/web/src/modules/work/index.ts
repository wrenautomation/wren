/** The work we do for a client, whatever they bought: plan, timeline, deliverables, asks, results. */
import type { Module } from "../../module.js";
import { Deliverables } from "./Deliverables.js";
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
  // The demo shows the products; a client's project lives on app. only.
  noDemo: true,
  pages: [
    { id: "home", label: "Home", icon: "home", Page: Home },
    { id: "plan", label: "Plan", icon: "clock", Page: Plan },
    { id: "updates", label: "Updates", icon: "pulse", Page: Updates },
    { id: "deliverables", label: "Deliverables", icon: "check", Page: Deliverables },
    { id: "needs-you", label: "Needs you", icon: "reply", Page: Needs },
    { id: "results", label: "Results", icon: "sliders", Page: Results },
    { id: "settings", label: "Settings", icon: "people", Page: Settings },
  ],
};
