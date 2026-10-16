/**
 * Which invoice a credit pays (designs/2026-10-15-wise-billing.md, "Matching"): the invoice
 * number in the memo first, then the exact amount in the same currency from a payer named like
 * the client. Only a credit that covers what's due exactly is matched by itself; partial, over,
 * wrong currency and no match wait on a person with the likeliest invoice beside them.
 */
import { OWN_KINDS } from "./wise.js";

export interface CreditFacts {
  kind: string;
  currency: string;
  cents: number;
  feeCents: number;
  payer: string | null;
  memo: string | null;
  description: string | null;
}

export interface InvoiceFacts {
  id: number;
  number: string;
  currency: string;
  cents: number;
  receivedCents: number;
  status: "open" | "paid" | "void";
  clientName: string;
}

export type Match =
  | { status: "matched"; invoiceId: number; why: string; cents: number }
  | { status: "review"; invoiceId: number | null; why: string }
  | { status: "ignored"; invoiceId: null; why: string };

/** Every invoice number a memo names, as ours print: `WREN-1001`, also `wren 1001`, `WREN1001`. */
export function referencesIn(text: string): string[] {
  return [...text.matchAll(/WREN[\s\-_.#:]*(\d{3,9})(?!\d)/gi)].map((m) => `WREN-${Number(m[1])}`);
}

/** What's still owed on an invoice. */
export const dueOf = (i: Pick<InvoiceFacts, "cents" | "receivedCents">) =>
  Math.max(0, i.cents - i.receivedCents);

/** What a credit pays toward `due`: what landed if that's it exactly, else what was sent. */
export const paidToward = (c: Pick<CreditFacts, "cents" | "feeCents">, due: number) =>
  c.cents === due ? c.cents : c.cents + c.feeCents;

const exact = (c: CreditFacts, due: number) => c.cents === due || c.cents + c.feeCents === due;

const SUFFIX = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|the)\b/g;
/** A name for comparing: lower case, words only, no "Inc" or "LLC". */
export const nameKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
/** A payer named like the client: one name holds the other. */
export function samePayer(payer: string | null, client: string): boolean {
  if (!payer) return false;
  const a = nameKey(payer);
  const b = nameKey(client);
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
}

const money = (cents: number, currency: string) => `${currency} ${(cents / 100).toFixed(2)}`;

/** The decision for one credit against every invoice we could match it to. */
export function matchCredit(c: CreditFacts, invoices: readonly InvoiceFacts[]): Match {
  if (OWN_KINDS.has(c.kind)) return { status: "ignored", invoiceId: null, why: `own: ${c.kind}` };
  const sent = money(c.cents + c.feeCents, c.currency);
  const refs = referencesIn(`${c.memo ?? ""} ${c.description ?? ""}`);
  const named = refs
    .map((r) => invoices.find((i) => i.number === r))
    .filter((i): i is InvoiceFacts => i !== undefined);
  const byRef = named[0];
  if (byRef) {
    if (new Set(named.map((i) => i.id)).size > 1)
      return { status: "review", invoiceId: byRef.id, why: `names ${refs.join(", ")}` };
    if (byRef.currency !== c.currency)
      return {
        status: "review",
        invoiceId: byRef.id,
        why: `wrong currency: ${c.currency} for a ${byRef.currency} invoice`,
      };
    if (byRef.status !== "open")
      return { status: "review", invoiceId: byRef.id, why: `${byRef.number} is ${byRef.status}` };
    const due = dueOf(byRef);
    if (exact(c, due))
      return {
        status: "matched",
        invoiceId: byRef.id,
        why: "reference",
        cents: paidToward(c, due),
      };
    return {
      status: "review",
      invoiceId: byRef.id,
      why: `${c.cents + c.feeCents < due ? "partial" : "over"}: ${sent} of ${money(due, byRef.currency)} due`,
    };
  }
  const open = invoices.filter((i) => i.status === "open");
  const theirs = open.filter((i) => samePayer(c.payer, i.clientName));
  const sameCur = (i: InvoiceFacts) => i.currency === c.currency;
  const fits = open.filter((i) => sameCur(i) && exact(c, dueOf(i)));
  const both = fits.filter((i) => theirs.includes(i));
  const [one] = both;
  if (one && both.length === 1)
    return {
      status: "matched",
      invoiceId: one.id,
      why: "amount and payer",
      cents: paidToward(c, dueOf(one)),
    };
  if (both.length > 1)
    return { status: "review", invoiceId: null, why: `${both.length} invoices fit, no reference` };
  const [fit] = fits;
  if (fit && fits.length === 1)
    return { status: "review", invoiceId: fit.id, why: "amount fits, payer and memo don't" };
  const mine = theirs.filter(sameCur);
  const [likely] = mine;
  if (likely && mine.length === 1) {
    const due = dueOf(likely);
    return {
      status: "review",
      invoiceId: likely.id,
      why: `${c.cents + c.feeCents < due ? "partial" : "over"}: ${sent} of ${money(due, likely.currency)} due`,
    };
  }
  const [other] = theirs.filter((i) => !sameCur(i));
  if (other && mine.length === 0)
    return {
      status: "review",
      invoiceId: other.id,
      why: `wrong currency: ${c.currency} for a ${other.currency} invoice`,
    };
  return { status: "review", invoiceId: null, why: "no invoice fits" };
}
