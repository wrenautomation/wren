/** AI tools: the one page left of the Handlers app, shown in Back office (`../places.ts`). */
import type { Module } from "../../module.js";
import { AiTools } from "../account/AiTools.js";

export const handlers: Module = {
  id: "handlers",
  name: "Handlers",
  icon: "play",
  blurb: "Let Claude Code or your own script use your Wren.",
  requires: { audience: "team" },
  pages: [
    {
      id: "ai",
      label: "AI tools",
      about: "Let Claude Code or your own script use your Wren.",
      Page: AiTools,
    },
  ],
};
