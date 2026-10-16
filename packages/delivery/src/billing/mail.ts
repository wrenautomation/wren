/**
 * An invoice out the door (designs/2026-10-15-wise-billing.md): its PDF, drawn by
 * `@wren/documents`, mailed from portal@ to the client's owners with how to pay by bank transfer.
 * Marked mailed once every owner's send went; a failed one is tried again next pass.
 */
import { clientMembers, clients } from "@wren/core/clients";
import { errorText } from "@wren/core/restate";
import type { Db, Queryable } from "@wren/db";
import { invoicePdf } from "@wren/documents/pdf";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { amount, WREN_PARTY } from "../contract.js";
import { engagements, type Invoice, invoices } from "../schema.js";
import type { PortalMail } from "../watch.js";
import { payFields, type ReceiveDetails } from "./receive.js";

/** Who an invoice is billed to: the client's `delivery.invoices` block, `billTo`. */
export interface BillTo {
  name?: string;
  address?: string[];
  email?: string;
  taxNumber?: string;
}

const textOr = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Bill-to details from untrusted JSON: trimmed text only, empty fields dropped. */
export function parseBillTo(raw: unknown): BillTo {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const address = Array.isArray(b.address)
    ? b.address.map(textOr).filter((l): l is string => l !== undefined)
    : [];
  const name = textOr(b.name);
  const email = textOr(b.email);
  const taxNumber = textOr(b.taxNumber);
  return {
    ...(name ? { name } : {}),
    ...(address.length ? { address } : {}),
    ...(email ? { email } : {}),
    ...(taxNumber ? { taxNumber } : {}),
  };
}

/** The client's bill-to details; the name falls back to the client's own. */
export function billToOf(c: {
  name: string;
  products: Record<string, unknown>;
}): BillTo & { name: string } {
  const block = c.products["delivery.invoices"];
  const b = parseBillTo(
    block && typeof block === "object" ? (block as { billTo?: unknown }).billTo : null,
  );
  return { ...b, name: b.name ?? c.name };
}

/** Changes the client's bill-to details: the fields given replace theirs, the rest stay. */
export async function setBillTo(
  db: Queryable,
  clientId: string,
  change: BillTo,
): Promise<BillTo & { name: string }> {
  const patch = JSON.stringify(parseBillTo(change));
  const [row] = await db
    .update(clients)
    .set({
      products: sql`jsonb_set(${clients.products}, '{delivery.invoices}', coalesce(${clients.products} -> 'delivery.invoices', '{}'::jsonb) || jsonb_build_object('billTo', coalesce(${clients.products} #> '{delivery.invoices,billTo}', '{}'::jsonb) || ${patch}::jsonb))`,
    })
    .where(eq(clients.id, clientId))
    .returning({ name: clients.name, products: clients.products });
  if (!row) throw new Error(`no client ${clientId}`);
  return billToOf(row);
}

/** The PDF's file name. */
export const pdfName = (i: Pick<Invoice, "number">) => `${i.number}.pdf`;

/** The invoice's PDF bytes, with how to pay it. */
export function invoiceFile(
  i: Pick<
    Invoice,
    "number" | "issuedOn" | "dueOn" | "currency" | "cents" | "lines" | "description"
  >,
  to: BillTo & { name: string },
  receive: ReceiveDetails,
  /** Our GST/HST registration (`WREN_TAX_NUMBER`), printed under our name. */
  taxNumber?: string,
): Promise<Uint8Array> {
  const lines = i.lines.length ? i.lines : [{ what: i.description, cents: i.cents }];
  return invoicePdf({
    number: i.number,
    issuedOn: i.issuedOn,
    dueOn: i.dueOn,
    currency: i.currency,
    from: {
      name: WREN_PARTY.name,
      place: WREN_PARTY.place,
      email: WREN_PARTY.email,
      ...(taxNumber ? { taxNumber } : {}),
    },
    to,
    lines: lines.map((l) => ({ what: l.what, amount: amount(l.cents, i.currency) })),
    total: amount(i.cents, i.currency),
    reference: i.number,
    pay: payFields(receive, i.currency),
  });
}

/** The mail's words: what's owed, by when, and the bank details to send it to. */
export function invoiceText(
  i: Pick<Invoice, "number" | "dueOn" | "currency" | "cents" | "description">,
  clientId: string,
  receive: ReceiveDetails,
  app: string,
): string {
  const pay = payFields(receive, i.currency);
  return [
    `Invoice ${i.number} for ${amount(i.cents, i.currency)} is attached. It's due ${i.dueOn}.`,
    i.description,
    "",
    "Pay by bank transfer:",
    `Reference (put it in the memo): ${i.number}`,
    ...(pay.length
      ? pay.map(([label, value]) => `${label}: ${value}`)
      : [`Reply to this email for the bank details in ${i.currency}.`]),
    "",
    `Your invoices: ${app}/account/billing?client=${clientId}`,
  ].join("\n");
}

export interface MailStats {
  mailed: number;
  failed: number;
  lastError: string | null;
}

/** Every open invoice not mailed yet, to each owner of its client; the demo's never. */
export async function mailInvoices(
  main: Db,
  send: (m: PortalMail) => Promise<void>,
  receive: ReceiveDetails,
  app: string,
  now: Date,
  taxNumber?: string,
): Promise<MailStats & { sent: { number: string; client: string }[] }> {
  const stats = { mailed: 0, failed: 0, lastError: null as string | null };
  const sent: { number: string; client: string }[] = [];
  const due = await main
    .select({
      i: invoices,
      clientId: clients.id,
      clientName: clients.name,
      products: clients.products,
    })
    .from(invoices)
    .innerJoin(engagements, eq(engagements.id, invoices.engagementId))
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .where(
      and(
        eq(invoices.status, "open"),
        isNull(invoices.mailedAt),
        eq(clients.demo, false),
        sql`${clients.products} ? 'delivery.invoices'`,
      ),
    )
    .orderBy(asc(invoices.id));
  for (const { i, clientId, clientName, products } of due) {
    const owners = await main
      .select({ email: clientMembers.email })
      .from(clientMembers)
      .where(and(eq(clientMembers.clientId, clientId), eq(clientMembers.role, "owner")));
    if (owners.length === 0) continue;
    const to = billToOf({ name: clientName, products });
    const content = await invoiceFile(i, to, receive, taxNumber);
    const text = invoiceText(i, clientId, receive, app);
    let ok = true;
    for (const { email } of owners) {
      try {
        await send({
          to: email,
          subject: `${clientName}: invoice ${i.number} from Wren`,
          text,
          attachments: [{ filename: pdfName(i), contentType: "application/pdf", content }],
        });
      } catch (err) {
        ok = false;
        stats.failed += 1;
        stats.lastError = errorText(err);
      }
    }
    if (!ok) continue;
    await main.update(invoices).set({ mailedAt: now }).where(eq(invoices.id, i.id));
    stats.mailed += 1;
    sent.push({ number: i.number, client: clientName });
  }
  return { ...stats, sent };
}
