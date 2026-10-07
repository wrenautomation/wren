/**
 * What can be done to pages (SitesConsole): make one from an offer, add a code page by its URL,
 * copy as a variant, retire. A page's copy, Claude's draft, the ask and its notes run from its
 * own detail (`inline`). Nothing here makes a page live: that's a yes in To approve.
 */
import { OFFERS } from "@wren/offers";
import type { Action } from "@wren/ui";

const OPEN_OFFERS = OFFERS.filter((o) => o.status !== "retired");
const OFFER_LABELS = Object.fromEntries(OPEN_OFFERS.map((o) => [o.id, o.name]));
export const TEMPLATES = { lander: "Lander", listicle: "Listicle" } as const;
const KINDS = ["lander", "listicle", "pitch", "demo", "booking", "thank-you", "portal"];

/** Pages from offers, by their status in the list: data pages hold copy, code pages a repo. */
const DATA = { source: ["data"] } as const;
const OPEN = { status: ["draft", "live"] } as const;

export const PAGE_ACTIONS: Action[] = [
  {
    id: "sites.create",
    label: "New page",
    handler: "sites/create",
    form: [
      {
        field: "offer",
        label: "Offer",
        type: "select",
        options: OPEN_OFFERS.map((o) => o.id),
        labels: OFFER_LABELS,
      },
      {
        field: "template",
        label: "Template",
        type: "select",
        options: Object.keys(TEMPLATES),
        labels: TEMPLATES,
      },
      {
        field: "angle",
        label: "Angle",
        optional: true,
        hint: "The one idea this page leads with: speed, cost, trust.",
      },
      { field: "audience", label: "Audience", optional: true, hint: "Who it speaks to." },
      { field: "title", label: "Name", optional: true, hint: "Left empty, it's named for you." },
      {
        field: "ai",
        label: "Claude writes the first draft",
        type: "switch",
        optional: true,
        hint: "Checked against the offer's facts. Off, it starts from the offer's own words.",
      },
    ],
    done: (made) => `Made a draft at /o/${(made as { slug?: string }).slug ?? ""}`,
  },
  {
    id: "sites.add",
    label: "Add code page",
    handler: "sites/add",
    form: [
      { field: "url", label: "Live URL", type: "url", hint: "https only. Its counts start here." },
      {
        field: "repoPath",
        label: "Repo path",
        optional: true,
        hint: "Where its code lives: lander/src/pages/compare.astro.",
      },
      { field: "title", label: "Name", optional: true },
      {
        field: "offer",
        label: "Offer",
        type: "select",
        options: OPEN_OFFERS.map((o) => o.id),
        labels: OFFER_LABELS,
        optional: true,
      },
      { field: "kind", label: "Kind", type: "select", options: KINDS, optional: true },
    ],
    done: (out) =>
      (out as { added?: boolean }).added ? "Added. Paste its kit tag to count it." : "Updated it.",
  },
  {
    id: "sites.duplicate",
    label: "Duplicate as variant",
    handler: "sites/duplicate",
    each: true,
    bulk: true,
    when: DATA,
    form: [
      { field: "angle", label: "New angle", optional: true },
      { field: "audience", label: "New audience", optional: true },
      { field: "title", label: "Name", optional: true },
    ],
    done: (out) => {
      const n = (out as { made?: unknown[] }).made?.length ?? 0;
      return n === 1 ? "Made a variant as a draft." : `Made ${n} variants as drafts.`;
    },
  },
  {
    id: "sites.retire",
    label: "Retire",
    handler: "sites/retire",
    bulk: true,
    when: OPEN,
    confirm: "Take these pages down? Their URLs answer gone. Their numbers stay.",
    done: (out) => {
      const o = out as { retired?: number; note?: string | null };
      return [`Retired ${o.retired ?? 0}.`, o.note].filter(Boolean).join(" ");
    },
  },
  { id: "sites.save", label: "Save", handler: "sites/save", inline: true, when: DATA },
  { id: "sites.draft", label: "Ask Claude", handler: "sites/draft", inline: true, when: DATA },
  { id: "sites.ask", label: "Ask to publish", handler: "sites/ask", inline: true, when: DATA },
  { id: "sites.notes", label: "Save notes", handler: "sites/notes", inline: true },
];
