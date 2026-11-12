/**
 * Canon: William's trusted records, read from prod's index of the Canon repo
 * (designs/2026-11-12-canon-references.md). Wren's team only. Read only: edits stay in Canon.
 */
import type { Module } from "../../module.js";
import { ReferencesPage } from "./references.js";

export const canon: Module = {
  id: "canon",
  name: "Canon",
  icon: "book",
  blurb: "The reels and videos he saved, his note on each, and the rule lines they back.",
  requires: { audience: "team" },
  pages: [
    {
      id: "references",
      label: "References",
      about: "Every reel and video in Canon, newest saved first. Open one to play it.",
      Page: ReferencesPage,
      wide: true,
    },
  ],
};
