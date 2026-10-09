/** Opportunities as a part (designs/2026-10-09-opportunities.md). */
import { defineComponent } from "@wren/core/components";
import { DEAL_RECORD } from "./records.js";

export const DEALS_BOARD = "deals.board";

export const DEALS_COMPONENTS = [
  defineComponent({
    id: DEALS_BOARD,
    stage: "deliver",
    channels: [],
    name: "Opportunities",
    blurb:
      "Deals in pipelines of stages, on a board you drag across. Each move can start a workflow.",
    icon: "board",
    for: "client",
    ready: true,
    provides: {
      services: ["DealsConsole"],
      records: [DEAL_RECORD],
      apps: ["deals"],
    },
    effects: [],
    out: [{ id: "moved", label: "deals", kind: "deal" }],
    hypothesis: {
      from: "The product audit, 2026-10-07",
      guesses: [
        {
          is: "change",
          says: "Pipelines and their stages, per client.",
          built: "code, DealsConsole.pipelineSave",
        },
        { is: "fixed", says: "A move sends nothing by itself: a workflow decides." },
      ],
    },
  }),
];
