/** Lead reactivation, and the demo video it records per lead. */
import { defineComponent } from "@wren/core/components";
import { PRODUCT, reactivationSettingsSchema } from "./settings.js";

export const REACTIVATION_COMPONENTS = [
  defineComponent({
    id: PRODUCT,
    name: "Lead reactivation",
    blurb: "Wakes old leads in the client's CRM and books them in.",
    icon: "cycle",
    for: "client",
    ready: true,
    settings: reactivationSettingsSchema,
    provides: {
      services: ["Reactivation", "ReactivationPortal"],
      loops: ["Reactivation"],
      records: [
        "reactivation.person",
        "reactivation.email",
        "reactivation.finding",
        "reactivation.reply",
        "reactivation.setting",
      ],
      apps: ["reactivation"],
    },
    effects: ["sends", "spends"],
  }),
  defineComponent({
    id: "video.demo",
    name: "Demo videos",
    blurb: "Records a short demo video for one lead's firm, with a page to watch it.",
    icon: "play",
    for: "client",
    ready: false,
    missing: ["A command for Wren's team; records Wren's own demo only"],
  }),
];
