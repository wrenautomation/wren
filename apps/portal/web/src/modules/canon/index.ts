/**
 * Canon: William's second brain, read from prod's index of the Canon repo
 * (designs/2026-11-12-canon-references.md). Wren's team only. Read only: edits stay in Canon.
 */
import type { Module } from "../../module.js";
import { LibraryPage } from "./library.js";
import { OutliersPage } from "./outliers.js";
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
      id: "library",
      label: "Library",
      about:
        "Every record of every type: sources, findings, patterns, verdicts, rules, guides. Add a link here.",
      Page: LibraryPage,
      wide: true,
    },
    {
      id: "outliers",
      label: "Outliers",
      about:
        "Posts of tracked creators that beat their own usual draw, best multiple first. Save one to Canon.",
      Page: OutliersPage,
      wide: true,
    },
    {
      id: "topic",
      label: "Topic",
      about: "One topic whole: guide, rule sets, his notes, skill, sources and files.",
      Page: TopicPage,
      hidden: true,
      lights: "library",
    },
  ],
};
