/**
 * Plan & paperwork: what surrounds the work, whatever they bought. The contract, setup fee and
 * access first; then the plan, timeline, deliverables, asks and results.
 */
import type { Module } from "../../module.js";
import { Contract } from "./Contract.js";
import { Deliverables } from "./Deliverables.js";
import { Glance } from "./Glance.js";
import { Home } from "./Home.js";
import { Needs } from "./Needs.js";
import { WORK } from "./nav.js";
import { Paperwork } from "./Paperwork.js";
import { Plan } from "./Plan.js";
import { Results } from "./Results.js";
import { Updates } from "./Updates.js";
import { Welcome } from "./Welcome.js";
import "./work.css";

export const work: Module = {
  id: WORK,
  name: "Plan & paperwork",
  icon: "flag",
  blurb: "Your contract, the plan, how far along it is, and what we need from you next.",
  companion: true,
  Glance,
  // The demo shows the products; a client's project lives on app. only.
  noDemo: true,
  pages: [
    { id: "home", label: "Overview", Page: Home },
    { id: "paperwork", label: "Paperwork", Page: Paperwork },
    { id: "plan", label: "Plan", Page: Plan },
    { id: "updates", label: "Updates", Page: Updates },
    { id: "deliverables", label: "Deliverables", Page: Deliverables },
    { id: "needs-you", label: "Needs you", Page: Needs },
    { id: "results", label: "Results", Page: Results },
    { id: "contract", label: "Contract", Page: Contract, hidden: true },
    { id: "welcome", label: "Welcome guide", Page: Welcome, hidden: true },
  ],
};
