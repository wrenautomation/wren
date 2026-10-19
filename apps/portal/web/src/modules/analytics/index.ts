/**
 * Analytics (designs/2026-10-19-portal-reshape.md): how people find and use the site. Visitors
 * (visits, sessions, heatmaps, experiments, surveys and their answers), Search (Google's days and
 * pages, keywords, what AI assistants say), and the funnel from first visit to booking. These
 * were Sites' and Marketing's pages; records stay `marketing.*`. Old `/sites/...` and
 * `/marketing/...` addresses redirect here (`../../moved.ts`), at Wren only.
 */
import type { Module } from "../../module.js";
import { MARKETING_PAGES, SITE_PAGES } from "../marketing/index.js";

export const analytics: Module = {
  id: "analytics",
  name: "Analytics",
  icon: "chart",
  blurb: "Visits, recordings, search and the funnel from first visit to booking.",
  requires: { audience: "team" },
  component: "sites.pages",
  pages: [
    ...SITE_PAGES,
    MARKETING_PAGES.funnel,
    // Opens from the numbers' links; it lights Visits.
    { ...MARKETING_PAGES.links, lights: "visits" },
  ],
};
