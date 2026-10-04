/** Search Console: the site's search numbers, watched daily and summed weekly. */
import { defineComponent } from "@wren/core/components";

export const SEARCH_COMPONENTS = [
  defineComponent({
    id: "search.watch",
    name: "Search watch",
    blurb: "Reads the site's Google search numbers daily and sums up each week.",
    icon: "search",
    for: "client",
    ready: false,
    missing: ["Reads Wren's own site, not per client"],
    provides: { services: ["SearchWatch", "SearchWeek"], loops: ["SearchWatch"] },
  }),
];
