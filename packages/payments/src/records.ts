/**
 * Payments as records (designs/2026-10-07-forms-and-pay.md, "Portal"): one client's pay links
 * with status, amount and what was paid. Served by PaymentsConsole on the main database, the
 * rows kept to the client asked for.
 */
import {
  actor,
  date,
  defineRecord,
  link,
  money,
  number,
  type RecordType,
  status,
  text,
} from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { and, desc, eq } from "drizzle-orm";
import { payEvents, payLinks } from "./schema.js";
import type { PayStatus } from "./states.js";

export const LINK_RECORD = "payments.link";

const STATUSES = {
  waiting: { label: "To approve", tone: "warn" },
  sending: { label: "Sending", tone: "neutral" },
  sent: { label: "Sent", tone: "neutral" },
  processing: { label: "Bank payment clearing", tone: "neutral" },
  unpaid: { label: "Didn't go through", tone: "bad" },
  paid: { label: "Paid", tone: "good" },
  refunded: { label: "Refunded", tone: "warn" },
  declined: { label: "Declined", tone: "neutral" },
  failed: { label: "Failed", tone: "bad" },
} as const satisfies Record<PayStatus, unknown>;
const DISPUTES = {
  open: { label: "Disputed", tone: "warn" },
  won: { label: "Dispute won", tone: "good" },
  lost: { label: "Dispute lost", tone: "bad" },
} as const;
/** How a kept event reads on the link's steps. */
const SAID: Record<string, string> = {
  paid: "paid",
  processing: "bank payment clearing",
  unpaid: "didn't go through",
  refunded: "refund",
  disputed: "dispute",
  stale: "seen before, nothing changed",
  unknown: "kept",
  ignored: "not ours",
  drift: "disagrees with Stripe",
};

/** ponytail: rows, not a view: a client sends dozens of links a month, not thousands. */
const ROWS = 1000;

const rowsOf = async (db: Queryable, client: string, id?: string) =>
  (
    await db
      .select()
      .from(payLinks)
      .where(and(eq(payLinks.client, client), id ? eq(payLinks.id, id) : undefined))
      .orderBy(desc(payLinks.createdAt))
      .limit(ROWS)
  ).map((l) => ({
    id: l.id,
    who: l.name ?? l.email ?? (l.contact ? `Thread ${l.contact}` : "Someone"),
    description: l.description,
    amount: (l.amountCents * l.quantity) / 100,
    paid: l.paidCents === null ? null : l.paidCents / 100,
    refunded: l.refundedCents ? l.refundedCents / 100 : null,
    dispute: l.dispute,
    currency: l.currency.toUpperCase(),
    quantity: l.quantity,
    status: l.status,
    channel: l.channel,
    email: l.email,
    url: l.url,
    why: l.why,
    created_at: l.createdAt,
    created_by: l.createdBy,
    approved_by: l.approvedBy,
    sent_at: l.sentAt,
    paid_at: l.paidAt,
    refunded_at: l.refundedAt,
    checked_at: l.checkedAt,
    test: l.live === false ? "test" : l.live ? "live" : null,
  }));

/** A client's pay links. Built per request: its rows are that client's only. */
export function linkRecordFor(client: string): RecordType {
  return defineRecord({
    id: LINK_RECORD,
    app: "payments",
    channel: null,
    name: { one: "pay link", many: "pay links" },
    rows: (db) => rowsOf(db, client),
    key: "id",
    title: "who",
    subtitle: "description",
    fields: {
      who: text("Who"),
      description: text("For"),
      amount: money("Amount"),
      paid: money("Paid"),
      refunded: money("Refunded"),
      status: status(STATUSES, "Status"),
      dispute: status(DISPUTES, "Dispute"),
      channel: status(
        { sms: { label: "Text", tone: "neutral" }, email: { label: "Email", tone: "neutral" } },
        "Sent by",
      ),
      quantity: number("Quantity"),
      email: text("Email"),
      url: link("Link"),
      why: text("Why"),
      createdAt: date("Made"),
      createdBy: actor("Made by"),
      approvedBy: actor("Approved by"),
      sentAt: date("Sent"),
      paidAt: date("Paid on"),
      refundedAt: date("Refunded on"),
      checkedAt: date("Checked with Stripe"),
      test: status(
        { test: { label: "Test mode", tone: "warn" }, live: { label: "Live", tone: "neutral" } },
        "Mode",
      ),
    },
    views: [
      { id: "all", label: "All", sort: "-createdAt", at: "createdAt" },
      {
        id: "waiting",
        label: "To approve",
        where: { status: "waiting" },
        sort: "-createdAt",
        at: "createdAt",
      },
      {
        id: "sent",
        label: "Sent",
        where: { status: ["sending", "sent"] },
        sort: "-createdAt",
        at: "createdAt",
      },
      { id: "paid", label: "Paid", where: { status: "paid" }, sort: "-paidAt", at: "paidAt" },
      {
        id: "trouble",
        label: "Refunds and failures",
        where: { status: ["refunded", "unpaid", "failed"] },
        sort: "-createdAt",
        at: "createdAt",
      },
    ],
    actions: ["payments.create", "payments.approve", "payments.decline", "payments.again"],
    /** What happened to it, Stripe's events included (trimmed: no card ever reaches us). */
    load: async (db, id) => {
      const [l] = await rowsOf(db, client, String(id));
      if (!l) return null;
      const events = await db
        .select({
          id: payEvents.id,
          type: payEvents.type,
          result: payEvents.result,
          at: payEvents.at,
        })
        .from(payEvents)
        .where(eq(payEvents.link, String(id)))
        .orderBy(payEvents.at);
      return {
        steps: [
          { step: "Made", at: l.created_at, by: l.created_by },
          ...(l.approved_by && l.status !== "declined"
            ? [{ step: "Approved", at: null, by: l.approved_by }]
            : []),
          ...(l.sent_at
            ? [{ step: l.channel === "sms" ? "Text queued" : "Emailed", at: l.sent_at, by: null }]
            : []),
          ...events.map((e) => ({
            step: `${e.id.startsWith("recon:") ? "Reconcile" : "Stripe"}: ${e.type} (${SAID[e.result] ?? e.result})`,
            at: e.at,
            by: null,
          })),
        ],
      };
    },
  });
}

/** The type as the portal lists it: the same fields and views, no rows. */
const LINK_RECORD_TYPE = linkRecordFor("");
export const PAYMENTS_RECORDS: readonly RecordType[] = [LINK_RECORD_TYPE];
