/**
 * Journeys (designs/2026-10-18-journeys.md, "Folding `@wren/deals`"): each person's way through a
 * funnel. The list keeps saved views; Funnels shows the stages. One app in Wren's workspace and
 * each client's, as `/pipelines` (it was `/deals`; `moved.ts` sends an old link on). A move goes
 * through the funnel's own step, so a workflow that hears it decides what follows.
 */
import { findRecords } from "../../find.js";
import type { Module } from "../../module.js";
import { JourneyBoard } from "./board.js";
import { TEAM_PIPELINE_PAGES } from "./team-pages.js";

/** A client's Journeys, in its own workspace: its own funnels and journeys. */
export const clientDeals: Module = {
  id: "pipelines",
  name: "Journeys",
  component: "pipeline.journeys",
  icon: "target",
  blurb: "Every person by stage of each funnel, and how long they have been there.",
  find: findRecords({ record: "pipeline.journey", path: "/pipelines/journeys", kind: "Journey" }),
  pages: [
    {
      id: "board",
      label: "Board",
      about: "Each funnel's people by stage, to drag forward as they move.",
      Page: JourneyBoard,
      wide: true,
    },
    {
      id: "journeys",
      label: "Journeys",
      about: "Every journey, open, done and dropped.",
      template: "list",
      record: "pipeline.journey",
      empty: {
        open: "No open journeys.",
        mine: "No open journey was moved by you.",
        stale: "Nothing has sat in a stage 14 days.",
        done: "No journey is done yet.",
        dropped: "No journey is dropped.",
        all: "No journeys yet.",
      },
      columns: [
        "name",
        "funnelName",
        "stageLabel",
        "flag",
        "entry",
        "owner",
        "daysInStage",
        "movedAt",
      ],
    },
    {
      id: "funnels",
      label: "Funnels",
      about: "The stages each funnel moves a person through.",
      template: "list",
      record: "pipeline.funnel",
      empty: "No funnels yet.",
      columns: ["name", "status", "version", "offer", "stages", "openJourneys", "changedAt"],
    },
  ],
};

/** Wren's own Pipelines, in Wren's workspace: the same pages on Wren's journeys. */
export const pipelines: Module = {
  ...clientDeals,
  name: "Pipelines",
  blurb:
    "Wren's own people by stage of each funnel: who is booked, who is signed, who has stalled.",
  requires: { audience: "team" },
  pages: [...clientDeals.pages, ...TEAM_PIPELINE_PAGES],
};
