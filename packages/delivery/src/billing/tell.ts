/**
 * Our invoices as the executor hears them (`trigger.payment`, source `invoice`): issued, paid,
 * refunded, past due. Each change is told once ever, claimed under a token in `invoices.told`,
 * as pay links do. History is seeded as told, so only changes after that fire. Nothing here
 * sends: BillingWatch passes the result to `Executor/fire`.
 */
import { clientMembers, clients } from "@wren/core/clients";
import type { Fired } from "@wren/core/executor";
import { atomic, type Db } from "@wren/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  engagements,
  INVOICE_CHANGES,
  type Invoice,
  type InvoiceChange,
  invoices,
} from "../schema.js";
import { billToOf } from "./mail.js";

/** The changes an invoice has reached by `today` (`YYYY-MM-DD`). A void one reached none. */
export function invoiceReached(
  i: Pick<Invoice, "status" | "refundedCents" | "dueOn">,
  today: string,
): InvoiceChange[] {
  if (i.status === "void") return [];
  const out: InvoiceChange[] = ["invoiced"];
  if (i.status === "paid") out.push("paid");
  if (i.refundedCents > 0) out.push("refunded");
  if (i.status === "open" && i.dueOn < today) out.push("late");
  return out;
}

/** The invoice's change as the executor hears it. `email` and `name` name the billing person. */
export function invoiceFired(
  i: Invoice,
  change: InvoiceChange,
  who: { client: string; name: string; email: string | null },
): Fired {
  return {
    client: null,
    facts: { trigger: "trigger.payment", change },
    about: who.email ? [who.email] : [],
    event: {
      subject: `payment:invoice:${i.number}:${change}`,
      kind: "invoice",
      data: {
        source: "invoice",
        id: i.number,
        change,
        description: i.description,
        amount_cents: i.receivedCents > 0 ? i.receivedCents : i.cents,
        refunded_cents: i.refundedCents,
        currency: i.currency,
        setup: i.setup,
        client_id: who.client,
        name: who.name,
        ...(who.email ? { email: who.email } : {}),
      },
    },
  };
}

/** The latest rows to look at in a pass; the rest wait for the next. */
const MOST = 200;

/**
 * The changes no workflow has heard yet, claimed under `token` and built as events. A retry with
 * the same token gets the same ones back. The demo's invoices tell nothing.
 */
export async function claimInvoiceChanges(db: Db, token: string, today: string): Promise<Fired[]> {
  return atomic(db, async (tx) => {
    const found = await tx
      .select({
        id: invoices.id,
        clientId: clients.id,
        clientName: clients.name,
        products: clients.products,
      })
      .from(invoices)
      .innerJoin(engagements, eq(engagements.id, invoices.engagementId))
      .innerJoin(clients, eq(clients.id, engagements.clientId))
      .where(
        and(
          eq(clients.demo, false),
          sql`${invoices.status} <> 'void'`,
          sql`(not ${invoices.told} ? 'invoiced'
            or (${invoices.status} = 'paid' and not ${invoices.told} ? 'paid')
            or (${invoices.refundedCents} > 0 and not ${invoices.told} ? 'refunded')
            or (${invoices.status} = 'open' and ${invoices.dueOn} < ${today}
              and not ${invoices.told} ? 'late')
            or exists (select 1 from jsonb_each_text(${invoices.told}) t where t.value = ${token}))`,
        ),
      )
      .orderBy(asc(invoices.id))
      .limit(MOST);
    // Lock the invoices alone: a join lock would also hold the client rows.
    const locked = found.length
      ? await tx
          .select()
          .from(invoices)
          .where(
            inArray(
              invoices.id,
              found.map((f) => f.id),
            ),
          )
          .for("update")
      : [];
    const byId = new Map(locked.map((i) => [i.id, i]));
    const out: Fired[] = [];
    for (const { id, clientId, clientName, products } of found) {
      const i = byId.get(id);
      if (!i) continue;
      const told = { ...i.told };
      let more = false;
      for (const c of invoiceReached(i, today))
        if (!told[c]) {
          told[c] = token;
          more = true;
        }
      if (more) await tx.update(invoices).set({ told }).where(eq(invoices.id, i.id));
      const mine = INVOICE_CHANGES.filter((c) => told[c] === token);
      if (!mine.length) continue;
      const bill = billToOf({ name: clientName, products }).email;
      const [owner] = bill
        ? []
        : await tx
            .select({ email: clientMembers.email })
            .from(clientMembers)
            .where(and(eq(clientMembers.clientId, clientId), eq(clientMembers.role, "owner")))
            .orderBy(asc(clientMembers.invitedAt), asc(clientMembers.email))
            .limit(1);
      const who = { client: clientId, name: clientName, email: bill ?? owner?.email ?? null };
      for (const c of mine) out.push(invoiceFired({ ...i, told }, c, who));
    }
    return out;
  });
}
