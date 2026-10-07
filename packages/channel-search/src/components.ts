/** Search Console: the site's search numbers, watched daily and summed weekly. */
import { defineComponent } from "@wren/core/components";
import { clientKey } from "@wren/core/restate";
import { z } from "zod";

export const SEARCH_COMPONENT = "search.watch";

/** A client's block: `{}` reads the site the property names. */
export const searchSettingsSchema = z
  .object({
    origin: z.url().optional().meta({
      title: "Site address",
      description: "Where the sitemap is. Left out: the site the property names.",
    }),
  })
  .strict();

export const SEARCH_COMPONENTS = [
  defineComponent({
    id: SEARCH_COMPONENT,
    stage: "content",
    channels: ["web"],
    name: "Search watch",
    blurb: "Reads the site's Google search numbers daily and sums up each week.",
    icon: "search",
    for: "client",
    ready: true,
    missing: [],
    settings: searchSettingsSchema,
    requires: { accounts: ["search_console"] },
    provides: { services: ["SearchWatch", "SearchWeek"], loops: ["SearchWatch"] },
    // One daily read per client, into its own database (`SearchWatch/<client>/daily`).
    clientLoops: (client) => [{ service: "SearchWatch", key: clientKey(client, "daily") }],
    hypothesis: {
      from: "Wren's site, 2026-09",
      guesses: [
        { is: "change", says: "The site, per client.", built: "settings.origin" },
        {
          is: "needs",
          says: "The client's Search Console property, with Wren's service account on it.",
          built: "the Search Console account",
        },
        { is: "fixed", says: "Numbers come from Search Console once a day." },
      ],
    },
  }),
];
