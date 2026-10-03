/** Wren's own lead pipeline: how many firms reach each stage, and where they leak. Team only. */
import { lazy } from "react";
import type { Module } from "../../module.js";

export const pipeline: Module = {
  id: "pipeline",
  name: "Pipeline",
  icon: "pulse",
  blurb: "Firms at each stage from found to verified lead, by niche, and where they leak.",
  requires: { audience: "team" },
  // Charts and tables load with the page, never with the launcher.
  pages: [{ id: "funnel", label: "Funnel", Page: lazy(() => import("./Pipeline.js")) }],
};
