/**
 * The reader's answer checked against the document it read. The model copies
 * text; everything it reports must be printed there, and the amounts must add
 * up. What fails is either dropped with a note (optional detail) or kept with
 * a review reason (anything that decides money). Pure: no database, no model.
 */
import { z } from "zod";
import { currencyOf, formatCents, mentionsCurrency, parseCents, printedCents } from "./money.js";
import type { BillCycle, DocumentKind } from "./schema.js";

const printed = z.union([z.string(), z.number()]).transform(String);
const text = z.string().nullish();

/** What the model answers: text as printed, dates as ISO days. Loose on purpose; `check` is strict. */
export const Reading = z.object({
  kind: text,
  bill: z
    .object({
      number: text,
      kind: text,
      issued_on: text,
      due_on: text,
      period_start: text,
      period_end: text,
      currency: text,
      lines: z
        .array(
          z.object({
            description: text,
            quantity: printed.nullish(),
            unit_price: printed.nullish(),
            amount: printed.nullish(),
            period_start: text,
            period_end: text,
          }),
        )
        .nullish(),
      subtotal: printed.nullish(),
      taxes: z
        .array(
          z.object({
            name: text,
            rate_percent: printed.nullish(),
            amount: printed.nullish(),
            tax_number: text,
          }),
        )
        .nullish(),
      total: printed.nullish(),
      charged_cad: printed.nullish(),
      payment_method: text,
      billed_to: text,
      vendor_tax_number: text,
      plan: text,
      cycle: text,
    })
    .nullish(),
  payments: z
    .array(
      z.object({
        invoice_number: text,
        paid_on: text,
        amount: printed.nullish(),
        currency: text,
        method: text,
        reference: text,
      }),
    )
    .nullish(),
});
export type Reading = z.infer<typeof Reading>;

/** What the reader saw: every text it was given, and when the email was sent. */
export interface Corpus {
  text: string;
  sentAt: Date | null;
}

/** What the books know about the vendor that sent it. */
export interface VendorFacts {
  name: string;
  currency: string | null;
  cycle: BillCycle | null;
  gstClaimable: boolean | null;
}

export interface CheckedLine {
  description: string;
  quantity: string | null;
  unitPrice: string | null;
  amountCents: number;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface CheckedTax {
  name: string;
  ratePercent: string | null;
  amountCents: number;
  claimable: boolean;
  taxNumber: string | null;
}

export interface CheckedBill {
  number: string;
  kind: "invoice" | "receipt" | "credit_note";
  issuedOn: string;
  dueOn: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  chargedCadCents: number | null;
  plan: string | null;
  cycle: BillCycle | null;
  paymentMethod: string | null;
  billedTo: string | null;
  vendorTaxNumber: string | null;
  lines: CheckedLine[];
  taxes: CheckedTax[];
  /** Why it cannot be posted as read; empty = ok. */
  reasons: string[];
}

export interface CheckedPayment {
  /** null = on account: no invoice number printed. */
  invoiceNumber: string | null;
  paidOn: string;
  amountCents: number;
  currency: string;
  method: string | null;
  reference: string | null;
  key: string;
}

export interface Checked {
  kind: DocumentKind;
  bill: CheckedBill | null;
  payments: CheckedPayment[];
  /** Detail dropped because it is not printed; kept in the document's reading. */
  notes: string[];
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** "Aug", "Sept", "August" → 8; null for any other word. */
function monthOf(word: string): number | null {
  const w = word.toLowerCase();
  if (w.length < 3) return null;
  const i = MONTHS.findIndex((m) => m.startsWith(w));
  return i < 0 ? null : i + 1;
}

/** `YYYY-MM-DD` when it names a real day. */
export function isDay(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Every day the text prints, as ISO days: 2026-08-08, 2026/08/08, 08/08/2026
 * (both ways round), Aug 8, 2026, August 8th 2026, 8 Aug 2026.
 */
export function printedDays(text: string): Set<string> {
  const days = new Set<string>();
  const add = (y: number, m: number | null, d: number) => {
    if (m === null) return;
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (isDay(iso)) days.add(iso);
  };
  for (const m of text.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g))
    add(Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/g)) {
    add(Number(m[3]), Number(m[1]), Number(m[2]));
    add(Number(m[3]), Number(m[2]), Number(m[1]));
  }
  for (const m of text.matchAll(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi))
    add(Number(m[3]), monthOf(m[1] as string), Number(m[2]));
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\.?\s+([a-z]{3,9})\.?,?\s+(\d{4})\b/gi))
    add(Number(m[3]), monthOf(m[2] as string), Number(m[1]));
  return days;
}

/** The days an email was sent, where its sender and its reader may each be. */
function sentDays(sentAt: Date | null): string[] {
  if (!sentAt) return [];
  const zones = ["UTC", "America/Los_Angeles", "America/Toronto"];
  return zones.map((timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(sentAt));
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const clean = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);
/** "#INV-12" → "INV-12". */
export const invoiceNumber = (s: string) => s.trim().replace(/^#\s*/, "");

const CYCLES: ReadonlyArray<[RegExp, BillCycle]> = [
  [/month/i, "monthly"],
  [/year|annual/i, "yearly"],
  [/usage|metered|pay.as.you.go|prepa/i, "usage"],
  [/once|one.time|single/i, "once"],
];
const cycleOf = (s: string | null | undefined) =>
  s ? (CYCLES.find(([re]) => re.test(s))?.[1] ?? null) : null;

/** A printed service period of about a month or a year says how often it bills. */
function periodCycle(start: string | null, end: string | null): BillCycle | null {
  if (!start || !end) return null;
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  if (days >= 27 && days <= 31) return "monthly";
  if (days >= 364 && days <= 366) return "yearly";
  return null;
}

const billKindOf = (s: string | null | undefined): CheckedBill["kind"] =>
  /credit/i.test(s ?? "") ? "credit_note" : /receipt/i.test(s ?? "") ? "receipt" : "invoice";

const KINDS: readonly DocumentKind[] = ["bill", "payment", "notice", "other"];
const docKindOf = (s: string | null | undefined): DocumentKind =>
  KINDS.find((k) => k === s?.trim().toLowerCase()) ?? "other";

/** ISO 4217's "no currency": a bill that prints none, held for review. */
export const UNKNOWN_CURRENCY = "XXX";

/** GST/HST by name, in English or French. Other taxes (US sales tax) are never claimable. */
const GST_HST = /\b(gst|hst|tps|tvh)\b/i;
/** A Canadian business number's GST/HST account: 123456789 RT0001. */
const GST_NUMBER = /\b\d{9}\s*RT\s*\d{4}\b/i;

/**
 * Check a reading against its corpus. Amounts, numbers and days must be
 * printed; lines must add to the subtotal and subtotal plus tax to the total,
 * each within a cent.
 */
export function check(reading: Reading, corpus: Corpus, vendor: VendorFacts): Checked {
  const notes: string[] = [];
  const said = squash(corpus.text);
  const isPrinted = (value: string) => said.includes(squash(value));
  const numbers = printedCents(corpus.text);
  const days = printedDays(corpus.text);
  const headerDays = sentDays(corpus.sentAt);
  const dayPrinted = (day: string) => days.has(day) || headerDays.includes(day);

  /** A printed amount in cents; its trouble goes to `problems`. */
  const amount = (value: string | null | undefined, label: string, problems: string[]) => {
    if (value == null || !value.trim()) return null;
    const cents = parseCents(value);
    if (cents === null) {
      problems.push(`${label} "${value}" is not an amount`);
      return null;
    }
    if (!numbers.has(Math.abs(cents))) problems.push(`${label} ${value} is not printed`);
    return cents;
  };
  /** A day the document prints, else null with a note. */
  const optionalDay = (value: string | null | undefined, label: string) => {
    if (!value) return null;
    if (isDay(value) && dayPrinted(value)) return value;
    notes.push(`${label} ${value} dropped: not printed`);
    return null;
  };
  const currencyCode = (value: string | null | undefined) => {
    const code = value?.trim().toUpperCase();
    return code &&
      /^[A-Z]{3}$/.test(code) &&
      (mentionsCurrency(corpus.text, code) || isPrinted(code))
      ? code
      : null;
  };

  function checkBill(b: NonNullable<Reading["bill"]>): CheckedBill | null {
    const reasons: string[] = [];
    const total = amount(b.total, "total", reasons);
    if (total === null) {
      notes.push("bill dropped: no total");
      return null;
    }
    let number = invoiceNumber(b.number ?? "");
    if (!number) reasons.push("no invoice number");
    else if (!isPrinted(number)) reasons.push(`number "${number}" is not printed`);
    if (!number) number = `sent ${corpus.sentAt?.toISOString() ?? "unknown"}`;

    const dueOn = optionalDay(b.due_on, "due date");
    let issuedOn = b.issued_on?.trim() ?? "";
    const standIn = dueOn ?? headerDays[0];
    if (!issuedOn && standIn) {
      // Some bills print none (Cloudflare's email gives a due date and an amount).
      issuedOn = standIn;
      notes.push(`no issue date printed: the ${dueOn ? "due date" : "day it was sent"} stands in`);
    } else if (!isDay(issuedOn)) {
      reasons.push(`issue date "${issuedOn}" is not a date`);
      issuedOn = headerDays[0] ?? new Date().toISOString().slice(0, 10);
    } else if (!dayPrinted(issuedOn)) reasons.push(`issue date ${issuedOn} is not printed`);

    let periodStart = optionalDay(b.period_start, "period start");
    let periodEnd = optionalDay(b.period_end, "period end");
    if (!periodStart || !periodEnd) periodStart = periodEnd = null;

    const lines: CheckedLine[] = [];
    for (const [i, l] of (b.lines ?? []).entries()) {
      const cents = amount(l.amount, `line ${i + 1}`, reasons);
      if (cents === null) continue;
      lines.push({
        description: clean(l.description) ?? `line ${i + 1}`,
        quantity: clean(l.quantity),
        unitPrice: clean(l.unit_price),
        amountCents: cents,
        periodStart: optionalDay(l.period_start, `line ${i + 1} start`),
        periodEnd: optionalDay(l.period_end, `line ${i + 1} end`),
      });
    }
    const vendorTaxNumber = clean(b.vendor_tax_number);
    const taxes: CheckedTax[] = [];
    for (const [i, t] of (b.taxes ?? []).entries()) {
      const name = clean(t.name) ?? `tax ${i + 1}`;
      const cents = amount(t.amount, name, reasons);
      if (cents === null) continue;
      const taxNumber = clean(t.tax_number);
      const gst = GST_HST.test(name);
      taxes.push({
        name,
        ratePercent: /(\d+(?:\.\d{1,4})?)/.exec(t.rate_percent ?? "")?.[1] ?? null,
        amountCents: cents,
        // A simplified-regime vendor's GST is never claimable; an unknown vendor's is when it prints its GST/HST number.
        claimable:
          gst &&
          (vendor.gstClaimable ??
            (GST_NUMBER.test(taxNumber ?? "") || GST_NUMBER.test(vendorTaxNumber ?? ""))),
        taxNumber,
      });
    }

    const lineSum = lines.reduce((s, l) => s + l.amountCents, 0);
    const taxSum = taxes.reduce((s, t) => s + t.amountCents, 0);
    const subtotal =
      amount(b.subtotal, "subtotal", reasons) ?? (lines.length ? lineSum : total - taxSum);
    if (lines.length && Math.abs(lineSum - subtotal) > 1)
      reasons.push(`lines add to ${formatCents(lineSum)}, subtotal is ${formatCents(subtotal)}`);
    if (Math.abs(subtotal + taxSum - total) > 1)
      reasons.push(
        `subtotal ${formatCents(subtotal)} plus tax ${formatCents(taxSum)} is not the total ${formatCents(total)}`,
      );

    let currency = currencyOf(b.total ?? "") ?? currencyCode(b.currency) ?? vendor.currency;
    if (!currency) {
      reasons.push("no currency printed");
      currency = UNKNOWN_CURRENCY;
    }
    let chargedCad: number | null = null;
    if (currency !== "CAD" && b.charged_cad) {
      const problems: string[] = [];
      chargedCad = amount(b.charged_cad, "charged CAD", problems);
      if (problems.length) {
        notes.push(`charged CAD dropped: ${problems.join("; ")}`);
        chargedCad = null;
      }
    }

    // A credit note takes money back: its amounts are negative however they are printed.
    const kind = billKindOf(b.kind);
    const flip = kind === "credit_note" && total > 0 ? -1 : 1;
    return {
      number,
      kind,
      issuedOn,
      dueOn,
      periodStart,
      periodEnd,
      currency,
      subtotalCents: subtotal * flip,
      taxCents: taxSum * flip,
      totalCents: total * flip,
      chargedCadCents: chargedCad === null ? null : Math.abs(chargedCad) * Math.sign(total * flip),
      plan: clean(b.plan),
      cycle: cycleOf(b.cycle) ?? periodCycle(periodStart, periodEnd) ?? vendor.cycle,
      paymentMethod: clean(b.payment_method),
      billedTo: clean(b.billed_to),
      vendorTaxNumber,
      lines: lines.map((l) => ({ ...l, amountCents: l.amountCents * flip })),
      taxes: taxes.map((t) => ({ ...t, amountCents: t.amountCents * flip })),
      reasons,
    };
  }

  const kind = docKindOf(reading.kind);
  const bill = reading.bill ? checkBill(reading.bill) : null;
  const payments: CheckedPayment[] = [];
  for (const p of reading.payments ?? []) {
    let number: string | null = invoiceNumber(p.invoice_number ?? "") || null;
    if (number && !isPrinted(number)) {
      notes.push(`invoice number "${number}" is not printed: payment kept on account`);
      number = null;
    }
    const problems: string[] = [];
    if (!isDay(p.paid_on) || !dayPrinted(p.paid_on))
      problems.push(`paid on ${p.paid_on} is not printed`);
    const cents = amount(p.amount, "amount", problems);
    if (cents === null && !problems.length) problems.push("no amount");
    const billCurrency = bill && bill.currency !== UNKNOWN_CURRENCY ? bill.currency : null;
    const currency =
      currencyOf(p.amount ?? "") ?? currencyCode(p.currency) ?? billCurrency ?? vendor.currency;
    if (!currency) problems.push("no currency printed");
    if (problems.length || cents === null || !currency || !isDay(p.paid_on)) {
      notes.push(
        `payment ${number ? `toward "${number}"` : "on account"} dropped: ${problems.join("; ")}`,
      );
      continue;
    }
    const reference = clean(p.reference);
    payments.push({
      invoiceNumber: number,
      paidOn: p.paid_on,
      amountCents: cents,
      currency,
      method: clean(p.method),
      reference,
      key: reference ?? `${p.paid_on}:${cents}`,
    });
  }
  // A "bill" none of which survived stays a bill: review lists it as one that gave nothing.
  return { kind: bill ? "bill" : kind, bill, payments, notes };
}
