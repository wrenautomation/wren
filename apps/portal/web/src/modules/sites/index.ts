/**
 * Sites (designs/2026-10-07-sites.md): every page we run, in one list. Data pages are made from
 * an offer and a template, their copy edited as a form, made live by a yes in To approve and
 * served at /o/<slug> with no deploy. Code pages are built in a repo (the lander skill) and
 * listed here by URL with the same numbers. The Funnel reads each page by where its visits came
 * from, ads with their spend. Forms are hosted forms (designs/2026-10-07-forms-and-pay.md), built
 * as fields and live at /o/f/<slug> or framed anywhere; Submissions holds every form sent, whole,
 * for export. Links makes tracked `/go/` links with their QR codes and counts what each brought.
 */
import type { ListPage, Module } from "../../module.js";
import { CLIENT_PAGE_ACTIONS, FORM_ACTIONS, PAGE_ACTIONS, SPLIT_ACTIONS } from "./actions.js";
import { clientPageExtras, pageExtras } from "./detail.js";
import { formExtras } from "./forms.js";
import { FunnelGraph } from "./funnel-graph.js";
import { linkExtras, linkHead } from "./links.js";

/** Tracked `/go/` links: Wren's and each client's, the same page in both workspaces. */
const LINKS: ListPage = {
  id: "links",
  label: "Links",
  template: "list",
  record: "sites.link",
  empty: {
    all: "No tracked links yet. Make one above: pick a page and where it's posted.",
    used: "No link has brought a visit yet.",
    ads: "No ad links yet.",
  },
  columns: [
    "name",
    "pageTitle",
    "channel",
    "content",
    "clicks",
    "visits",
    "forms",
    "books",
    "last",
    "created",
  ],
  head: linkHead,
  extras: linkExtras,
};

/** Hosted forms: Wren's and each client's, the same page in both workspaces. */
const FORMS: ListPage = {
  id: "forms",
  label: "Forms",
  template: "list",
  record: "sites.form",
  empty: {
    forms: "No forms. Make one with New form.",
    live: "No form is live. Publish one from its page.",
    retired: "No form is retired.",
  },
  actions: FORM_ACTIONS,
  columns: [
    "name",
    "address",
    "owner",
    "status",
    "views",
    "starts",
    "submits",
    "conversion",
    "last",
    "changedBy",
  ],
  extras: formExtras,
};

/** Every form sent, whole. */
const SUBMISSIONS: ListPage = {
  id: "submissions",
  label: "Submissions",
  template: "list",
  record: "sites.entry",
  empty: "No forms sent. Every submit from a page or a hosted form lands here, whole.",
  columns: [
    "who",
    "email",
    "phone",
    "formName",
    "pageTitle",
    "at",
    "channel",
    "source",
    "consented",
    "entered",
  ],
};

export const sites: Module = {
  id: "sites",
  name: "Sites",
  icon: "link",
  blurb:
    "Every lander, listicle, funnel page and hosted form, with its visits, submits and bookings.",
  requires: { audience: "team" },
  component: "sites.pages",
  pages: [
    {
      id: "pages",
      label: "Pages",
      template: "list",
      record: "sites.page",
      empty: {
        pages: "No pages yet. Make one from an offer with New page.",
        live: "No page is live. A draft goes live with a yes in To approve.",
        waiting: "Nothing waits on a yes.",
        ads: "No ad links to a page yet.",
        retired: "No page is retired.",
        splits: "No A/B split is running. Start one from a live page.",
      },
      actions: [...PAGE_ACTIONS, ...SPLIT_ACTIONS],
      columns: [
        "title",
        "address",
        "kind",
        "source",
        "owner",
        "status",
        "stage",
        "changed",
        "views",
        "forms",
        "books",
        "ads",
        "split",
        "asked",
      ],
      extras: pageExtras,
    },
    {
      id: "funnel",
      label: "Funnel",
      template: "list",
      record: "sites.funnel",
      empty: "No visits counted yet. Each page's tracker fills this.",
      columns: ["title", "channel", "offer", "views", "forms", "books", "formRate", "spend"],
    },
    // The same rows drawn: sources, pages, forms, bookings.
    { id: "funnel-map", label: "Funnel map", Page: FunnelGraph, wide: true },
    LINKS,
    FORMS,
    SUBMISSIONS,
  ],
};

/**
 * A client's Sites, in its own workspace: its own pages on its own host, at /o/<slug>. Wren
 * builds the pages; the client edits their copy in the same editor, sees each page's numbers and
 * ads, runs its splits, makes tracked links, and gives the yes on a version or a retire when its
 * approver setting says the client approves. Its logins see its pages only.
 */
export const clientSites: Module = {
  id: "sites",
  name: "Sites",
  icon: "link",
  blurb: "Your landing pages, their copy, tracked links, visits, forms, bookings and ads.",
  component: "sites.pages",
  pages: [
    {
      id: "pages",
      label: "Pages",
      template: "list",
      record: "sites.page",
      empty: {
        pages: "No pages yet. Wren builds them and they show here.",
        live: "No page is live yet.",
        waiting: "Nothing waits on a yes.",
        ads: "No ad links to a page yet.",
        splits: "No A/B split is running.",
        retired: "No page is retired.",
      },
      actions: CLIENT_PAGE_ACTIONS,
      // The phone shows the first two: the page and whether it's live.
      columns: [
        "title",
        "status",
        "views",
        "forms",
        "books",
        "spend",
        "costPerForm",
        "split",
        "asked",
        "address",
        "kind",
        "changed",
      ],
      extras: clientPageExtras,
    },
    LINKS,
    FORMS,
    SUBMISSIONS,
  ],
};
