/** Organic content: posting to each channel, and the plan of what to post. */
import { defineComponent } from "@wren/core/components";

const FOR_WREN = "Posts to Wren's own channels, not per client";

export const CONTENT_COMPONENTS = [
  defineComponent({
    id: "content.posting",
    name: "Posting",
    blurb:
      "Posts to YouTube, LinkedIn, Instagram, TikTok, X and Reddit, and reads back the numbers.",
    icon: "play",
    for: "client",
    ready: false,
    missing: [FOR_WREN],
    provides: {
      services: ["Content", "ContentDesk", "ContentScheduler", "ContentMetrics"],
      loops: ["ContentScheduler", "ContentMetrics"],
    },
    effects: ["posts"],
  }),
  defineComponent({
    id: "content.planner",
    name: "Content plan",
    blurb: "Plans each day's posts per channel.",
    icon: "board",
    for: "client",
    ready: false,
    missing: [FOR_WREN],
    requires: { components: ["content.posting"] },
    provides: { services: ["ContentPlanner"], loops: ["ContentPlanner"] },
    effects: ["spends"],
  }),
];
