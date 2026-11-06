/**
 * Variants: its own app beside Research (designs/2026-11-05-variants.md). The agent's batches:
 * mark what's good or bad and say where; it makes the next from that. Wren's team only.
 */
import type { Module } from "../../module.js";
import { BatchesPage } from "./batches.js";
import { CatalogPage, PickPage, SubjectsPage, toPick } from "./page.js";

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
      id: "pick",
      label: "To pick",
      about: "The oldest open batch, blind: mark each sample, then hand it to Vireo.",
      Page: PickPage,
      wide: true,
      badge: (_client, team) => (team ? toPick() : Promise.resolve(0)),
    },
    {
      id: "batches",
      label: "Batches",
      about: "Every batch, newest first: your calls and notes, and what each sample tested.",
      Page: BatchesPage,
      wide: true,
    },
    {
      id: "subjects",
      label: "Subjects",
      about: "Each subject's good rate per batch, its live numbers and the tips under test.",
      Page: SubjectsPage,
      wide: true,
    },
    {
      id: "catalog",
      label: "Catalog",
      about: "The samples you kept, to reuse.",
      Page: CatalogPage,
      wide: true,
    },
  ],
};
