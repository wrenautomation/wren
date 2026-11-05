/**
 * Journeys (designs/2026-10-18-journeys.md): each person's way through the shape, one list under
 * People. The Map is the board: a node's people open here (`?node=<id>`), a journey at
 * `/people/journeys/<id>`.
 */
import { findRecords } from "../../find.js";
import type { Module } from "../../module.js";
import { fitExtras } from "./fit.js";

/** The Map opens a node's people as `?node=<id>`; a list filter on words reads `~<words>`. */
const nodeLegacy = (params: URLSearchParams) => {
  const node = params.get("node");
  return node && !/^[~+-]/.test(node) ? { node: `~${node}` } : null;
};

/** Journeys, in Wren's workspace and each client's: its own shape and journeys. */
export const journeys: Module = {
  id: "pipelines",
  name: "Journeys",
  component: "pipeline.journeys",
  icon: "target",
  blurb: "Every person by node of the shape, and how long they have been there.",
  find: findRecords({ record: "pipeline.journey", path: "/people/journeys", kind: "Journey" }),
  pages: [
    {
      id: "journeys",
      label: "Journeys",
      about: "Every journey, open, done and dropped.",
      template: "list",
      record: "pipeline.journey",
      empty: {
        open: "No open journeys.",
        mine: "No open journey is yours.",
        stale: "No journey has sat at a node past its limit.",
        ghost: "No journey sits on a node the shape dropped.",
        done: "No journey is done yet.",
        dropped: "No journey is dropped.",
        all: "No journeys yet.",
      },
      columns: ["name", "nodeName", "flag", "ghost", "entry", "owner", "daysAtNode", "movedAt"],
      legacy: nodeLegacy,
      // The person's fit to the offer's ICP, from the light read at a node.
      extras: fitExtras,
      // Wren's Today lists the stale ones as a move: Nudge or drop.
      count: { flag: ["stale"] },
    },
  ],
};
