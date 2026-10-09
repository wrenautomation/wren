/**
 * Documents as records (designs/2026-10-09-documents.md, "Portal"): one client's contracts,
 * proposals and estimates, and its templates. Served by DocumentsConsole on the main database,
 * the rows kept to the client asked for.
 */
import {
  actor,
  date,
  defineRecord,
  money,
  prose,
  type RecordType,
  status,
  text,
} from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { payLinks } from "@wren/payments/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { docEvents, docs, docTemplates } from "./schema.js";
import { KIND_NAME } from "./store.js";

export const DOC_RECORD = "documents.document";
export const TEMPLATE_RECORD = "documents.template";

const STATUSES = {
  draft: { label: "Draft", tone: "neutral" },
  waiting: { label: "To approve", tone: "warn" },
  sending: { label: "Sending", tone: "neutral" },
  sent: { label: "Sent", tone: "neutral" },
  viewed: { label: "Viewed", tone: "neutral" },
  signed: { label: "Signed", tone: "good" },
  declined: { label: "Declined", tone: "bad" },
  expired: { label: "Expired", tone: "neutral" },
  void: { label: "Void", tone: "neutral" },
  failed: { label: "Failed", tone: "bad" },
} as const;
const KINDS = {
  contract: { label: KIND_NAME.contract, tone: "neutral" },
  proposal: { label: KIND_NAME.proposal, tone: "neutral" },
  estimate: { label: KIND_NAME.estimate, tone: "neutral" },
} as const;
const STEP: Record<string, string> = {
  made: "Made",
  asked: "Send asked",
  sent: "Sent",
  viewed: "Opened",
  signed: "Signed",
  declined: "Declined",
  paid: "Deposit paid",
  voided: "Voided",
  expired: "Expired",
  reminded: "Reminder sent",
};

/** ponytail: rows, not a view: a client sends dozens a month, not thousands. */
const ROWS = 1000;

const rowsOf = async (db: Queryable, client: string, id?: string) =>
  (
    await db
      .select()
      .from(docs)
      .where(and(eq(docs.client, client), id ? eq(docs.id, id) : undefined))
      .orderBy(desc(docs.createdAt))
      .limit(ROWS)
  ).map((d) => ({
    id: d.id,
    number: d.number,
    title: d.title,
    kind: d.kind,
    who: d.signerName ?? d.name ?? d.email ?? (d.contact ? `Thread ${d.contact}` : "No one yet"),
    total: d.totalCents / 100,
    deposit: d.depositCents === null ? null : d.depositCents / 100,
    currency: d.currency.toUpperCase(),
    status: d.status,
    channel: d.channel,
    email: d.email,
    why: d.why ?? d.declinedWhy,
    body: d.body,
    sha256: d.sha256,
    pay_link: d.payLink,
    created_at: d.createdAt,
    created_by: d.createdBy,
    approved_by: d.approvedBy,
    sent_at: d.sentAt,
    viewed_at: d.viewedAt,
    signed_at: d.signedAt,
    expires_at: d.expiresAt,
  }));

/** A client's documents. Built per request: its rows are that client's only. */
export function documentRecordFor(client: string): RecordType {
  return defineRecord({
    id: DOC_RECORD,
    app: "documents",
    channel: null,
    name: { one: "document", many: "documents" },
    rows: (db) => rowsOf(db, client),
    key: "id",
    title: "title",
    subtitle: "who",
    fields: {
      number: text("Number"),
      title: text("Title"),
      kind: status(KINDS, "Kind"),
      who: text("For"),
      total: money("Total"),
      deposit: money("Deposit"),
      status: status(STATUSES, "Status"),
      channel: status(
        { sms: { label: "Text", tone: "neutral" }, email: { label: "Email", tone: "neutral" } },
        "Sent by",
      ),
      email: text("Email"),
      why: text("Why"),
      body: prose("Words", { listed: false }),
      sha256: text("Fingerprint (SHA-256)", { listed: false }),
      createdAt: date("Made"),
      createdBy: actor("Made by"),
      approvedBy: actor("Approved by"),
      sentAt: date("Sent"),
      viewedAt: date("Opened"),
      signedAt: date("Signed"),
      expiresAt: date("Expires"),
    },
    views: [
      {
        id: "open",
        label: "Open",
        where: { status: ["draft", "sending", "sent", "viewed", "failed"] },
        sort: "-createdAt",
        at: "createdAt",
      },
      {
        id: "waiting",
        label: "To approve",
        where: { status: "waiting" },
        sort: "-createdAt",
        at: "createdAt",
      },
      {
        id: "signed",
        label: "Signed",
        where: { status: "signed" },
        sort: "-signedAt",
        at: "signedAt",
      },
      { id: "all", label: "All", sort: "-createdAt", at: "createdAt" },
    ],
    actions: [
      "documents.create",
      "documents.save",
      "documents.send",
      "documents.approve",
      "documents.decline",
      "documents.remind",
      "documents.duplicate",
      "documents.void",
    ],
    /** Every step in order, with where it came from, and the deposit's state. */
    load: async (db, id) => {
      const [d] = await rowsOf(db, client, String(id));
      if (!d) return null;
      const [raw] = await db
        .select()
        .from(docs)
        .where(eq(docs.id, String(id)));
      const events = await db
        .select()
        .from(docEvents)
        .where(eq(docEvents.document, String(id)))
        .orderBy(docEvents.at, docEvents.id);
      const [pay] = d.pay_link
        ? await db
            .select({ status: payLinks.status, url: payLinks.url, paidAt: payLinks.paidAt })
            .from(payLinks)
            .where(eq(payLinks.id, d.pay_link))
        : [];
      return {
        steps: events.map((e) => ({
          step: `${STEP[e.type] ?? e.type}${e.note ? `: ${e.note}` : ""}`,
          at: e.at,
          by: e.by === "recipient" ? null : e.by,
          from: [e.ip, e.agent].filter(Boolean).join(", ") || null,
        })),
        deposit: pay ? { status: pay.status, url: pay.url, paid_at: pay.paidAt } : null,
        /** The whole draft, for the editor: rows leave out the lines and the thread. */
        edit: raw
          ? {
              kind: raw.kind,
              template: raw.template,
              title: raw.title,
              body: raw.body,
              lines: raw.lines,
              name: raw.name,
              email: raw.email,
              contact: raw.contact,
              channel: raw.channel,
              depositPct:
                raw.depositCents && raw.totalCents
                  ? Math.round((raw.depositCents * 100) / raw.totalCents)
                  : null,
              expiresDays: raw.expiresDays,
              currency: raw.currency,
            }
          : null,
      };
    },
  });
}

/** A client's templates, archived ones left out. */
export function templateRecordFor(client: string): RecordType {
  return defineRecord({
    id: TEMPLATE_RECORD,
    app: "documents",
    channel: null,
    name: { one: "template", many: "templates" },
    rows: async (db) =>
      (
        await db
          .select()
          .from(docTemplates)
          .where(and(eq(docTemplates.client, client), isNull(docTemplates.archivedAt)))
          .orderBy(docTemplates.kind, docTemplates.name)
          .limit(ROWS)
      ).map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        body: t.body,
        lines: t.lines.length,
        deposit_pct: t.depositPct,
        expires_days: t.expiresDays,
        starter: t.starter ? "Starter" : "Yours",
        updated_at: t.updatedAt,
        updated_by: t.updatedBy,
      })),
    key: "id",
    title: "name",
    subtitle: "kind",
    fields: {
      name: text("Name"),
      kind: status(KINDS, "Kind"),
      body: prose("Words", { listed: false }),
      lines: text("Line items"),
      depositPct: text("Deposit %"),
      expiresDays: text("Expires in (days)"),
      starter: status(
        { Starter: { label: "Starter", tone: "neutral" }, Yours: { label: "Yours", tone: "good" } },
        "From",
      ),
      updatedAt: date("Changed"),
      updatedBy: actor("Changed by"),
    },
    views: [{ id: "all", label: "All", sort: "name", at: "updatedAt" }],
    actions: ["documents.templateSave", "documents.templateArchive", "documents.create"],
  });
}

/** The types as the portal lists them: the same fields and views, no rows. */
export const DOC_RECORD_TYPE = documentRecordFor("");
export const TEMPLATE_RECORD_TYPE = templateRecordFor("");
export const DOCUMENTS_RECORDS: readonly RecordType[] = [DOC_RECORD_TYPE, TEMPLATE_RECORD_TYPE];
