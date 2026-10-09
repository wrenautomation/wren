/**
 * The pure half of documents: kinds, line math, totals and slots. No imports, so the portal's
 * editor shows the same totals the server keeps.
 */
export const DOC_KINDS = ["contract", "proposal", "estimate"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** One line item. Cents and a tax percent the client types; totals are the server's. */
export interface DocLine {
  name: string;
  detail?: string | null;
  qty: number;
  unit_cents: number;
  tax_pct?: number | null;
}

export const KIND_PREFIX: Record<DocKind, string> = {
  contract: "DOC",
  proposal: "PRO",
  estimate: "EST",
};
export const KIND_NAME: Record<DocKind, string> = {
  contract: "Contract",
  proposal: "Proposal",
  estimate: "Estimate",
};
/** The signer's button: a contract is signed, a price accepted. */
export const SIGN_LABEL: Record<DocKind, string> = {
  contract: "Sign",
  proposal: "Accept and sign",
  estimate: "Accept and sign",
};

/** Cents as a person reads them: "$1,200.00". */
export const money = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );

/** One line's amount and tax, each rounded to the cent. */
export const lineAmount = (l: DocLine) => Math.round(l.qty * l.unit_cents);
export const lineTax = (l: DocLine) => Math.round((lineAmount(l) * (l.tax_pct ?? 0)) / 100);

/** Totals, worked out here only: tax per line, rounded per line. */
export function totalsOf(lines: readonly DocLine[]) {
  const subtotalCents = lines.reduce((s, l) => s + lineAmount(l), 0);
  const taxCents = lines.reduce((s, l) => s + lineTax(l), 0);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

/** A deposit as a share of the total, the percent checked by the caller; none under $0.50. */
export function depositOf(total: number, pct: number | null | undefined): number | null {
  if (!pct) return null;
  const cents = Math.round((total * pct) / 100);
  return cents >= 50 ? cents : null;
}

// ---- Slots ----

/** `{contact.first_name}`, `{biz.phone}`, `{field.size}`: names only, no expressions. */
const SLOT = /\{([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)\}/g;

/** Fill each slot that has a value; the rest stay as they are, for `slotsLeft` to name. */
export function fillSlots(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(SLOT, (whole, key: string) =>
    Object.hasOwn(values, key) && values[key] ? (values[key] as string) : whole,
  );
}

/** The slots with no value yet, once each, in order. */
export function slotsLeft(...texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(SLOT)) out.add(`{${m[1]}}`);
  return [...out];
}

/** The slots a document's words may use, as the editor's picker lists them. */
export const SLOT_NAMES = {
  "contact.name": "Their full name",
  "contact.first_name": "Their first name",
  "contact.email": "Their email",
  "biz.name": "Your business name",
  "biz.phone": "Your phone (a business fact)",
  "biz.email": "Your email (a business fact)",
  "doc.number": "The document's number",
  "doc.total": "The total",
  "doc.deposit": "The deposit",
  "doc.expires": "The day it expires",
} as const;
