/** Research's components: firms found, pages kept, people named, addresses proven. */
import { defineComponent, type Port } from "@wren/core/components";
import { clientKey } from "@wren/core/restate";
import { defineWorkflow } from "@wren/core/workflows";
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

const LEADS: Port = {
  id: "leads",
  label: "firms with a checked lead",
  kind: "lead",
  count: { record: "email.firm", view: "lead" },
};
const PEOPLE: Port = {
  id: "people",
  label: "firms with a person named",
  kind: "person",
  count: { record: "email.firm", view: "named" },
};

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
    out: [
      {
        id: "firms",
        label: "firms found",
        kind: "firm",
        count: { record: "email.firm", view: "in_play" },
      },
    ],
    hypothesis: {
      from: "Wren's agency and recruiting niches, 2026-09",
      guesses: [
        {
          is: "change",
          says: "Each niche finds firms in its own directories and bulk files.",
          built: "niche.leadSourceFormats",
        },
        { is: "change", says: "A client hands us its own list instead of a search.", built: null },
        {
          is: "needs",
          says: "The words a niche's firm names share, so matching ignores them.",
          built: "niche.discoveryGenericWords",
        },
        { is: "fixed", says: "One firm per domain; a directory's host never keys a firm." },
      ],
    },
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
    in: [{ id: "firms", label: "firms", kind: "firm" }],
    out: [
      {
        id: "crawled",
        label: "firms crawled",
        kind: "firm",
        count: { record: "email.firm", view: "crawled" },
      },
    ],
    hypothesis: {
      from: "Wren's niches' firm sites, 2026-09",
      guesses: [
        {
          is: "change",
          says: "The link words that lead to team pages differ by industry.",
          built: "niche.crawlHints",
        },
        {
          is: "change",
          says: "Some industries hide people behind script-built pages, so more sites need a browser.",
          built: null,
        },
        {
          is: "fixed",
          says: "Each page is fetched once and kept; later steps reread it for free.",
        },
      ],
    },
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
    in: [{ id: "firms", label: "crawled firms", kind: "firm" }],
    out: [PEOPLE],
    hypothesis: {
      from: "Wren's niches, 2026-09",
      guesses: [
        {
          is: "change",
          says: "The roles worth writing to depend on the offer: owners at agencies, partners at recruiting firms.",
          built: null,
        },
        {
          is: "change",
          says: "Sources past the firm's own site (LinkedIn, registries) join per niche.",
          built: "niche.personSourceFormats",
        },
        { is: "fixed", says: "A person is kept with the page that names them." },
      ],
    },
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
    in: [{ id: "people", label: "people", kind: "person" }],
    out: [LEADS],
    hypothesis: {
      from: "Wren's leads, 2026-09",
      guesses: [
        {
          is: "change",
          says: "Clients differ on catch-all domains: some take the risk, most don't.",
          built: null,
        },
        {
          is: "change",
          says: "How many paid checks a client allows a day.",
          built: "research.lead_sheet",
        },
        {
          is: "fixed",
          says: "A verdict the main database holds is reused for every client, free.",
        },
      ],
    },
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
    inside: "research.leads",
    out: [LEADS, PEOPLE],
    hypothesis: {
      from: "Wren's agency and recruiting lead sheets, 2026-09",
      guesses: [
        { is: "change", says: "How much each step takes per pass.", built: "settings.perPass" },
        {
          is: "change",
          says: "A daily cap on paid address checks.",
          built: "settings.verificationsPerDay",
        },
        {
          is: "change",
          says: "The client's industry words for discovery and crawling.",
          built: "settings.genericWords",
        },
        { is: "needs", says: "The steps it keeps full, in order.", built: "inside" },
        { is: "fixed", says: "The sheet tops up step by step, never in one big pass." },
      ],
    },
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
    in: [{ id: "firms", label: "firms", kind: "firm" }],
    hypothesis: {
      from: "Wren's briefs before calls, 2026-10",
      guesses: [
        {
          is: "change",
          says: "Clients want one on each of their own prospects before a call.",
          built: null,
        },
        {
          is: "change",
          says: "Sources differ by niche: filings, news, recent posts.",
          built: null,
        },
        { is: "fixed", says: "Every claim cites its source." },
      ],
    },
  }),
];

/** The lead sheet's steps, opened from its card. */
export const RESEARCH_WORKFLOWS = [
  defineWorkflow({
    id: "research.leads",
    name: "Find leads",
    blurb: "Finds firms, reads their sites, names the people and checks each address.",
    icon: "search",
    for: "client",
    out: [LEADS, PEOPLE],
    nodes: [
      { id: "discovery", uses: "research.discovery" },
      { id: "crawl", uses: "research.crawl" },
      { id: "people", uses: "research.people" },
      { id: "verify", uses: "research.verify" },
    ],
    wires: [
      { from: "discovery.firms", to: "crawl.firms", via: "code" },
      { from: "crawl.crawled", to: "people.firms", via: "code" },
      { from: "people.people", to: "verify.people", via: "code" },
      { from: "verify.leads", to: "out.leads", via: "code" },
      { from: "people.people", to: "out.people", via: "code" },
    ],
  }),
];
