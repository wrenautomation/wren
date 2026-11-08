/**
 * Research: ask a Claude agent with birdwatch (this Mac's `wren agent serve`), and read birdwatch
 * runs from `birdwatch serve`, live. Wren's team only.
 */
import type { Module } from "../../module.js";
import { AskPage } from "./ask.js";
import { LivePage } from "./live.js";
import { HistoryPage } from "./page.js";

export const research: Module = {
  id: "research",
  name: "Research",
  icon: "search",
  product: "Birdwatch",
  blurb: "Birdwatch runs as they go: the graph, the back and forth, and every source to check.",
  requires: { audience: "team" },
  pages: [
    {
      id: "ask",
      label: "Ask",
      about: "Ask a Claude agent with birdwatch; your past chats stay on the left.",
      Page: AskPage,
      fill: true,
    },
    {
      id: "live",
      label: "Live",
      about: "The chat's runs and runs still going, on one graph that follows them.",
      Page: LivePage,
      wide: true,
    },
    {
      id: "history",
      label: "History",
      about: "Every run: open one, pick several, or draw all of them on one graph.",
      Page: HistoryPage,
      wide: true,
    },
  ],
};
