/**
 * Numbers (designs/2026-10-19-portal-reshape.md): how the business and its funnels do. The
 * funnel tables read the pipeline's numbers; the books pages (economics, months, channels,
 * cohorts) moved here from Money unchanged, each still behind the money permission. Money
 * keeps what Wren spends and bills.
 */
import { createElement } from "react";
import type { Module } from "../../module.js";

const MONTHS = "/numbers/months?view=all";
const NO_CLIENTS = "No paying clients yet";
/** A month's figure, the month before and a bar a month; `none` while it has no value. */
const figure = (label: string, pick: string, none = NO_CLIENTS) => ({
  label,
  record: "books.month",
  href: MONTHS,
  pick,
  none,
});

/**
 * The three tables read one record, so each starts on its own view: an address with no view is
 * sent on to it (`ListPage.legacy` runs before the page draws).
 */
const startsOn = (view: string) => (params: URLSearchParams) =>
  params.has("view") ? null : { view };

export const numbers: Module = {
  id: "numbers",
  name: "Numbers",
  component: "pipeline.journeys",
  icon: "chart",
  blurb: "How each funnel, entry and offer converts, and what a client costs and earns.",
  requires: { audience: "team" },
  pages: [
    {
      id: "funnels",
      label: "Funnels",
      about: "Each funnel's stages: who entered, who went on, and how long it took.",
      template: "list",
      record: "pipeline.number",
      empty: "No funnel has numbers yet.",
    },
    {
      id: "entries",
      label: "Entries",
      about: "Each way in: how many opened a journey, and what they came to.",
      template: "list",
      record: "pipeline.number",
      legacy: startsOn("entry"),
      empty: "No entry has numbers yet.",
    },
    {
      id: "offers",
      label: "Offers",
      about: "Each offer's journeys, deals and what was collected.",
      template: "list",
      record: "pipeline.number",
      legacy: startsOn("offer"),
      empty: "No offer has numbers yet.",
    },
    {
      id: "economics",
      requires: { needs: "money" },
      label: "Economics",
      about: "What it costs to win a client, and what a client brings in.",
      template: "overview",
      tiles: [
        figure("CAC", "cac6"),
        figure("Predicted LTV", "ltv", "No churn yet"),
        figure("LTV:CAC", "ltvCac", "No churn yet"),
        figure("Payback (months)", "payback"),
        figure("Logo churn", "logoChurn"),
        figure("Revenue churn", "revenueChurn"),
        figure("MRR", "mrr"),
        figure("ARPA", "arpa"),
        figure("Gross margin", "grossMargin"),
      ],
      top: [
        {
          label: "Cost per reply and per booked call this month",
          record: "books.channel",
          href: "/numbers/channels?view=this_month",
          fields: ["perReply", "perBooked"],
          empty: "No channel spent anything this month yet.",
        },
      ],
      below: () =>
        createElement(
          "p",
          { className: "mt-6 text-[13px] text-(--ui-ink-2)" },
          "Your own time isn't a cost here.",
        ),
    },
    {
      id: "months",
      requires: { needs: "money" },
      label: "Months",
      about: "Every cost and revenue figure, month by month.",
      template: "list",
      record: "books.month",
      empty: "Months show here once the books have spend.",
    },
    {
      id: "channels",
      requires: { needs: "money" },
      label: "Channels",
      about: "Spend and the cost of a client for each channel, by month.",
      template: "list",
      record: "books.channel",
      empty: {
        this_month: "No channel spent anything this month yet.",
        all: "Channels show here once the books have spend.",
      },
    },
    {
      id: "cohorts",
      requires: { needs: "money" },
      label: "Cohorts",
      about: "Clients grouped by the month they first paid.",
      template: "list",
      record: "books.cohort",
      empty: "Cohorts show here once a client pays.",
    },
  ],
};
