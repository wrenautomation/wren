/** Cold outreach on social sites: a person's warmed account, paced. */
import { defineComponent } from "@wren/core/components";

export const OUTREACH_COMPONENTS = [
  defineComponent({
    id: "reach.outreach",
    name: "Social outreach",
    blurb: "Writes to people on social sites from a warmed account, paced.",
    icon: "people",
    for: "client",
    ready: false,
    missing: ["Held: no targeting yet, and it runs on Wren's accounts only"],
    provides: {
      services: ["ReachSender", "ReachWatch", "ReachDesk"],
      loops: ["ReachSender", "ReachWatch"],
    },
    effects: ["sends"],
  }),
];
