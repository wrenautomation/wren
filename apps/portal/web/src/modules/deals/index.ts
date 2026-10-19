/**
 * Journeys (designs/2026-10-18-journeys.md, "Folding `@wren/deals`"; designs/2026-10-19-business-
 * map.md): each person's way through the shape. The board has a column per node; the list keeps
 * saved views. One app in Wren's workspace and each client's, as `/pipelines` (it was `/deals`;
 * `moved.ts` sends an old link on). A move goes through the shape's own step, so a workflow that
 * hears it decides what follows. The old Funnels page is gone: the shape is the Map page's (M2).
 */
import { findRecords } from "../../find.js";
import type { Module } from "../../module.js";
import { JourneyBoard } from "./board.js";
import { TEAM_PIPELINE_PAGES } from "./team-pages.js";

/** A client's Journeys, in its own workspace: its own shape and journeys. */
export const clientDeals: Module = {
  id: "pipelines",
  name: "Journeys",
  component: "pipeline.journeys",
  icon: "target",
  blurb: "Every person by node of the shape, and how long they have been there.",
  find: findRecords({ record: "pipeline.journey", path: "/pipelines/journeys", kind: "Journey" }),
  pages: [
    {
      id: "board",
      label: "Board",
      about: "Everyone by node, to drag down the shape as they move.",
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
        stale: "No journey has sat at a node past its limit.",
        ghost: "No journey sits on a node the shape dropped.",
        done: "No journey is done yet.",
        dropped: "No journey is dropped.",
        all: "No journeys yet.",
      },
      columns: ["name", "nodeName", "flag", "ghost", "entry", "owner", "daysAtNode", "movedAt"],
      // Wren's Today lists the stale ones as a move: Nudge or drop.
      count: { flag: ["stale"] },
    },
  ],
};

/** Wren's own Pipelines, in Wren's workspace: the same pages on Wren's journeys. */
export const pipelines: Module = {
  ...clientDeals,
  name: "Pipelines",
  blurb: "Wren's own people by node of the shape: who is booked, who is signed, who has stalled.",
  requires: { audience: "team" },
  pages: [...clientDeals.pages, ...TEAM_PIPELINE_PAGES],
};
