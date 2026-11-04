/**
 * Research: ask a Claude agent with birdwatch (this Mac's `wren agent serve`), and read birdwatch
 * runs from `birdwatch serve`, live. Wren's team only.
 */
import type { Module } from "../../module.js";
import { AskPage } from "./ask.js";
import { RunsPage } from "./page.js";

export const research: Module = {
  id: "research",
  name: "Research",
  icon: "search",
  blurb: "Birdwatch runs as they go: the tree, the back and forth, and every source to check.",
  requires: { audience: "team" },
  pages: [
    {
      id: "ask",
      label: "Ask",
      about: "Ask a Claude agent with birdwatch; your past chats stay on the left.",
      Page: AskPage,
      wide: true,
    },
    {
      id: "runs",
      label: "Runs",
      about: "Each run's tree, its decisions with their whys, and every source it found.",
      Page: RunsPage,
      wide: true,
    },
  ],
};
