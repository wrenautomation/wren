/**
 * The books as console records (`@wren/core/records`): spend lines and subscriptions, over
 * `books.spend_records` and `books.subscription_records`. Team only; amounts in dollars.
 */
import { date, defineRecord, money, number, status, text } from "@wren/core/records";

export const spendRecord = defineRecord({
  id: "books.spend",
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
  },
  views: [
    { id: "all", label: "All", sort: "-monthly", at: "lastBilledOn" },
    { id: "soon", label: "Renewing soon", where: { renewal: "soon" }, sort: "renewsOn" },
    { id: "past", label: "Past renewal", where: { renewal: "past" }, sort: "renewsOn" },
  ],
});

export const BOOKS_RECORDS = [spendRecord, subscriptionRecord];
