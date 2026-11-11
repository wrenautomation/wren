/**
 * Research: ask a Claude agent with weaver (this Mac's `wren agent serve`), and read weaver
 * runs from `weaver serve`, live. Wren's team only.
 */
import type { Module } from "../../module.js";
import { RunsPage } from "./runs.js";

export const research: Module = {
  id: "research",
  name: "Research",
  icon: "search",
  product: "Weaver",
  blurb: "Weaver runs as they go: the graph, the back and forth, and every source to check.",
  requires: { audience: "team" },
  pages: [
    {
      id: "runs",
      label: "Runs",
      about:
        "The chat's runs live on one graph; History holds every run. Ask in the side panel's chat.",
      Page: RunsPage,
      wide: true,
    },
  ],
};
