/**
 * Variants: its own app beside Research (designs/2026-11-05-variants.md). The agent's batches:
 * mark what's good or bad and say where; it makes the next from that. Wren's team only.
 */
import type { Module } from "../../module.js";
import { BatchesPage } from "./batches.js";
import { openBatches } from "./page.js";

export const variants: Module = {
  id: "variants",
  name: "Variants",
  icon: "split",
  product: "Vireo",
  blurb:
    "Batches the agent made: mark what's good or bad and say where; it makes the next from that.",
  requires: { audience: "team" },
  pages: [
    {
      id: "batches",
      label: "Batches",
      about: "Every batch, newest first. Mark an open one blind, then hand it to Vireo.",
      Page: BatchesPage,
      wide: true,
      badge: (_client, team) => (team ? openBatches() : Promise.resolve(0)),
    },
  ],
};
