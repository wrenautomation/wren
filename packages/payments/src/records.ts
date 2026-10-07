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

export const LINK_RECORD = "payments.link";

const STATUSES = {
  waiting: { label: "To approve", tone: "warn" },
  sending: { label: "Sending", tone: "neutral" },
  sent: { label: "Sent", tone: "neutral" },
  paid: { label: "Paid", tone: "good" },
  declined: { label: "Declined", tone: "neutral" },
  failed: { label: "Failed", tone: "bad" },
} as const;

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
      status: status(STATUSES, "Status"),
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
    ],
    actions: ["payments.create", "payments.approve", "payments.decline"],
    /** What happened to it, Stripe's events included (trimmed: no card ever reaches us). */
    load: async (db, id) => {
      const [l] = await rowsOf(db, client, String(id));
      if (!l) return null;
      const events = await db
        .select({ type: payEvents.type, result: payEvents.result, at: payEvents.at })
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
          ...events.map((e) => ({ step: `Stripe: ${e.type} (${e.result})`, at: e.at, by: null })),
        ],
      };
    },
  });
}

/** The type as the portal lists it: the same fields and views, no rows. */
export const LINK_RECORD_TYPE = linkRecordFor("");
export const PAYMENTS_RECORDS: readonly RecordType[] = [LINK_RECORD_TYPE];
