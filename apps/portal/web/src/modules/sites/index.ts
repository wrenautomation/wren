/**
 * Sites (designs/2026-10-07-sites.md): every page we run, in one list. Data pages are made from
 * an offer and a template, their copy edited as a form, made live by a yes in To approve and
 * served at /o/<slug> with no deploy. Code pages are built in a repo (the lander skill) and
 * listed here by URL with the same numbers. The Funnel reads each page by where its visits came
 * from, ads with their spend.
 */
import type { Module } from "../../module.js";
import { PAGE_ACTIONS } from "./actions.js";
import { pageExtras } from "./detail.js";

export const sites: Module = {
  id: "sites",
  name: "Sites",
  icon: "link",
  blurb: "Every lander, listicle and funnel page, with its visits, forms and bookings.",
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
        waiting: "Nothing waits for a yes.",
        ads: "No ad links to a page yet.",
        retired: "No page is retired.",
      },
      actions: PAGE_ACTIONS,
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
  ],
};
