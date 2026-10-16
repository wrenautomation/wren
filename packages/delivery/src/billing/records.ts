/**
 * Money in, as a console record in Money (designs/2026-10-15-wise-billing.md): every credit
 * BillingWatch read from Wise, what it paid or why it waits. Team only; amounts in their currency.
 */
import {
  actor,
  date,
  defineRecord,
  money,
  name,
  type RecordType,
  status,
  text,
} from "@wren/core/records";
import { CREDIT_STATUSES } from "../schema.js";
import { creditsList } from "./credits.js";

export const CREDIT_STATE = status(
  {
    review: { label: "To look at", tone: "warn" },
    matched: { label: "On an invoice", tone: "good" },
    dismissed: { label: "Set aside", tone: "neutral" },
    ignored: { label: "Our own", tone: "neutral" },
  },
  "State",
);

export const creditRecord = defineRecord({
  id: "console.credit",
  app: "money",
  channel: null,
  needs: "money",
  name: { one: "payment in", many: "payments in" },
  rows: async (db) =>
    (await creditsList(db, { status: CREDIT_STATUSES, limit: 500 })).map((c) => ({
      id: c.id,
      payer: c.payer ?? c.kind,
      status: c.status,
      amount: (c.cents + c.feeCents) / 100,
      landed: c.cents / 100,
      currency: c.currency,
      invoice: c.invoice,
      client: c.clientName,
      why: c.why,
      memo: c.memo,
      kind: c.kind,
      by: c.decidedBy,
      at: c.at,
    })),
  key: "id",
  title: "payer",
  subtitle: "why",
  fields: {
    payer: name("From"),
    status: CREDIT_STATE,
    amount: money("Sent"),
    landed: money("Landed, after Wise's fee"),
    currency: text("Currency"),
    invoice: text("Invoice"),
    client: text("Client"),
    why: text("Why"),
    memo: text("Memo"),
    kind: text("Wise's kind", { listed: false }),
    by: actor("Decided by", { listed: false }),
    at: date("Arrived"),
  },
  views: [
    { id: "review", label: "To look at", where: { status: ["review"] }, sort: "-at", at: "at" },
    { id: "matched", label: "Paid", where: { status: ["matched"] }, sort: "-at", at: "at" },
    {
      id: "all",
      label: "All",
      where: { status: ["review", "matched", "dismissed"] },
      sort: "-at",
      at: "at",
    },
    { id: "own", label: "Our own moves", where: { status: ["ignored"] }, sort: "-at", at: "at" },
  ],
  actions: ["billing.match", "billing.dismiss"],
});

export const BILLING_RECORDS: readonly RecordType[] = [creditRecord];
