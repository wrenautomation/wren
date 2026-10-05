/**
 * The books as console records (`@wren/core/records`): spend lines, subscriptions, unit economics
 * (months, channels, cohorts) and the chart of accounts. Team only; amounts in dollars.
 */
import { date, defineRecord, money, number, percent, status, text } from "@wren/core/records";
import { UNKNOWN_CHANNEL } from "./economics.js";

export const spendRecord = defineRecord({
  id: "books.spend",
  needs: "money",
  name: { one: "spend line", many: "spend" },
  view: "books.spend_records",
  key: "id",
  title: "vendor",
  subtitle: "account",
  fields: {
    vendor: text(),
    account: text(),
    amount: money("Amount (CAD)"),
    month: date(),
    t2125Line: text("T2125 line"),
    age: status(
      {
        this_month: { label: "This month", tone: "good" },
        last_month: { label: "Last month", tone: "neutral" },
        earlier: { label: "Earlier", tone: "neutral" },
      },
      "Month",
    ),
  },
  views: [
    {
      id: "this_month",
      label: "This month",
      where: { age: "this_month" },
      sort: "-amount",
      at: "month",
    },
    { id: "last_month", label: "Last month", where: { age: "last_month" }, sort: "-amount" },
    { id: "all", label: "All", sort: "-month", at: "month" },
  ],
});

export const subscriptionRecord = defineRecord({
  id: "books.subscription",
  needs: "money",
  name: { one: "subscription", many: "subscriptions" },
  view: "books.subscription_records",
  key: "id",
  title: "vendor",
  subtitle: "plan",
  fields: {
    vendor: text(),
    plan: text(),
    monthly: money("Monthly (CAD)", { currency: "cad" }),
    cost: money("Last bill"),
    cycle: status({
      monthly: { label: "Monthly", tone: "neutral" },
      yearly: { label: "Yearly", tone: "neutral" },
    }),
    renewal: status({
      past: { label: "Past due date", tone: "warn" },
      soon: { label: "Within 30 days", tone: "neutral" },
      later: { label: "Later", tone: "good" },
    }),
    renewsOn: date("Renews"),
    lastBilledOn: date("Last billed"),
    since: date(),
    bills: number(),
    billedFor: text("Billed for"),
  },
  views: [
    { id: "all", label: "All", sort: "-monthly", at: "lastBilledOn" },
    { id: "soon", label: "Renewing soon", where: { renewal: "soon" }, sort: "renewsOn" },
    { id: "past", label: "Past renewal", where: { renewal: "past" }, sort: "renewsOn" },
  ],
});

const CHANNEL_STATES = {
  email: { label: "Email", tone: "neutral" },
  sms: { label: "SMS", tone: "neutral" },
  ads: { label: "Ads", tone: "neutral" },
  content: { label: "Content", tone: "neutral" },
  search: { label: "Search", tone: "neutral" },
  reach: { label: "Reach", tone: "neutral" },
  [UNKNOWN_CHANNEL]: { label: "Unknown", tone: "neutral" },
} as const;
/** Each figure is CAD; a month is Toronto's. */
const cad = (label: string, from?: string) => money(`${label} (CAD)`, from ? { from } : {});

/** Every unit economics figure per month (`books.econ_months`): one row a month, newest first. */
export const monthRecord = defineRecord({
  id: "books.month",
  needs: "money",
  name: { one: "month", many: "months" },
  view: "books.econ_months",
  key: "id",
  title: "period",
  fields: {
    period: text("Month", { from: "id" }),
    month: date("Starts"),
    mrr: cad("MRR"),
    revenue: cad("Revenue"),
    spend: cad("Spend"),
    acquisition: cad("Acquisition"),
    delivery: cad("Delivery"),
    overhead: cad("Overhead"),
    paying: number("Paying clients"),
    payingStart: number("Paying at start"),
    newClients: number("New clients"),
    churned: number("Churned"),
    arpa: cad("ARPA"),
    arpa3: cad("ARPA, 3 months", "arpa_3"),
    grossMargin: percent("Gross margin"),
    cac3: cad("CAC, 3 months", "cac_3"),
    cac6: cad("CAC, 6 months", "cac_6"),
    cac12: cad("CAC, 12 months", "cac_12"),
    logoChurn: percent("Logo churn"),
    revenueChurn: percent("Revenue churn"),
    ltv: cad("Predicted LTV"),
    ltvCac: number("LTV:CAC"),
    payback: number("Payback (months)"),
    realizedLtv: cad("Realized LTV, churned"),
    realizedLtvAll: cad("Realized LTV, all"),
  },
  views: [{ id: "all", label: "All", sort: "-month", at: "month" }],
});

/** Per channel and month (`books.econ_channels`): spend, each funnel stage and its cost, CAC. */
export const channelRecord = defineRecord({
  id: "books.channel",
  needs: "money",
  name: { one: "channel month", many: "channel months" },
  view: "books.econ_channels",
  key: "id",
  title: "channel",
  subtitle: "month",
  fields: {
    channel: status(CHANNEL_STATES),
    month: date(),
    age: status(
      { true: { label: "This month", tone: "good" }, false: { label: "Earlier", tone: "neutral" } },
      "Month",
      { from: "latest" },
    ),
    spend: cad("Spend"),
    leads: number(),
    sends: number(),
    replies: number(),
    interested: number(),
    booked: number("Booked calls"),
    newClients: number("New clients"),
    perLead: cad("Per lead"),
    perSend: cad("Per send"),
    perReply: cad("Per reply"),
    perInterested: cad("Per interested"),
    perBooked: cad("Per booked call"),
    cac3: cad("CAC, 3 months", "cac_3"),
    cac6: cad("CAC, 6 months", "cac_6"),
    cac12: cad("CAC, 12 months", "cac_12"),
  },
  views: [
    { id: "this_month", label: "This month", where: { age: "true" }, sort: "-spend" },
    { id: "all", label: "All", sort: "-month", at: "month" },
  ],
});

/** Clients by the month they first paid, per month since (`books.econ_cohorts`). */
export const cohortRecord = defineRecord({
  id: "books.cohort",
  needs: "money",
  name: { one: "cohort month", many: "cohort months" },
  view: "books.econ_cohorts",
  key: "id",
  title: "cell",
  fields: {
    cell: text("Cohort, months since", { from: "id" }),
    cohort: date("First paid"),
    monthsSince: number("Months since"),
    clients: number(),
    paying: number("Still paying"),
    stillPaying: percent("Share still paying"),
    revenue: cad("Revenue"),
    revenueKept: percent("Revenue kept"),
  },
  views: [{ id: "all", label: "All", sort: "-cohort", at: "cohort" }],
});

/** The chart of accounts: an expense's bucket and channel set where its spend counts. */
export const accountRecord = defineRecord({
  id: "books.account",
  needs: "money",
  name: { one: "account", many: "accounts" },
  view: "books.accounts",
  key: "id",
  title: "name",
  subtitle: "key",
  fields: {
    name: text(),
    key: text(),
    type: status({
      expense: { label: "Expense", tone: "neutral" },
      income: { label: "Income", tone: "neutral" },
      asset: { label: "Asset", tone: "neutral" },
      liability: { label: "Liability", tone: "neutral" },
      equity: { label: "Equity", tone: "neutral" },
    }),
    bucket: status({
      acquisition: { label: "Acquisition", tone: "neutral" },
      delivery: { label: "Delivery", tone: "neutral" },
      overhead: { label: "Overhead", tone: "neutral" },
    }),
    channel: status(CHANNEL_STATES),
  },
  views: [
    { id: "expenses", label: "Expenses", where: { type: "expense" }, sort: "name" },
    { id: "all", label: "All", sort: "name" },
  ],
});

export const BOOKS_RECORDS = [
  spendRecord,
  subscriptionRecord,
  monthRecord,
  channelRecord,
  cohortRecord,
  accountRecord,
];
