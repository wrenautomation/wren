/** Research's components: firms found, pages kept, people named, addresses proven. */
import { defineComponent } from "@wren/core/components";
import { clientKey } from "@wren/core/restate";
import { z } from "zod";

const word = z.string().trim().toLowerCase().min(1);
const perPass = z.number().int().min(0).max(1000).optional();

/**
 * A client's lead sheet (designs/2026-10-04-outbound-per-client.md, O1): what a
 * niche holds for Wren, as the client's block. Empty lists keep Wren's words;
 * absent caps keep Wren's per-pass sizes, and no daily verification cap, as today.
 */
export const leadSheetSettingsSchema = z
  .object({
    /** Words every firm name in the client's industry shares ("advisors"): discovery treats them as weak. */
    genericWords: z.array(word).default([]),
    /** Link words the client's firms use for team pages ("our-clinicians"). */
    crawlHints: z.array(word).default([]),
    /** Units one pass hands each stage, over Wren's defaults. */
    perPass: z
      .object({
        discover: perPass,
        verify: perPass,
        crawl: perPass,
        render: perPass,
        scan: perPass,
        contacts: perPass,
        extract: perPass,
        pick: perPass,
        resolveMailboxes: perPass,
        verifyMailboxes: perPass,
      })
      .strict()
      .prefault({}),
    /** Mail-server checks in any 24 hours; null = no cap. Verdicts main already holds are free. */
    verificationsPerDay: z.number().int().min(0).nullable().default(null),
  })
  .strict();
export type LeadSheetSettings = z.infer<typeof leadSheetSettingsSchema>;
export const LEAD_SHEET = "research.lead_sheet";

export const RESEARCH_COMPONENTS = [
  defineComponent({
    id: "research.discovery",
    name: "Firm discovery",
    blurb: "Finds the firms in a niche from public lists and search.",
    icon: "search",
    for: "client",
    ready: true,
    missing: [],
    provides: { services: ["Discovery"] },
    effects: ["spends"],
  }),
  defineComponent({
    id: "research.crawl",
    name: "Site crawl",
    blurb: "Fetches each firm's site and keeps the pages it read.",
    icon: "download",
    for: "client",
    ready: true,
    missing: [],
    provides: { services: ["PageArchive"], loops: ["PageArchive"] },
  }),
  defineComponent({
    id: "research.people",
    name: "People finder",
    blurb: "Reads each firm's pages for the people and roles worth writing to.",
    icon: "people",
    for: "client",
    ready: true,
    missing: [],
    requires: { components: ["research.crawl"] },
    provides: { services: ["Enrichment"] },
    effects: ["spends"],
  }),
  defineComponent({
    id: "research.verify",
    name: "Address check",
    blurb: "Asks the mail servers whether each address takes mail before anyone writes.",
    icon: "check",
    for: "client",
    ready: true,
    missing: [],
    requires: { components: ["research.people"] },
    provides: { services: ["Resolution"] },
  }),
  defineComponent({
    id: LEAD_SHEET,
    name: "Lead sheet",
    blurb: "Keeps a niche's list of checked leads full, firm by firm, with who to write to.",
    icon: "board",
    for: "client",
    ready: true,
    missing: [],
    settings: leadSheetSettingsSchema,
    requires: { components: ["research.discovery", "research.people", "research.verify"] },
    provides: {
      services: ["PoolScheduler"],
      loops: ["PoolScheduler"],
      apps: ["pipeline", "leads"],
    },
    clientLoops: (client) => [{ service: "PoolScheduler", key: clientKey(client, "all") }],
  }),
  defineComponent({
    id: "research.dossier",
    name: "Firm dossier",
    blurb: "A sourced brief on one firm before a call.",
    icon: "flag",
    for: "client",
    ready: false,
    missing: ["A command for Wren's team; no client sees a dossier yet"],
    effects: ["spends"],
  }),
];
