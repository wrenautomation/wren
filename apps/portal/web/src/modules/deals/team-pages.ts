/**
 * The tabs Wren's own pipelines app adds to the shared Journeys pages (designs/2026-10-19-portal-
 * reshape.md): the deals, the calls and the entries. A client's app has none of them.
 */
import type { ModulePage } from "../../module.js";
import { recorderHead } from "../calendar/recorder.js";
import { callsPage } from "../calls/index.js";

export const TEAM_PIPELINE_PAGES: ModulePage[] = [
  {
    id: "deals",
    label: "Deals",
    about: "Every deal, open, won and lost, with its signed terms.",
    template: "list",
    record: "pipeline.deal",
    empty: {
      open: "No open deals.",
      won: "No deal is won yet.",
      lost: "No deal is lost.",
      all: "No deals yet.",
    },
  },
  {
    ...callsPage("Calls booked on cal.com or our calendar show here."),
    head: recorderHead,
    // Calls that start within a day: Today's Prepare call.
    count: { soon: ["yes"] },
  },
  {
    id: "entries",
    label: "Entries",
    about: "Each source of the shape: what opens a journey, and when one last did.",
    template: "list",
    record: "pipeline.entry",
    empty: "The shape has no source yet.",
  },
];
