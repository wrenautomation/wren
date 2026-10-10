/**
 * Pay links' reads and writes (designs/2026-10-07-forms-and-pay.md, "Text-to-pay"). Links and
 * events on the main database; a paid thread's mark on the owner's own (`markContactPaid`).
 */
import { smsContacts } from "@wren/channel-sms/schema";
import { clients } from "@wren/core/clients";
import { PortalRefusal } from "@wren/core/refusal";
import { atomic, type Db, type Queryable } from "@wren/db";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  type PayAccount,
  type PayChannel,
  type PayLink,
  payAccounts,
  payEvents,
  payLinks,
} from "./schema.js";
import { type PaidFacts, STRIPE_EVENTS } from "./stripe.js";

/** A refusal the person asking can act on, with its HTTP status. */
export class PayRefusal extends PortalRefusal {}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Stripe's least and most for one USD charge. */
export const MIN_CENTS = 50;
export const MAX_CENTS = 99_999_999;

/** "49", "49.5", "$1,200.00" as cents; refused past Stripe's bounds or with a third decimal. */
export function centsOf(amount: unknown): number {
  const s = String(amount ?? "")
    .trim()
    .replace(/^\$/, "")
    .replace(/,/g, "");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s))
    throw new PayRefusal("type the amount in dollars, as 49.00");
  const [whole, part = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(part.padEnd(2, "0"));
  if (cents < MIN_CENTS) throw new PayRefusal("Stripe takes $0.50 at least");
  if (cents > MAX_CENTS) throw new PayRefusal("that's more than Stripe takes in one payment");
  return cents;
}

/** Cents as a person reads them: "$1,200.00". */
export const money = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NewLink {
  client: string;
  channel: PayChannel;
  contact?: number | null;
  email?: string | null;
  name?: string | null;
  description: string;
  cents: number;
  quantity?: number;
  by: string;
  /** The maker may approve for this client: it goes on at once. */
  approved?: boolean;
  now: Date;
}

/** A new link: waiting on a yes, or approved and on its way (`sending`). */
export async function createLink(main: Db, l: NewLink): Promise<PayLink> {
  const description = l.description.trim().replace(/\s+/g, " ");
  if (!description) throw new PayRefusal("say what it's for");
  if (description.length > 200) throw new PayRefusal("keep what it's for under 200 characters");
  const quantity = l.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)
    throw new PayRefusal("quantity: 1 to 100");
  if (!Number.isInteger(l.cents) || l.cents < MIN_CENTS || l.cents > MAX_CENTS)
    throw new PayRefusal("that amount won't go through Stripe");
  const email = l.email?.trim().toLowerCase() || null;
  if (l.channel === "email" && (!email || !EMAIL.test(email)))
    throw new PayRefusal("an email needs an address");
  if (l.channel === "sms" && !(Number.isSafeInteger(l.contact) && (l.contact ?? 0) > 0))
    throw new PayRefusal("a text needs a thread");
  const [row] = await main
    .insert(payLinks)
    .values({
      client: l.client,
      channel: l.channel,
      contact: l.channel === "sms" ? (l.contact ?? null) : null,
      email,
      name: l.name?.trim().slice(0, 200) || null,
      description,
      amountCents: l.cents,
      quantity,
      status: l.approved ? "sending" : "waiting",
      createdBy: l.by,
      createdAt: l.now,
      ...(l.approved ? { approvedAt: l.now, approvedBy: l.by } : {}),
    })
    .returning();
  if (!row) throw new Error("insert returned nothing");
  return row;
}

export async function linkById(main: Queryable, id: string): Promise<PayLink | null> {
  if (!UUID.test(id)) return null;
  const [row] = await main.select().from(payLinks).where(eq(payLinks.id, id));
  return row ?? null;
}

/** The waiting ones of these, now on their way; the rest are left as they are. */
export async function approveLinks(
  main: Db,
  ids: readonly string[],
  by: string,
  now: Date,
): Promise<PayLink[]> {
  const ok = ids.filter((id) => UUID.test(id));
  if (!ok.length) return [];
  return main
    .update(payLinks)
    .set({ status: "sending", approvedAt: now, approvedBy: by })
    .where(and(inArray(payLinks.id, ok), eq(payLinks.status, "waiting")))
    .returning();
}

export async function declineLinks(
  main: Db,
  ids: readonly string[],
  by: string,
  now: Date,
): Promise<string[]> {
  const ok = ids.filter((id) => UUID.test(id));
  if (!ok.length) return [];
  const rows = await main
    .update(payLinks)
    .set({ status: "declined", approvedAt: now, approvedBy: by, why: `Declined by ${by}` })
    .where(and(inArray(payLinks.id, ok), eq(payLinks.status, "waiting")))
    .returning({ id: payLinks.id });
  return rows.map((r) => r.id);
}

/** Stripe made the link: kept before the message goes, so a retry sends the same one. */
export async function keepStripeLink(
  main: Db,
  id: string,
  l: { stripeLink: string; url: string; live: boolean },
): Promise<void> {
  await main
    .update(payLinks)
    .set({ stripeLink: l.stripeLink, url: l.url, live: l.live })
    .where(eq(payLinks.id, id));
}

export async function markSent(
  main: Db,
  id: string,
  o: { message: number | null; now: Date },
): Promise<void> {
  await main
    .update(payLinks)
    .set({ status: "sent", message: o.message, sentAt: o.now, why: null })
    .where(and(eq(payLinks.id, id), eq(payLinks.status, "sending")));
}

export async function markFailed(main: Db, id: string, why: string): Promise<void> {
  await main
    .update(payLinks)
    .set({ status: "failed", why: why.slice(0, 500) })
    .where(and(eq(payLinks.id, id), ne(payLinks.status, "paid")));
}

/** Links waiting on a yes, every client's, for To approve. */
export async function waitingPayLinks(main: Queryable) {
  return main
    .select({
      id: payLinks.id,
      client: payLinks.client,
      clientName: clients.name,
      channel: payLinks.channel,
      name: payLinks.name,
      email: payLinks.email,
      description: payLinks.description,
      cents: payLinks.amountCents,
      quantity: payLinks.quantity,
      currency: payLinks.currency,
      by: payLinks.createdBy,
      at: payLinks.createdAt,
    })
    .from(payLinks)
    .leftJoin(clients, eq(clients.id, payLinks.client))
    .where(eq(payLinks.status, "waiting"))
    .orderBy(asc(payLinks.createdAt));
}

/** The To approve item for a link: `pay:<id>`. A bare id reads as itself. */
export const payApprovalId = (id: string) => `pay:${id}`;
export const linkIdOf = (id: string) => (id.startsWith("pay:") ? id.slice(4) : id);

// ---- Stripe events ----

export interface Applied {
  /** False: this event came before; nothing changed. */
  fresh: boolean;
  result: "paid" | "unpaid" | "unknown" | "ignored";
  /** The link it paid, newly. */
  paid: PayLink | null;
}

/**
 * One Stripe event, kept once by its id. A paid checkout on one of this client's links marks it
 * paid with the amount, the session and the mode; anything else is kept and changes nothing.
 */
export async function applyEvent(main: Db, client: string, f: PaidFacts): Promise<Applied> {
  return atomic(main, async (tx) => {
    const ours = (STRIPE_EVENTS as readonly string[]).includes(f.type);
    const paid = ours && f.status === "paid";
    const where = f.link
      ? eq(payLinks.stripeLink, f.link)
      : f.wren && UUID.test(f.wren)
        ? eq(payLinks.id, f.wren)
        : null;
    const [link] = where
      ? await tx
          .select()
          .from(payLinks)
          .where(and(where, eq(payLinks.client, client)))
      : [];
    const result = !ours ? "ignored" : !link ? "unknown" : paid ? "paid" : "unpaid";
    const kept = await tx
      .insert(payEvents)
      .values({
        id: f.event,
        client,
        type: f.type,
        link: link?.id ?? null,
        result,
        seen: {
          session: f.session,
          link: f.link,
          status: f.status,
          cents: f.cents,
          currency: f.currency,
          email: f.email,
          live: f.live,
        },
      })
      .onConflictDoNothing()
      .returning({ id: payEvents.id });
    if (!kept.length) return { fresh: false, result, paid: null };
    if (result !== "paid" || !link) return { fresh: true, result, paid: null };
    const [done] = await tx
      .update(payLinks)
      .set({
        status: "paid",
        paidCents: f.cents ?? link.amountCents * link.quantity,
        paidAt: sql`now()`,
        session: f.session,
        live: f.live,
        why: null,
      })
      .where(and(eq(payLinks.id, link.id), ne(payLinks.status, "paid")))
      .returning();
    return { fresh: true, result, paid: done ?? null };
  });
}

/** The thread's mark in the owner's database: what they paid, all told, and when. */
export async function markContactPaid(
  db: Queryable,
  contact: number,
  cents: number,
  at: Date,
): Promise<void> {
  await db
    .update(smsContacts)
    .set({ paidCents: sql`coalesce(${smsContacts.paidCents}, 0) + ${cents}`, paidAt: at })
    .where(eq(smsContacts.id, contact));
}

// ---- the account ----

export async function payAccountOf(main: Queryable, client: string): Promise<PayAccount | null> {
  const [row] = await main.select().from(payAccounts).where(eq(payAccounts.client, client));
  return row ?? null;
}

export async function savePayAccount(
  main: Db,
  a: {
    client: string;
    endpoint?: string | null;
    secretName?: string | null;
    how?: "api" | "pasted" | null;
    live?: boolean | null;
    by: string;
  },
): Promise<void> {
  const set = {
    ...(a.endpoint !== undefined ? { endpoint: a.endpoint } : {}),
    ...(a.secretName !== undefined ? { secretName: a.secretName } : {}),
    ...(a.how !== undefined ? { how: a.how } : {}),
    ...(a.live !== undefined ? { live: a.live } : {}),
    updatedAt: new Date(),
    updatedBy: a.by,
  };
  await main
    .insert(payAccounts)
    .values({ client: a.client, ...set })
    .onConflictDoUpdate({ target: payAccounts.client, set });
}
