/** The lander's numbers rolled up daily, and the bandit over site experiments. */
import { defineComponent } from "@wren/core/components";

export const SITE_ROLLUP_COMPONENTS = [
  defineComponent({
    id: "site.rollup",
    stage: "content",
    channels: ["web"],
    name: "Site numbers",
    blurb:
      "Rolls the lander's visits, clicks, heatmaps and survey answers into daily counts, and moves running experiments' shares.",
    icon: "chart",
    for: "wren",
    ready: false,
    missing: ["Stopped until the experiments phase (11-04)"],
    requires: { accounts: [], facts: [] },
    // The bandit over site experiments runs on each pass, so the experiments are its records.
    provides: {
      services: ["SiteRollup"],
      loops: ["SiteRollup"],
      records: ["marketing.experiment"],
    },
    hypothesis: {
      from: "Wren's site, 2026-09",
      guesses: [{ is: "fixed", says: "The lander's export, read once a day." }],
    },
  }),
];
