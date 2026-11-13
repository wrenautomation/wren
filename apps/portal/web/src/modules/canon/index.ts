/**
 * Canon: William's second brain, read from prod's index of the Canon repo
 * (designs/2026-11-12-canon-references.md). Wren's team only. Read only: edits stay in Canon.
 */
import type { Module } from "../../module.js";
import { ExplorerPage } from "./explorer.js";
import { LibraryPage } from "./library.js";
import { ReferencesPage } from "./references.js";
import { TopicPage } from "./topic.js";

export const canon: Module = {
  id: "canon",
  name: "Canon",
  icon: "book",
  blurb:
    "The second brain: every topic's guide, rules, skill and notes, every record, every reference.",
  requires: { audience: "team" },
  pages: [
    {
      id: "explorer",
      label: "Explorer",
      about:
        "The whole brain as one tree: topics, their layers and lines, references, records, files. What needs a look beside the root.",
      Page: ExplorerPage,
      wide: true,
    },
    {
      id: "library",
      label: "Library",
      about: "Every record of every type: sources, findings, patterns, verdicts, rules, guides.",
      Page: LibraryPage,
      wide: true,
    },
    {
      id: "references",
      label: "References",
      about: "Every reel and video in Canon, newest saved first. Open one to play it.",
      Page: ReferencesPage,
      wide: true,
    },
    {
      id: "topic",
      label: "Topic",
      about: "One topic whole: guide, rule sets, his notes, skill, sources and files.",
      Page: TopicPage,
      hidden: true,
      lights: "explorer",
    },
  ],
};
