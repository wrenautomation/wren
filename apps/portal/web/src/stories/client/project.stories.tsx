/** A client's Project: plan, updates, deliverables, results. Fake server: `web/src/mocks/`. */
import type { Meta } from "@storybook/react-vite";
import { pageAt, shows } from "../../mocks/page.js";
import { answers } from "./client-places-kit.js";

const meta: Meta = { title: "Client/Project" };
export default meta;

export const Default = pageAt("/project");

export const Plan = pageAt("/project/plan", { answers, check: shows("Plan") });

/** A list page while its read is out, and once it is refused. */
export const PlanPending = pageAt("/project/plan", { answers, mode: "pending" });

export const PlanFails = pageAt("/project/plan", { answers, mode: "fails", lands: false });

export const Updates = pageAt("/project/updates", { answers, check: shows("Updates") });

export const Deliverables = pageAt("/project/deliverables", {
  answers,
  check: shows("Deliverables", "Approve"),
});

export const Results = pageAt("/project/results", { answers, check: shows("Results") });

export const Welcome = pageAt("/project/welcome", {
  answers,
  check: shows("Welcome to Wren"),
});
