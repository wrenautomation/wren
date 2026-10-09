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
  {
    id: "sites.rewrite",
    label: "Rewrite a part",
    handler: "sites/rewrite",
    inline: true,
    when: DATA,
  },
  { id: "sites.ask", label: "Ask to publish", handler: "sites/ask", inline: true, when: DATA },
  { id: "sites.notes", label: "Save notes", handler: "sites/notes", inline: true },
  { id: "sites.retireAsk", label: "Retire", handler: "sites/retireAsk", inline: true },
];

/**
 * A page's A/B split, run from its detail: start one against live pages, change the weights,
 * stop it, or ask to make the winner the page (a yes in To approve, or the client's).
 */
export const SPLIT_ACTIONS: Action[] = [
  { id: "sites.splitStart", label: "Start split", handler: "sites/splitStart", inline: true },
  { id: "sites.splitWeights", label: "Set weights", handler: "sites/splitWeights", inline: true },
  { id: "sites.splitStop", label: "Stop split", handler: "sites/splitStop", inline: true },
  { id: "sites.splitShip", label: "Make it the page", handler: "sites/splitShip", inline: true },
];

/**
 * A client's own pages: a yes or no on what waits (a version, or a retire), by the client's
 * approver setting. The row is the page; the yes is on what waits on it now.
 */
export const CLIENT_PAGE_ACTIONS: Action[] = [
  {
    id: "sites.approve",
    label: "Approve",
    handler: "sites/approve",
    confirm: "Say yes to what waits? A version goes live, a retired page answers gone.",
    key: "a",
    bulk: true,
    when: { asked: ["publish", "retire"] },
    done: (out) => `Done: ${(out as { approved?: number }).approved ?? 0}.`,
  },
  {
    id: "sites.decline",
    label: "Decline",
    handler: "sites/decline",
    key: "x",
    bulk: true,
    when: { asked: ["publish", "retire"] },
    done: () => "Declined. Nothing changed on the page.",
  },
  // From the page's detail: the copy editor and a stopped split's retire ask.
  { id: "sites.save", label: "Save", handler: "sites/save", inline: true, when: DATA },
  { id: "sites.ask", label: "Ask to publish", handler: "sites/ask", inline: true, when: DATA },
  { id: "sites.retireAsk", label: "Retire", handler: "sites/retireAsk", inline: true },
  ...SPLIT_ACTIONS,
];

/** Hosted forms: made as a draft, built in their detail, published at once (a form only asks). */
export const FORM_ACTIONS: Action[] = [
  {
    id: "sites.formCreate",
    label: "New form",
    handler: "sites/formCreate",
    form: [
      { field: "name", label: "Name", hint: "What the team calls it: Quote request." },
      {
        field: "slug",
        label: "Slug",
        optional: true,
        hint: "Its address, /o/f/<slug>. Left empty, it's made from the name.",
      },
    ],
    done: (made) =>
      `Made a draft at /o/f/${(made as { slug?: string }).slug ?? ""}. Open it to build it.`,
  },
  {
    id: "sites.formPublish",
    label: "Publish",
    handler: "sites/formPublish",
    bulk: true,
    when: { status: ["draft"] },
    sets: { status: "live" },
    done: (out) => `Published ${(out as { changed?: number }).changed ?? 0}.`,
  },
  {
    id: "sites.formUnpublish",
    label: "Unpublish",
    handler: "sites/formUnpublish",
    bulk: true,
    when: { status: ["live"] },
    sets: { status: "draft" },
    confirm: "Take these forms back to drafts? Their links stop working until you publish again.",
    done: (out) => `Back to drafts: ${(out as { changed?: number }).changed ?? 0}.`,
  },
  {
    id: "sites.formRetire",
    label: "Retire",
    handler: "sites/formRetire",
    bulk: true,
    when: { status: ["draft", "live"] },
    sets: { status: "retired" },
    confirm: "Retire these forms? Their links answer gone. Submissions and numbers stay.",
    done: (out) => `Retired ${(out as { changed?: number }).changed ?? 0}.`,
  },
  { id: "sites.formSave", label: "Save", handler: "sites/formSave", inline: true },
];
