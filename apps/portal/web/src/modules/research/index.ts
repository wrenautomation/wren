/**
 * Research: birdwatch runs read from `weaver serve` on this Mac, live. Wren's team only, read only.
 */
import type { Module } from "../../module.js";
import { RunsPage } from "./page.js";

export const research: Module = {
  id: "research",
  name: "Research",
  icon: "search",
  blurb: "Birdwatch runs as they go: the tree, the back and forth, and every source to check.",
  requires: { audience: "team" },
  pages: [
    {
      id: "runs",
      label: "Runs",
      about: "Each run's tree, its decisions with their whys, and every source it found.",
      Page: RunsPage,
      wide: true,
    },
  ],
};
