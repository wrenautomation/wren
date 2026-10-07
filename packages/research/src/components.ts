/** Research's components: firms found, pages kept, people named, addresses proven. */
import { defineComponent, type Port } from "@wren/core/components";
import { clientKey } from "@wren/core/restate";
import { defineWorkflow } from "@wren/core/workflows";
import { z } from "zod";
import { SIGNALS_COMPONENT, signalsSettingsSchema } from "./signals/collectors.js";

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

/** A client's social reads: which networks its pool reads. `{}` reads both. */
export const socialSettingsSchema = z
  .object({
    youtube: z.boolean().default(true).meta({ title: "Read YouTube" }),
    instagram: z.boolean().default(true).meta({ title: "Read Instagram" }),
  })
  .strict();
export type SocialSettings = z.infer<typeof socialSettingsSchema>;
export const SOCIAL = "research.social";
export const DOSSIER = "research.dossier";

const LEADS: Port = {
  id: "leads",
  label: "firms with a verified lead",
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
    stage: "find",
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
    stage: "find",
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
    stage: "find",
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
    stage: "find",
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
    stage: "find",
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
    id: SOCIAL,
    stage: "find",
    channels: ["social"],
    name: "Social reads",
    blurb:
      "Reads the public channel a firm links from its site and keeps its recent posts, so a first line can mention one.",
    icon: "search",
    for: "client",
    ready: true,
    missing: [],
    settings: socialSettingsSchema,
    // Rides the lead sheet's pool (`PoolScheduler/<client>/all`), which reads this block each
    // pass: no loop of its own, so uninstalling never stops the pool.
    requires: { components: [LEAD_SHEET] },
    in: [{ id: "firms", label: "firms with a channel link", kind: "firm" }],
    out: [{ id: "posts", label: "firms with recent posts", kind: "firm" }],
    hypothesis: {
      from: "Wren's recruiting firms on YouTube, 2026-10",
      guesses: [
        {
          is: "change",
          says: "Which networks, per niche: YouTube first, Instagram and the Ad Library next.",
          built: "settings: youtube, instagram",
        },
        { is: "change", says: "Firms read a day.", built: "PoolScheduler limits.youtube" },
        {
          is: "change",
          says: "How fresh a post must be to open an email.",
          built: "POST_FRESH_DAYS in the email facts",
        },
        {
          is: "needs",
          says: "Search a network by niche, so it finds firms too, not only reads them.",
          built: null,
        },
        { is: "fixed", says: "Public posts only, by official API or logged out. Never posted to." },
        { is: "fixed", says: "A hook quotes a real post, or there is no hook." },
      ],
    },
  }),
  defineComponent({
    id: SIGNALS_COMPONENT,
    stage: "find",
    name: "Signals",
    blurb:
      "Reads dated, linked facts about each firm and person (news, hiring, posts, talks), so a message can say why now.",
    icon: "search",
    for: "client",
    ready: true,
    missing: [],
    settings: signalsSettingsSchema,
    // Wren's niches read Wren's block (`wren_settings`); a client's pool reads its own. Metered
    // collectors (they spend) stay Wren's. Rides the pool, as social reads do.
    wrenSettings: true,
    requires: { components: [LEAD_SHEET] },
    in: [{ id: "firms", label: "firms in the queue", kind: "firm" }],
    out: [{ id: "signals", label: "firms with a fresh signal", kind: "firm" }],
    hypothesis: {
      from: "designs/2026-10-06-signal-collectors.md, 2026-10",
      guesses: [
        {
          is: "change",
          says: "Which collectors run.",
          built: "settings: each collector's on",
        },
        {
          is: "change",
          says: "Each collector's own knobs.",
          built: "settings: each collector's block",
        },
        { is: "fixed", says: "Free sources only; every signal has a date, a link and its raw." },
      ],
    },
  }),
  defineComponent({
    id: DOSSIER,
    stage: "find",
    name: "Firm dossier",
    blurb: "A sourced brief on one firm before a call.",
    icon: "flag",
    for: "client",
    ready: true,
    missing: [],
    // Read only: the firm page shows what the sheet already holds, with sources.
    requires: { components: [LEAD_SHEET] },
    in: [{ id: "firms", label: "firms", kind: "firm" }],
    hypothesis: {
      from: "Wren's briefs before calls, 2026-10",
      guesses: [
        {
          is: "change",
          says: "Clients want one on each of their own prospects before a call.",
          built: "the firm page's Dossier",
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
    stage: "find",
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
      { id: "social", uses: "research.social" },
    ],
    wires: [
      { from: "discovery.firms", to: "crawl.firms", via: "code" },
      { from: "crawl.crawled", to: "people.firms", via: "code" },
      { from: "crawl.crawled", to: "social.firms", via: "code" },
      { from: "people.people", to: "verify.people", via: "code" },
      { from: "verify.leads", to: "out.leads", via: "code" },
      { from: "people.people", to: "out.people", via: "code" },
    ],
  }),
];
