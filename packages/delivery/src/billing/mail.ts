/**
 * An invoice out the door (designs/2026-10-15-wise-billing.md): its PDF, drawn by
 * `@wren/documents`, mailed from portal@ to the client's owners with how to pay by bank transfer.
 * Marked mailed once every owner's send went; a failed one is tried again next pass.
 */
import { clientMembers, clients } from "@wren/core/clients";
import { errorText } from "@wren/core/restate";
import type { Db } from "@wren/db";
import { invoicePdf } from "@wren/documents/pdf";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { amount, WREN_PARTY } from "../contract.js";
import { engagements, type Invoice, invoices } from "../schema.js";
import type { PortalMail } from "../watch.js";
import { payFields, type ReceiveDetails } from "./receive.js";

/** The PDF's file name. */
export const pdfName = (i: Pick<Invoice, "number">) => `${i.number}.pdf`;

/** The invoice's PDF bytes, with how to pay it. */
export function invoiceFile(
  i: Pick<
    Invoice,
    "number" | "issuedOn" | "dueOn" | "currency" | "cents" | "lines" | "description"
  >,
  clientName: string,
  receive: ReceiveDetails,
): Promise<Uint8Array> {
  const lines = i.lines.length ? i.lines : [{ what: i.description, cents: i.cents }];
  return invoicePdf({
    number: i.number,
    issuedOn: i.issuedOn,
    dueOn: i.dueOn,
    currency: i.currency,
    from: { name: WREN_PARTY.name, place: WREN_PARTY.place, email: WREN_PARTY.email },
    to: clientName,
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
): Promise<MailStats & { sent: { number: string; client: string }[] }> {
  const stats = { mailed: 0, failed: 0, lastError: null as string | null };
  const sent: { number: string; client: string }[] = [];
  const due = await main
    .select({ i: invoices, clientId: clients.id, clientName: clients.name })
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
  for (const { i, clientId, clientName } of due) {
    const owners = await main
      .select({ email: clientMembers.email })
      .from(clientMembers)
      .where(and(eq(clientMembers.clientId, clientId), eq(clientMembers.role, "owner")));
    if (owners.length === 0) continue;
    const content = await invoiceFile(i, clientName, receive);
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
