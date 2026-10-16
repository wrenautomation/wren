/**
 * Credits on record (designs/2026-10-15-wise-billing.md): each Wise transaction stored once by
 * its id, matched or set to wait on William, and the by-hand match and dismiss. Applying a credit
 * adds to the invoice's `received_cents`; covered, the invoice is paid on the credit's day, which
 * runs the setup gate like any other paid invoice.
 */
import { clients } from "@wren/core/clients";
import { PortalRefusal } from "@wren/core/refusal";
import { type Queryable, serializable, setAuditActor } from "@wren/db";
import { and, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { markInvoice } from "../index.js";
import {
  type CreditStatus,
  engagements,
  type Invoice,
  invoices,
  type WiseCredit,
  wiseCredits,
} from "../schema.js";
import { dueOf, type InvoiceFacts, type Match, matchCredit } from "./match.js";
import type { CreditIn } from "./wise.js";

const missing = (what: string) => new PortalRefusal(`no such ${what}`, 404);
const clash = (what: string) => new PortalRefusal(what, 409);

/** Every invoice a credit could pay, with its client's name; the demo's aside. */
export async function invoiceFacts(
  db: Queryable,
): Promise<(InvoiceFacts & { clientId: string })[]> {
  const rows = await db
    .select({ i: invoices, clientId: clients.id, clientName: clients.name })
    .from(invoices)
    .innerJoin(engagements, eq(engagements.id, invoices.engagementId))
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .where(eq(clients.demo, false));
  return rows.map(({ i, clientId, clientName }) => ({
    id: i.id,
    number: i.number,
    currency: i.currency,
    cents: i.cents,
    receivedCents: i.receivedCents,
    status: i.status,
    clientName,
    clientId,
  }));
}

/** What one stored credit did, for the pass's notices. */
export interface Taken {
  credit: WiseCredit;
  match: Match;
  /** The invoice it paid toward or waits beside, with its client. */
  invoice: (Invoice & { clientId: string; clientName: string }) | null;
}

async function invoiceWithClient(db: Queryable, id: number | null) {
  if (id === null) return null;
  const [r] = await db
    .select({ i: invoices, clientId: clients.id, clientName: clients.name })
    .from(invoices)
    .innerJoin(engagements, eq(engagements.id, invoices.engagementId))
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .where(eq(invoices.id, id));
  return r ? { ...r.i, clientId: r.clientId, clientName: r.clientName } : null;
}

/** Adds `cents` to the invoice; covered, it's paid on `on`. The caller holds the transaction. */
async function apply(db: Queryable, invoiceId: number, cents: number, on: string) {
  const [i] = await db
    .update(invoices)
    .set({ receivedCents: sql`${invoices.receivedCents} + ${cents}` })
    .where(eq(invoices.id, invoiceId))
    .returning();
  if (!i) throw missing("invoice");
  if (i.status === "open" && i.receivedCents >= i.cents) {
    const [e] = await db
      .select({ clientId: engagements.clientId })
      .from(engagements)
      .where(eq(engagements.id, i.engagementId));
    if (e) await markInvoice(db, e.clientId, i.number, "paid", on);
  }
}

/**
 * Stores each credit not seen before and decides it: matched ones are applied, the rest wait.
 * A credit already stored is skipped, so reading the same window twice adds nothing.
 */
export async function takeCredits(db: Queryable, credits: readonly CreditIn[]): Promise<Taken[]> {
  const out: Taken[] = [];
  if (credits.length === 0) return out;
  const seen = new Set(
    (
      await db
        .select({ id: wiseCredits.wiseId })
        .from(wiseCredits)
        .where(
          inArray(
            wiseCredits.wiseId,
            credits.map((c) => c.wiseId),
          ),
        )
    ).map((r) => r.id),
  );
  for (const c of credits) {
    if (seen.has(c.wiseId)) continue;
    seen.add(c.wiseId);
    const taken = await serializable(db, async (tx) => {
      const match = matchCredit(c, await invoiceFacts(tx));
      const [row] = await tx
        .insert(wiseCredits)
        .values({
          wiseId: c.wiseId,
          balanceId: c.balanceId,
          currency: c.currency,
          cents: c.cents,
          feeCents: c.feeCents,
          at: c.at,
          kind: c.kind,
          payer: c.payer,
          memo: c.memo,
          description: c.description,
          status: match.status,
          invoiceId: match.invoiceId,
          why: match.why,
          decidedBy: match.status === "review" ? null : "billing-watch",
          decidedAt: match.status === "review" ? null : new Date(),
          raw: c.raw,
        })
        .onConflictDoNothing({ target: wiseCredits.wiseId })
        .returning();
      if (!row) return null;
      if (match.status === "matched")
        await apply(tx, match.invoiceId, match.cents, c.at.toISOString().slice(0, 10));
      return { credit: row, match, invoice: await invoiceWithClient(tx, match.invoiceId) };
    });
    if (taken) out.push(taken);
  }
  return out;
}

async function creditById(db: Queryable, id: number): Promise<WiseCredit> {
  if (!Number.isSafeInteger(id) || id <= 0) throw missing(`credit ${id}`);
  const [c] = await db.select().from(wiseCredits).where(eq(wiseCredits.id, id)).for("update");
  if (!c) throw missing(`credit ${id}`);
  return c;
}

/**
 * A person puts a credit on an invoice: the whole of what was sent counts toward it. Refused
 * when the credit is on one already, the currencies differ, or the invoice isn't open.
 */
export async function matchByHand(
  db: Queryable,
  creditId: number,
  number: string,
  by: string,
): Promise<Taken> {
  return serializable(db, async (tx) => {
    await setAuditActor(tx, by);
    const c = await creditById(tx, creditId);
    if (c.status === "matched") throw clash(`credit ${c.id} is on an invoice already`);
    const [i] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.number, number.trim().toUpperCase()));
    if (!i) throw missing(`invoice '${number}'`);
    if (i.currency !== c.currency)
      throw new PortalRefusal(`credit ${c.id} is ${c.currency}, ${i.number} is ${i.currency}`, 400);
    if (i.status !== "open") throw clash(`${i.number} is ${i.status}`);
    const cents = c.cents + c.feeCents;
    const [row] = await tx
      .update(wiseCredits)
      .set({
        status: "matched",
        invoiceId: i.id,
        why: `by hand${cents === dueOf(i) ? "" : `: ${cents < dueOf(i) ? "partial" : "over"}`}`,
        decidedBy: by,
        decidedAt: new Date(),
      })
      .where(eq(wiseCredits.id, c.id))
      .returning();
    if (!row) throw missing(`credit ${c.id}`);
    await apply(tx, i.id, cents, c.at.toISOString().slice(0, 10));
    return {
      credit: row,
      match: { status: "matched", invoiceId: i.id, why: row.why ?? "by hand", cents },
      invoice: await invoiceWithClient(tx, i.id),
    };
  });
}

/** Set a waiting credit aside: not a client's payment, or settled another way. */
export async function dismissCredit(
  db: Queryable,
  creditId: number,
  by: string,
): Promise<WiseCredit> {
  return serializable(db, async (tx) => {
    await setAuditActor(tx, by);
    const c = await creditById(tx, creditId);
    if (c.status !== "review") throw clash(`credit ${c.id} is ${c.status}, not waiting`);
    const [row] = await tx
      .update(wiseCredits)
      .set({ status: "dismissed", decidedBy: by, decidedAt: new Date() })
      .where(eq(wiseCredits.id, c.id))
      .returning();
    if (!row) throw missing(`credit ${c.id}`);
    return row;
  });
}

/** A credit as the CLI and the portal list it: its invoice by number and client. */
export interface CreditView {
  id: number;
  at: string;
  status: CreditStatus;
  currency: string;
  cents: number;
  feeCents: number;
  kind: string;
  payer: string | null;
  memo: string | null;
  why: string | null;
  invoice: string | null;
  client: string | null;
  clientName: string | null;
  decidedBy: string | null;
}

/** What a list shows unless asked: our own moves (`ignored`) stay out. */
export const CREDIT_STATUSES_SHOWN = [
  "review",
  "matched",
  "dismissed",
] as const satisfies readonly CreditStatus[];

/** Newest first; `status` narrows, `ignored` ones only when asked for. */
export async function creditsList(
  db: Queryable,
  o: { status?: readonly CreditStatus[]; limit?: number } = {},
): Promise<CreditView[]> {
  const where: SQL | undefined = o.status?.length
    ? inArray(wiseCredits.status, [...o.status])
    : sql`${wiseCredits.status} <> 'ignored'`;
  const rows = await db
    .select({
      c: wiseCredits,
      number: invoices.number,
      client: clients.id,
      clientName: clients.name,
    })
    .from(wiseCredits)
    .leftJoin(invoices, eq(invoices.id, wiseCredits.invoiceId))
    .leftJoin(engagements, eq(engagements.id, invoices.engagementId))
    .leftJoin(clients, eq(clients.id, engagements.clientId))
    .where(and(where))
    .orderBy(desc(wiseCredits.at), desc(wiseCredits.id))
    .limit(Math.min(Math.max(o.limit ?? 50, 1), 500));
  return rows.map(({ c, number, client, clientName }) => ({
    id: c.id,
    at: c.at.toISOString(),
    status: c.status,
    currency: c.currency,
    cents: c.cents,
    feeCents: c.feeCents,
    kind: c.kind,
    payer: c.payer,
    memo: c.memo,
    why: c.why,
    invoice: number,
    client,
    clientName,
    decidedBy: c.decidedBy,
  }));
}
