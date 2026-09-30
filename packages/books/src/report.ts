import type { Db } from "@wren/db";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  accounts,
  billCosts,
  billDocuments,
  billLines,
  billPayments,
  bills,
  billTaxes,
  documents,
  entries,
  lines,
  spend,
  subscriptions,
  vendors,
} from "./schema.js";

export interface Range {
  /** First day, `YYYY-MM-DD`. */
  from?: string;
  /** Last day, `YYYY-MM-DD`. */
  to?: string;
}

/** Bills with what they cost in CAD, oldest first. */
export async function listBills(db: Db, opts: Range & { vendor?: string; review?: boolean } = {}) {
  const where: SQL[] = [];
  if (opts.from) where.push(gte(billCosts.issuedOn, opts.from));
  if (opts.to) where.push(lte(billCosts.issuedOn, opts.to));
  if (opts.vendor) where.push(eq(billCosts.vendor, opts.vendor));
  if (opts.review) where.push(eq(billCosts.review, "needs_review"));
  return db
    .select()
    .from(billCosts)
    .where(and(...where))
    .orderBy(asc(billCosts.issuedOn), asc(billCosts.billId));
}

/** Everything known about one bill: as printed, what paid it, where it came from, how it posted. */
export async function billDetail(db: Db, id: number) {
  const [bill] = await db.select().from(bills).where(eq(bills.id, id));
  if (!bill) return null;
  const [cost] = await db.select().from(billCosts).where(eq(billCosts.billId, id));
  const docIds = (
    await db
      .select({ id: billDocuments.documentId })
      .from(billDocuments)
      .where(eq(billDocuments.billId, id))
  ).map((d) => d.id);
  const docs = docIds.length
    ? await db
        .select({
          id: documents.id,
          parentId: documents.parentId,
          mediaType: documents.mediaType,
          size: documents.size,
          filename: documents.filename,
          mailbox: documents.mailbox,
          subject: documents.subject,
          fromAddress: documents.fromAddress,
          sentAt: documents.sentAt,
          kind: documents.kind,
          storeKey: documents.storeKey,
        })
        .from(documents)
        .where(or(inArray(documents.id, docIds), inArray(documents.parentId, docIds)))
        .orderBy(asc(documents.id))
    : [];
  const journal = await db
    .select({ entry: entries, line: lines, account: accounts.key })
    .from(entries)
    .innerJoin(lines, eq(lines.entryId, entries.id))
    .innerJoin(accounts, eq(accounts.id, lines.accountId))
    .where(eq(entries.billId, id))
    .orderBy(asc(entries.id), asc(lines.id));
  return {
    bill,
    cost,
    lines: await db
      .select()
      .from(billLines)
      .where(eq(billLines.billId, id))
      .orderBy(asc(billLines.position)),
    taxes: await db
      .select()
      .from(billTaxes)
      .where(eq(billTaxes.billId, id))
      .orderBy(asc(billTaxes.position)),
    payments: await db
      .select()
      .from(billPayments)
      .where(eq(billPayments.billId, id))
      .orderBy(asc(billPayments.paidOn)),
    documents: docs,
    journal,
  };
}

/** Payments, oldest first, with the bill each pays; `billNumber` null and `invoiceNumber` null = on account. */
export async function listPayments(db: Db, opts: Range & { vendor?: string } = {}) {
  const where: SQL[] = [];
  if (opts.from) where.push(gte(billPayments.paidOn, opts.from));
  if (opts.to) where.push(lte(billPayments.paidOn, opts.to));
  if (opts.vendor) where.push(eq(vendors.key, opts.vendor));
  return db
    .select({
      id: billPayments.id,
      paidOn: billPayments.paidOn,
      vendor: vendors.name,
      invoiceNumber: billPayments.invoiceNumber,
      billId: billPayments.billId,
      amountCents: billPayments.amountCents,
      currency: billPayments.currency,
      method: billPayments.method,
      reference: billPayments.reference,
      documentId: billPayments.documentId,
    })
    .from(billPayments)
    .innerJoin(vendors, eq(vendors.id, billPayments.vendorId))
    .where(and(...where))
    .orderBy(asc(billPayments.paidOn), asc(billPayments.id));
}

/** Expense by month, account and vendor, in CAD cents. */
export async function listSpend(db: Db, opts: Range = {}) {
  const where: SQL[] = [];
  if (opts.from) where.push(gte(spend.month, opts.from));
  if (opts.to) where.push(lte(spend.month, opts.to));
  return db
    .select()
    .from(spend)
    .where(and(...where))
    .orderBy(asc(spend.month), asc(spend.account), asc(spend.vendor));
}

/** Subscriptions, dearest first. */
export async function listSubscriptions(db: Db) {
  return db.select().from(subscriptions).orderBy(desc(subscriptions.monthlyCadCents));
}

/** One kept document; its bytes are in the store under `storeKey`. */
export async function getDocument(db: Db, id: number) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id));
  return doc ?? null;
}

/**
 * What needs a look: bills held for review, payments toward an invoice no
 * bill claims (one on account needs no call), and emails that gave nothing (no vendor matched, the model could not read
 * them, or what they were read as did not survive the checks).
 */
export async function reviewQueue(db: Db) {
  const held = await db
    .select({
      id: bills.id,
      vendor: vendors.name,
      number: bills.number,
      issuedOn: bills.issuedOn,
      totalCents: bills.totalCents,
      currency: bills.currency,
      reasons: bills.reviewReasons,
    })
    .from(bills)
    .innerJoin(vendors, eq(vendors.id, bills.vendorId))
    .where(eq(bills.review, "needs_review"))
    .orderBy(asc(bills.issuedOn), asc(bills.id));
  const unclaimed = await db
    .select({
      id: billPayments.id,
      vendor: vendors.name,
      invoiceNumber: billPayments.invoiceNumber,
      paidOn: billPayments.paidOn,
      amountCents: billPayments.amountCents,
      currency: billPayments.currency,
      documentId: billPayments.documentId,
    })
    .from(billPayments)
    .innerJoin(vendors, eq(vendors.id, billPayments.vendorId))
    .where(and(isNull(billPayments.billId), isNotNull(billPayments.invoiceNumber)))
    .orderBy(asc(billPayments.paidOn), asc(billPayments.id));
  const linked = sql`EXISTS (SELECT 1 FROM ${billDocuments} bd WHERE bd.document_id = ${documents.id})`;
  const paid = sql`EXISTS (SELECT 1 FROM ${billPayments} bp WHERE bp.document_id = ${documents.id})`;
  const docs = await db
    .select({
      id: documents.id,
      sentAt: documents.sentAt,
      fromAddress: documents.fromAddress,
      subject: documents.subject,
      why: sql<string>`CASE WHEN ${documents.vendorId} IS NULL THEN 'no vendor matched' WHEN ${documents.kind} IS NULL THEN 'unreadable' WHEN ${documents.kind} = 'bill' THEN 'read as a bill, none kept' ELSE 'read as a payment, none kept' END`,
      notes: sql<string[] | null>`${documents.reading} -> 'checks' -> 'notes'`,
    })
    .from(documents)
    .where(
      and(
        isNull(documents.parentId),
        or(
          and(isNull(documents.vendorId), isNull(documents.kind)),
          and(isNotNull(documents.readAt), isNull(documents.kind)),
          and(eq(documents.kind, "bill"), sql`NOT ${linked}`),
          and(eq(documents.kind, "payment"), sql`NOT ${linked}`, sql`NOT ${paid}`),
        ),
      ),
    )
    .orderBy(asc(documents.sentAt), asc(documents.id));
  return { bills: held, payments: unclaimed, documents: docs };
}
