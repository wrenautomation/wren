/** The pipeline as a part (designs/2026-10-19-business-map.md). */
import { defineComponent } from "@wren/core/components";
import {
  DEAL_RECORD,
  ENTRY_RECORD,
  JOURNEY_RECORD,
  NUMBER_RECORD,
  OFFER_RECORD,
  SHAPE_RECORD,
  TERMS_RECORD,
} from "./records.js";

export const PIPELINE_JOURNEYS = "pipeline.journeys";

export const PIPELINE_COMPONENTS = [
  defineComponent({
    id: PIPELINE_JOURNEYS,
    stage: "deliver",
    channels: [],
    name: "Journeys",
    blurb:
      "Offers, the shape of the business, one person's journey across its nodes, the deals that make, and the numbers per node, edge and source.",
    icon: "board",
    for: "client",
    ready: true,
    provides: {
      services: ["PipelineConsole", "Journeys"],
      records: [
        OFFER_RECORD,
        SHAPE_RECORD,
        JOURNEY_RECORD,
        DEAL_RECORD,
        NUMBER_RECORD,
        TERMS_RECORD,
        ENTRY_RECORD,
      ],
      apps: ["pipelines", "offers", "numbers"],
    },
    effects: [],
    out: [],
    hypothesis: {
      from: "The Business Map design, 2026-10-19",
      guesses: [
        {
          is: "fixed",
          says: "A hand move goes through the shape's own move step: no second write path.",
        },
        {
          is: "fixed",
          says: "A journey moves along an edge, or by hand with a reason. It never revisits a node.",
        },
      ],
    },
  }),
];
