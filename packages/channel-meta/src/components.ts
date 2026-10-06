/** Meta ads: launch, watch and pull leads from lead forms. */
import { defineComponent } from "@wren/core/components";
import { auditSettingsSchema } from "./audit.js";

export const META_COMPONENTS = [
  defineComponent({
    id: "ads.meta",
    stage: "reach",
    channels: ["ads"],
    name: "Meta ads",
    blurb: "Launches Meta ads with lead forms and watches their spend and leads.",
    icon: "money",
    for: "client",
    ready: false,
    missing: ["Runs on Wren's ad account, not per client"],
    settings: auditSettingsSchema,
    requires: { accounts: ["meta"] },
    provides: { services: ["Ads", "AdsWatch"], loops: ["AdsWatch"] },
    effects: ["spends", "posts"],
    out: [{ id: "forms", label: "lead forms filled", kind: "form" }],
    hypothesis: {
      from: "Wren's ad tests, 2026-09",
      guesses: [
        { is: "change", says: "The ad account, per client.", built: null },
        { is: "change", says: "The lead form's questions, per offer.", built: null },
        { is: "fixed", says: "Every launch is logged with what it spent." },
        {
          is: "change",
          says: "The audit's thresholds: pixel staleness, ads per ad set, budget use, conversion lag.",
          built: "settings.minAdsPerAdset",
        },
      ],
    },
  }),
];
