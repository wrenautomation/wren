import type { Db, Tx } from "@wren/db";
import { completeAndParse, type LlmClient, type Tracer } from "@wren/llm";
import { and, asc, count, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { vendorSpec } from "./chart.js";
import { type CheckedBill, check, Reading, type VendorFacts } from "./ground.js";
import { formatMoney } from "./money.js";
import {
  type Bill,
  billDocuments,
  billLines,
  billPayments,
  bills,
  billTaxes,
  documents,
  vendors,
} from "./schema.js";

/** Per text given to the model; invoices are far shorter, so only junk is cut. */
const MAX_TEXT = 20_000;
const cut = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n[cut]` : s);

export interface Readable {
  subject: string | null;
  fromAddress: string | null;
  sentAt: Date | null;
  text: string | null;
  attachments: ReadonlyArray<{ filename: string | null; text: string | null }>;
}

/** The instruction and the document, for one reading. */
export function readingPrompt(vendor: string, doc: Readable): string {
  const parts = [
    `Vendor: ${vendor}`,
    `From: ${doc.fromAddress ?? ""}`,
    `Subject: ${doc.subject ?? ""}`,
    `Sent: ${doc.sentAt?.toISOString() ?? "unknown"}`,
    "",
    "--- email ---",
    cut(doc.text ?? ""),
    ...doc.attachments.flatMap((a) => [
      "",
      `--- attachment ${a.filename ?? "(no name)"} ---`,
      cut(a.text ?? "(no text could be read)"),
    ]),
  ];
  return `You read one billing document for a small business's books. Copy what it prints. Never compute, convert or guess.

${parts.join("\n")}

--- end ---

Answer with one JSON object and nothing else:
{
  "kind": "bill" | "payment" | "notice" | "other",
  "bill": null | {
    "number": the invoice number as printed, without a leading "#"; a receipt's number only when no invoice number is printed,
    "kind": "invoice" | "receipt" | "credit_note",
    "issued_on": the invoice or receipt date, "YYYY-MM-DD",
    "due_on": "YYYY-MM-DD" or null,
    "period_start": the first day of the service it pays for, "YYYY-MM-DD" or null,
    "period_end": the last day, "YYYY-MM-DD" or null,
    "currency": the ISO code printed with the amounts ("CAD", "USD"), or null when only "$" is printed,
    "lines": [{"description", "quantity", "unit_price", "amount", "period_start", "period_end"}],
    "subtotal": as printed, or null,
    "taxes": [{"name": as printed ("GST", "HST (13%)"), "rate_percent": "5" or null, "amount", "tax_number": the registration number printed for it, or null}],
    "total": as printed,
    "charged_cad": the CAD amount charged, when the bill is in another currency and prints it; else null,
    "payment_method": as printed ("Mastercard ending 1234"), or null,
    "billed_to": the bill-to block as printed, on one line, or null,
    "vendor_tax_number": the vendor's tax registration as printed, or null,
    "plan": the plan or product (a domain name for a registrar), or null,
    "cycle": "monthly" | "yearly" | "usage" | "once" | null
  },
  "payments": [{"invoice_number", "paid_on": "YYYY-MM-DD", "amount", "currency", "method", "reference": the receipt or transaction number}]
}

Rules:
- "bill": an invoice, receipt or credit note with a total. "payment": it only confirms a payment toward an invoice. "notice": billing news with nothing owed (a card expiring, a plan change). "other": anything else.
- A receipt for a paid invoice is both: fill "bill" and list the payment.
- Amounts: copy the printed text with its currency mark ("$147.00", "CA$7.00", "US$10.98"). Discounts and credits are negative lines ("-$5.00").
- Dates: the printed date as "YYYY-MM-DD".
- Anything not printed: null. No lines, taxes or payments: [].`;
}

export interface ReadOptions {
  runId?: string | null;
  tracer?: Tracer | null;
  /** Read these documents again (emails or files, not attachments), whatever was read before. */
  ids?: readonly number[];
  log?: (line: string) => void;
}

export interface ReadReport {
  read: number;
  bills: number;
  payments: number;
  /** Bills that need a look before they are posted. */
  review: number;
  /** Documents the model could not answer for; left for `--reread`. */
  unreadable: number;
}

/**
 * Read every captured document not read yet (or `ids` again): the model
 * answers from the email and its PDFs, `check` holds that to what is printed,
 * and bills and payments are saved. Each document commits on its own.
 */
export async function readDocuments(
  db: Db,
  llm: LlmClient,
  opts: ReadOptions = {},
): Promise<ReadReport> {
  const runId = opts.runId ?? null;
  const vendorRows = new Map((await db.select().from(vendors)).map((v) => [v.id, v]));
  const todo = await db
    .select()
    .from(documents)
    .where(
      opts.ids
        ? and(inArray(documents.id, [...opts.ids]), isNull(documents.parentId))
        : and(isNull(documents.readAt), isNull(documents.parentId), isNotNull(documents.vendorId)),
    )
    .orderBy(asc(documents.sentAt), asc(documents.id));
  const report: ReadReport = { read: 0, bills: 0, payments: 0, review: 0, unreadable: 0 };
  for (const doc of todo) {
    const vendor = doc.vendorId === null ? undefined : vendorRows.get(doc.vendorId);
    if (!vendor) {
      opts.log?.(`  document ${doc.id}: no vendor, skipped`);
      continue;
    }
    const attachments = await db
      .select({ id: documents.id, filename: documents.filename, text: documents.text })
      .from(documents)
      .where(eq(documents.parentId, doc.id))
      .orderBy(asc(documents.id));
    const facts: VendorFacts = {
      name: vendor.name,
      currency: vendorSpec(vendor.key)?.currency ?? null,
      cycle: vendor.cycle,
      gstClaimable: vendor.gstClaimable,
    };
    const outcome = await completeAndParse(
      llm,
      readingPrompt(vendor.name, { ...doc, attachments }),
      Reading,
      {
        maxTokens: 4096,
        runId,
        tracer: opts.tracer ?? null,
        name: "books.read",
        metadata: { document: doc.id },
      },
    );
    const family = [doc.id, ...attachments.map((a) => a.id)];
    if (!outcome.parsed) {
      await db
        .update(documents)
        .set({ readAt: new Date(), kind: null, reading: outcome.envelope() })
        .where(inArray(documents.id, family));
      report.unreadable++;
      opts.log?.(
        `  document ${doc.id}: unreadable (${outcome.parseError ?? outcome.providerRejected})`,
      );
      continue;
    }
    const corpus = [doc.subject ?? "", doc.text ?? "", ...attachments.map((a) => a.text ?? "")];
    const checked = check(outcome.parsed, { text: corpus.join("\n\n"), sentAt: doc.sentAt }, facts);
    await db.transaction(async (tx) => {
      let saved: Saved | null = null;
      if (checked.bill) {
        saved = await saveBill(tx, checked.bill, doc.id, vendor, runId);
        await tx
          .insert(billDocuments)
          .values({ billId: saved.id, documentId: doc.id })
          .onConflictDoNothing();
      }
      for (const p of checked.payments) {
        const [row] = await tx
          .insert(billPayments)
          .values({ vendorId: vendor.id, documentId: doc.id, ...p })
          .onConflictDoNothing()
          .returning({ id: billPayments.id });
        if (row) {
          report.payments++;
          continue;
        }
        // Known from another document: this one speaks about the same bill.
        const [known] = await tx
          .select({ billId: billPayments.billId })
          .from(billPayments)
          .where(
            and(
              eq(billPayments.vendorId, vendor.id),
              eq(billPayments.invoiceNumber, p.invoiceNumber),
              eq(billPayments.key, p.key),
            ),
          );
        if (known?.billId)
          await tx
            .insert(billDocuments)
            .values({ billId: known.billId, documentId: doc.id })
            .onConflictDoNothing();
      }
      await tx
        .update(documents)
        .set({
          kind: checked.kind,
          readAt: new Date(),
          reading: outcome.envelope({
            checks: { reasons: checked.bill?.reasons ?? [], notes: checked.notes },
            bill: saved,
          }),
        })
        .where(inArray(documents.id, family));
      report.read++;
      if (saved) {
        report.bills++;
        if (saved.review === "needs_review") report.review++;
        opts.log?.(
          `  ${vendor.key} ${checked.bill?.number}: ${saved.saved}, ${saved.review}${
            checked.bill?.reasons.length ? ` (${checked.bill.reasons.join("; ")})` : ""
          }`,
        );
      } else opts.log?.(`  document ${doc.id}: ${checked.kind}`);
    });
  }
  await linkPayments(db);
  return report;
}

interface Saved {
  id: number;
  saved: "new" | "replaced" | "enriched" | "conflict" | "kept";
  review: Bill["review"];
}

const detailColumns = (b: CheckedBill) => ({
  kind: b.kind,
  issuedOn: b.issuedOn,
  dueOn: b.dueOn,
  periodStart: b.periodStart,
  periodEnd: b.periodEnd,
  currency: b.currency,
  subtotalCents: b.subtotalCents,
  taxCents: b.taxCents,
  totalCents: b.totalCents,
  chargedCadCents: b.chargedCadCents,
  plan: b.plan,
  cycle: b.cycle,
  paymentMethod: b.paymentMethod,
  billedTo: b.billedTo,
  vendorTaxNumber: b.vendorTaxNumber,
});

async function writeLinesAndTaxes(tx: Tx, billId: number, b: CheckedBill): Promise<void> {
  await tx.delete(billLines).where(eq(billLines.billId, billId));
  await tx.delete(billTaxes).where(eq(billTaxes.billId, billId));
  if (b.lines.length)
    await tx.insert(billLines).values(b.lines.map((l, i) => ({ billId, position: i + 1, ...l })));
  if (b.taxes.length)
    await tx.insert(billTaxes).values(b.taxes.map((t, i) => ({ billId, position: i + 1, ...t })));
}

/**
 * One bill per vendor and number, however many documents speak about it. A
 * new reading replaces the bill when it is a re-read of the same document or
 * fixes one held for review; agrees and fills gaps (and brings more lines or
 * taxes) when totals match; holds the bill for review when totals differ.
 */
async function saveBill(
  tx: Tx,
  b: CheckedBill,
  documentId: number,
  vendor: { id: number; accountId: number },
  runId: string | null,
): Promise<Saved> {
  const review = b.reasons.length ? "needs_review" : "ok";
  const [existing] = await tx
    .select()
    .from(bills)
    .where(and(eq(bills.vendorId, vendor.id), eq(bills.number, b.number)));
  if (!existing) {
    const [row] = await tx
      .insert(bills)
      .values({
        vendorId: vendor.id,
        number: b.number,
        ...detailColumns(b),
        accountId: vendor.accountId,
        review,
        reviewReasons: b.reasons,
        documentId,
        runId,
      })
      .returning({ id: bills.id });
    if (!row) throw new Error(`bill ${b.number}: insert returned nothing`);
    await writeLinesAndTaxes(tx, row.id, b);
    return { id: row.id, saved: "new", review };
  }
  const id = existing.id;
  const reread = existing.documentId === documentId;
  if (
    existing.review !== "personal" &&
    (reread || (existing.review === "needs_review" && review === "ok"))
  ) {
    await tx
      .update(bills)
      .set({
        ...detailColumns(b),
        review,
        reviewReasons: b.reasons,
        documentId,
        runId,
        updatedAt: new Date(),
      })
      .where(eq(bills.id, id));
    await writeLinesAndTaxes(tx, id, b);
    return { id, saved: "replaced", review };
  }
  if (review !== "ok" || existing.review === "personal")
    return { id, saved: "kept", review: existing.review };
  if (existing.totalCents !== b.totalCents || existing.currency !== b.currency) {
    const reason = `document ${documentId} prints a total of ${formatMoney(b.totalCents, b.currency)}`;
    const reviewReasons = [...existing.reviewReasons.filter((r) => r !== reason), reason];
    await tx
      .update(bills)
      .set({ review: "needs_review", reviewReasons, updatedAt: new Date() })
      .where(eq(bills.id, id));
    return { id, saved: "conflict", review: "needs_review" };
  }
  const [lines] = await tx.select({ n: count() }).from(billLines).where(eq(billLines.billId, id));
  const [taxes] = await tx.select({ n: count() }).from(billTaxes).where(eq(billTaxes.billId, id));
  const richer = b.lines.length > (lines?.n ?? 0) || b.taxes.length > (taxes?.n ?? 0);
  const gaps = Object.fromEntries(
    Object.entries(detailColumns(b)).filter(
      ([k, v]) => v !== null && existing[k as keyof typeof existing] === null,
    ),
  );
  if (richer) {
    gaps.subtotalCents = b.subtotalCents;
    gaps.taxCents = b.taxCents;
    await writeLinesAndTaxes(tx, id, b);
  }
  if (!Object.keys(gaps).length) return { id, saved: "kept", review: existing.review };
  await tx
    .update(bills)
    .set({ ...(gaps as Partial<typeof bills.$inferInsert>), updatedAt: new Date() })
    .where(eq(bills.id, id));
  return { id, saved: "enriched", review: existing.review };
}

/** Payments read before their bill find it by vendor and number; the payment's document joins the bill's. */
export async function linkPayments(db: Db | Tx): Promise<void> {
  await db.execute(
    sql`UPDATE ${billPayments} p SET bill_id = b.id FROM ${bills} b WHERE p.bill_id IS NULL AND b.vendor_id = p.vendor_id AND b.number = p.invoice_number`,
  );
  await db.execute(
    sql`INSERT INTO ${billDocuments} (bill_id, document_id) SELECT bill_id, document_id FROM ${billPayments} WHERE bill_id IS NOT NULL ON CONFLICT DO NOTHING`,
  );
}

/** Your call on a bill: `accepted` posts it as read, `personal` keeps it out of the books. */
export async function setReview(
  db: Db,
  billId: number,
  review: "accepted" | "personal",
): Promise<Bill | undefined> {
  const [row] = await db
    .update(bills)
    .set({ review, updatedAt: new Date() })
    .where(eq(bills.id, billId))
    .returning();
  return row;
}

/** Documents (emails, with their PDFs) that are not billing: kept, never asked about again. */
export async function dismissDocuments(db: Db, ids: readonly number[]): Promise<number> {
  const rows = await db
    .update(documents)
    .set({ kind: "other", readAt: sql`coalesce(${documents.readAt}, now())` })
    .where(or(inArray(documents.id, [...ids]), inArray(documents.parentId, [...ids])))
    .returning({ id: documents.id });
  return rows.length;
}

/** Say which vendor sent documents no sender rule matched, so they can be read. */
export async function assignVendor(
  db: Db,
  ids: readonly number[],
  vendorKey: string,
): Promise<number> {
  const [vendor] = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(eq(vendors.key, vendorKey));
  if (!vendor) throw new Error(`no vendor ${vendorKey}`);
  const rows = await db
    .update(documents)
    .set({ vendorId: vendor.id })
    .where(or(inArray(documents.id, [...ids]), inArray(documents.parentId, [...ids])))
    .returning({ id: documents.id });
  return rows.length;
}
