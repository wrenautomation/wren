/** The pipeline as a part (designs/2026-10-18-journeys.md, "Records, CLI, agent"). */
import { defineComponent } from "@wren/core/components";
import {
  DEAL_RECORD,
  FUNNEL_RECORD,
  JOURNEY_RECORD,
  NUMBER_RECORD,
  OFFER_RECORD,
} from "./records.js";

export const PIPELINE_JOURNEYS = "pipeline.journeys";

export const PIPELINE_COMPONENTS = [
  defineComponent({
    id: PIPELINE_JOURNEYS,
    stage: "deliver",
    channels: [],
    name: "Journeys",
    blurb:
      "Offers, funnels, one person's journey through a funnel, the deals that make, and the numbers per stage and entry.",
    icon: "board",
    for: "client",
    ready: true,
    provides: {
      services: ["PipelineConsole", "Journeys"],
      records: [OFFER_RECORD, FUNNEL_RECORD, JOURNEY_RECORD, DEAL_RECORD, NUMBER_RECORD],
      apps: ["deals"],
    },
    effects: [],
    out: [],
    hypothesis: {
      from: "The journeys design, 2026-10-18",
      guesses: [
        {
          is: "fixed",
          says: "A hand move goes through the funnel's own move step: no second write path.",
        },
        { is: "fixed", says: "A journey only moves forward." },
      ],
    },
  }),
];
