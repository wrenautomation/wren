/**
 * Explorer: every root as one Finder-style tree (designs/2026-11-12-explorer.md D5). A page per
 * root; the page tabs pick the root. Wren's team only. Read only: each item links to its app.
 */
import type { Module } from "../../module.js";
import { type ExplorerRoot, rootPage } from "./page.js";

const ROOTS: ExplorerRoot[] = [
  {
    id: "canon",
    label: "Canon",
    icon: "book",
    about:
      "The whole brain as one tree: topics, their layers and lines, references, records, files. What needs a look beside the root.",
  },
  {
    id: "vireo",
    label: "Vireo",
    icon: "split",
    about:
      "Every subject's batches and samples, and every guide under test. An open batch stays blind until you mark it.",
  },
  {
    id: "weaver",
    label: "Weaver",
    icon: "search",
    about:
      "Every research run on this Mac: the pages it read, their findings, the queries that hit them.",
  },
  {
    id: "metro",
    label: "Business map",
    icon: "workflow",
    about:
      "The newest map as a tree: lines, their groups and stations, shared flows. Tracks show as links each way.",
  },
  {
    id: "folders",
    label: "Folders",
    icon: "folder",
    about:
      "Your folders, with the subjects and runs filed in each. A filed item opens at its home.",
  },
];

export const explorer: Module = {
  id: "explorer",
  name: "Explorer",
  icon: "columns",
  blurb:
    "Canon, Vireo, Weaver, the business map and your folders as one tree to walk, list or find in.",
  requires: { audience: "team" },
  pages: ROOTS.map((r) => ({
    id: r.id,
    label: r.label,
    about: r.about,
    Page: rootPage(r),
    wide: true,
  })),
};
