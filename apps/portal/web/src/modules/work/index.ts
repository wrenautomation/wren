/**
 * The engagement kit: the contract, setup fee and access first; then the plan, updates,
 * deliverables, asks and results. A product's app adds these pages to its own; the work app
 * shows them for offers without an app.
 */
import type { Module, ModulePage } from "../../module.js";
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

export { Checklist, EngagementBar } from "./Home.js";

/**
 * The plan's pages for a product's app: the ones a client opens often as tabs, the rest by
 * link. A client's own, so never on the demo.
 */
export const ENGAGEMENT_PAGES: ModulePage[] = [
  { id: "plan", label: "Plan", Page: Plan, noDemo: true },
  { id: "updates", label: "Updates", Page: Updates, noDemo: true },
  { id: "needs-you", label: "Needs you", Page: Needs, noDemo: true },
  { id: "paperwork", label: "Paperwork", Page: Paperwork, noDemo: true },
  { id: "deliverables", label: "Deliverables", Page: Deliverables, noDemo: true, hidden: true },
  { id: "results", label: "Results", Page: Results, noDemo: true, hidden: true },
  { id: "contract", label: "Contract", Page: Contract, noDemo: true, hidden: true },
  { id: "welcome", label: "Welcome guide", Page: Welcome, noDemo: true, hidden: true },
];

export const work: Module = {
  id: WORK,
  name: "Your project",
  icon: "flag",
  blurb: "Your contract, the plan, how far along it is, and what we need from you next.",
  fallback: true,
  Glance,
  // The demo shows the products; a client's project lives on app. only.
  noDemo: true,
  pages: [
    { id: "overview", label: "Overview", Page: Home },
    // Its own app: deliverables and results get tabs too.
    ...ENGAGEMENT_PAGES.map(({ hidden, ...p }) =>
      p.id === "deliverables" || p.id === "results" ? p : { ...p, ...(hidden && { hidden }) },
    ),
  ],
};
