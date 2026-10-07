/**
 * Sites (designs/2026-10-07-sites.md): every page we run, in one list. Data pages are made from
 * an offer and a template, their copy edited as a form, made live by a yes in To approve and
 * served at /o/<slug> with no deploy. Code pages are built in a repo (the lander skill) and
 * listed here by URL with the same numbers. The Funnel reads each page by where its visits came
 * from, ads with their spend. Forms are hosted forms (designs/2026-10-07-forms-and-pay.md), built
 * as fields and live at /o/f/<slug> or framed anywhere; Submissions holds every form sent, whole,
 * for export.
 */
import type { Module } from "../../module.js";
import { FORM_ACTIONS, PAGE_ACTIONS } from "./actions.js";
import { pageExtras } from "./detail.js";
import { formExtras } from "./forms.js";

export const sites: Module = {
  id: "sites",
  name: "Sites",
  icon: "link",
  blurb: "Every lander, listicle, funnel page and hosted form, with its visits, submits and bookings.",
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
    {
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
    },
    {
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
    },
  ],
};
