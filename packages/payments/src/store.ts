/**
 * Pay links' reads and writes (designs/2026-10-07-forms-and-pay.md, "Text-to-pay"). Links and
 * events on the main database; a paid thread's mark on the owner's own (`markContactPaid`).
 */
import { createHash } from "node:crypto";
import { smsContacts } from "@wren/channel-sms/schema";
import { clients } from "@wren/core/clients";
import { UUID } from "@wren/core/ids";
import { PortalRefusal } from "@wren/core/refusal";
import { atomic, type Db, type Queryable, type Tx } from "@wren/db";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import {
  type PayAccount,
  type PayChannel,
  type PayLink,
  payAccounts,
  payEvents,
  payLinks,
} from "./schema.js";
import {
  type Dispute,
  type EventResult,
  type LinkMoney,
  netCents,
  PAY_CHANGES,
  type PayChange,
  type PayStatus,
  reached,
  step,
} from "./states.js";
import { STRIPE_EVENTS, type StripeFact } from "./stripe.js";

/** A refusal the person asking can act on, with its HTTP status. */
export class PayRefusal extends PortalRefusal {}

/**
 * A link's id from a journaled seed (`ctx.rand`) and a part (a thread, a document): the same on
 * every retry, so a retried insert finds its row instead of making a second link.
 */
export function linkIdFor(seed: string, part: string | number = ""): string {
  const h = createHash("sha256").update(`${seed}:${part}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** Stripe's least and most for one USD charge. */
const MIN_CENTS = 50;
const MAX_CENTS = 99_999_999;

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
  /**
   * The id, made before the step that inserts it (`ctx.rand`): a retried step finds the row it
   * made, never a second link.
   */
  id?: string;
}

/** A new link: waiting on a yes, or approved and on its way (`sending`). Once per `id`. */
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
  if (l.id !== undefined && !UUID.test(l.id)) throw new Error(`not a link id: ${l.id}`);
  const [row] = await main
    .insert(payLinks)
    .values({
      ...(l.id ? { id: l.id } : {}),
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
    .onConflictDoNothing({ target: payLinks.id })
    .returning();
  const made = row ?? (l.id ? await linkById(main, l.id) : null);
  if (!made) throw new Error("insert returned nothing");
  return made;
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

/** Money states a send failure never overwrites: Stripe's word stands. */
const MONEY: PayStatus[] = ["processing", "unpaid", "paid", "refunded"];

export async function markFailed(main: Db, id: string, why: string): Promise<void> {
  await main
    .update(payLinks)
    .set({ status: "failed", why: why.slice(0, 5000) })
    .where(and(eq(payLinks.id, id), notInArray(payLinks.status, MONEY)));
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

/** The link's money, as `./states.ts` steps it. */
export const moneyOf = (l: PayLink): LinkMoney => ({
  status: l.status as PayStatus,
  due: l.amountCents * l.quantity,
  paidCents: l.paidCents,
  paidAt: l.paidAt,
  session: l.session,
  intent: l.intent,
  live: l.live,
  refundedCents: l.refundedCents,
  refundedAt: l.refundedAt,
  dispute: l.dispute as Dispute | null,
  disputeAt: l.disputeAt,
});

const moneyCols = (m: LinkMoney) => ({
  status: m.status,
  paidCents: m.paidCents,
  paidAt: m.paidAt,
  session: m.session,
  intent: m.intent,
  live: m.live,
  refundedCents: m.refundedCents,
  refundedAt: m.refundedAt,
  dispute: m.dispute,
  disputeAt: m.disputeAt,
});

export interface Applied {
  /** False: this event came before; nothing changed. */
  fresh: boolean;
  result: EventResult;
  /** The link it was about, as it is now; null when it matched none. */
  link: PayLink | null;
  /** Paid, but not the amount asked: kept on the link's `why`. */
  drift: string | null;
}

/** The link a fact is about, locked: by its Payment Link, our metadata, then its payment. */
async function lockLinkOf(tx: Tx, client: string, f: StripeFact): Promise<PayLink | null> {
  const by = f.link
    ? eq(payLinks.stripeLink, f.link)
    : f.wren && UUID.test(f.wren)
      ? eq(payLinks.id, f.wren)
      : f.intent
        ? eq(payLinks.intent, f.intent)
        : null;
  if (!by) return null;
  const [l] = await tx
    .select()
    .from(payLinks)
    .where(and(by, eq(payLinks.client, client)))
    .limit(1)
    .for("update");
  return l ?? null;
}

/** The fact as `pay_events.seen` keeps it, and back: all `step` needs to apply it again. */
const seenOf = (f: StripeFact) => ({ ...f }) as Record<string, string | number | boolean | null>;
const factOf = (seen: Record<string, unknown>): StripeFact => seen as unknown as StripeFact;

/**
 * Refunds and disputes that came before their checkout (Stripe sends in any order) were kept
 * as unknown; once a checkout teaches us the payment's id, they are applied in Stripe's order.
 */
async function replayEarly(tx: Tx, client: string, l: PayLink, now: Date): Promise<PayLink> {
  if (!l.intent) return l;
  const early = await tx
    .select()
    .from(payEvents)
    .where(
      and(
        eq(payEvents.client, client),
        isNull(payEvents.link),
        eq(payEvents.result, "unknown"),
        sql`${payEvents.seen}->>'intent' = ${l.intent}`,
      ),
    )
    .orderBy(sql`(${payEvents.seen}->>'created')::bigint nulls first`, asc(payEvents.at));
  let cur = l;
  for (const e of early) {
    const r = step(moneyOf(cur), factOf(e.seen), now);
    await tx
      .update(payEvents)
      .set({ link: cur.id, result: r.result })
      .where(eq(payEvents.id, e.id));
    if (!r.changed) continue;
    const [u] = await tx
      .update(payLinks)
      .set(moneyCols(r.next))
      .where(eq(payLinks.id, cur.id))
      .returning();
    if (u) cur = u;
  }
  return cur;
}

/**
 * One Stripe event (or reconcile's own), kept once by its id and applied under the link's row
 * lock: a duplicate changes nothing, a late one is stepped like any other (`./states.ts`), and
 * one about a link we don't know yet is kept to apply once we do.
 */
export async function applyEvent(
  main: Db,
  client: string,
  f: StripeFact,
  now: Date,
): Promise<Applied> {
  return atomic(main, async (tx) => {
    const [before] = await tx
      .select({ link: payEvents.link })
      .from(payEvents)
      .where(eq(payEvents.id, f.event));
    if (before) {
      const l = before.link ? await linkById(tx, before.link) : null;
      return { fresh: false, result: "stale", link: l, drift: null };
    }
    const link = await lockLinkOf(tx, client, f);
    const r = link ? step(moneyOf(link), f, now) : null;
    const result: EventResult = r
      ? r.result
      : f.kind === "other" || !(STRIPE_EVENTS as readonly string[]).includes(f.type)
        ? "ignored"
        : "unknown";
    const kept = await tx
      .insert(payEvents)
      .values({
        id: f.event,
        client,
        type: f.type,
        link: link?.id ?? null,
        result,
        seen: seenOf(f),
        at: now,
      })
      .onConflictDoNothing()
      .returning({ id: payEvents.id });
    if (!kept.length) return { fresh: false, result: "stale", link, drift: null };
    if (!link || !r) return { fresh: true, result, link: null, drift: null };
    let after = link;
    if (r.changed) {
      const why = r.result === "paid" ? { why: r.drift } : {};
      const [u] = await tx
        .update(payLinks)
        .set({ ...moneyCols(r.next), ...why })
        .where(eq(payLinks.id, link.id))
        .returning();
      if (u) after = u;
    }
    if (after.intent && !link.intent) after = await replayEarly(tx, client, after, now);
    return { fresh: true, result, link: after, drift: r.drift };
  });
}

/**
 * The thread's mark in the owner's database, worked out again from every link to it: what they
 * have paid net of refunds, and when; cleared when nothing paid stands. Safe to run twice.
 */
export async function syncContactPaid(
  main: Queryable,
  db: Queryable,
  client: string,
  contact: number,
): Promise<{ cents: number; at: Date | null }> {
  const links = await main
    .select()
    .from(payLinks)
    .where(and(eq(payLinks.client, client), eq(payLinks.contact, contact)));
  let cents = 0;
  let at: Date | null = null;
  for (const l of links) {
    const net = netCents(moneyOf(l));
    if (!net) continue;
    cents += net;
    if (l.paidAt && (!at || l.paidAt > at)) at = l.paidAt;
  }
  await db
    .update(smsContacts)
    .set({ paidCents: cents || null, paidAt: cents ? at : null })
    .where(eq(smsContacts.id, contact));
  return { cents, at };
}

/**
 * The changes this link has reached that no workflow has heard, claimed under `token`: each
 * change is told once ever. A retry with the same token gets the same changes back.
 */
export async function claimChanges(
  main: Db,
  id: string,
  token: string,
): Promise<{ link: PayLink | null; changes: PayChange[] }> {
  return atomic(main, async (tx) => {
    const [l] = await tx.select().from(payLinks).where(eq(payLinks.id, id)).for("update");
    if (!l) return { link: null, changes: [] };
    const told = { ...l.told };
    let more = false;
    for (const c of reached(moneyOf(l)))
      if (!told[c]) {
        told[c] = token;
        more = true;
      }
    const [u] = more
      ? await tx.update(payLinks).set({ told }).where(eq(payLinks.id, id)).returning()
      : [l];
    return { link: u ?? l, changes: PAY_CHANGES.filter((c) => told[c] === token) };
  });
}

// ---- reconcile ----

/** How long reconcile keeps checking a link after it was made, and how often. */
const CHECK_FOR_DAYS = 120;
const CHECK_EVERY_MS = 20 * 3_600_000;
/** Statuses Stripe may still move: out, checked out, paid, refunded. */
const MOVABLE: PayStatus[] = ["sent", "processing", "unpaid", "paid", "refunded", "failed"];

/** A client's links due a look against Stripe: made on Stripe, recent, not checked lately. */
export async function linksToCheck(main: Queryable, client: string, now: Date, limit = 50) {
  return main
    .select()
    .from(payLinks)
    .where(
      and(
        eq(payLinks.client, client),
        isNotNull(payLinks.stripeLink),
        inArray(payLinks.status, MOVABLE),
        gt(payLinks.createdAt, new Date(now.getTime() - CHECK_FOR_DAYS * 86_400_000)),
        or(
          isNull(payLinks.checkedAt),
          lt(payLinks.checkedAt, new Date(now.getTime() - CHECK_EVERY_MS)),
        ),
      ),
    )
    .orderBy(asc(payLinks.checkedAt), asc(payLinks.createdAt))
    .limit(limit);
}

/** Clients with a Stripe webhook: reconcile's list. */
export async function payClients(main: Queryable): Promise<PayAccount[]> {
  return main.select().from(payAccounts).where(isNotNull(payAccounts.secretName));
}

export async function markChecked(main: Db, id: string, now: Date): Promise<void> {
  await main.update(payLinks).set({ checkedAt: now }).where(eq(payLinks.id, id));
}

/**
 * Ours and Stripe's disagree in a way no event fixes (we say paid, Stripe has no payment): kept
 * once by `key` as a `drift` event and said on the link's `why` for a person to look at.
 */
export async function noteDrift(
  main: Db,
  l: Pick<PayLink, "id" | "client">,
  key: string,
  what: string,
  now: Date,
): Promise<boolean> {
  return atomic(main, async (tx) => {
    const kept = await tx
      .insert(payEvents)
      .values({
        id: `recon:${l.id}:drift:${key}`.slice(0, 80),
        client: l.client,
        type: "wren.reconcile.drift",
        link: l.id,
        result: "drift",
        seen: { what },
        at: now,
      })
      .onConflictDoNothing()
      .returning({ id: payEvents.id });
    if (kept.length) await tx.update(payLinks).set({ why: what }).where(eq(payLinks.id, l.id));
    return kept.length > 0;
  });
}

// ---- the account ----

export async function payAccountOf(main: Queryable, client: string): Promise<PayAccount | null> {
  const [row] = await main.select().from(payAccounts).where(eq(payAccounts.client, client));
  return row ?? null;
}

/** What reconcile found about the endpoint's events: a note for the client, or null once it's fine. */
export async function keepWebhookNote(
  main: Queryable,
  client: string,
  note: string | null,
): Promise<void> {
  await main.update(payAccounts).set({ note }).where(eq(payAccounts.client, client));
}

export async function savePayAccount(
  main: Db,
  a: {
    client: string;
    endpoint?: string | null;
    secretName?: string | null;
    how?: "api" | "pasted" | null;
    live?: boolean | null;
    /** Reconcile's note on the endpoint's events; a new key or secret clears it (null). */
    note?: string | null;
    by: string;
  },
): Promise<void> {
  const set = {
    ...(a.endpoint !== undefined ? { endpoint: a.endpoint } : {}),
    ...(a.secretName !== undefined ? { secretName: a.secretName } : {}),
    ...(a.how !== undefined ? { how: a.how } : {}),
    ...(a.live !== undefined ? { live: a.live } : {}),
    ...(a.note !== undefined ? { note: a.note } : {}),
    updatedAt: new Date(),
    updatedBy: a.by,
  };
  await main
    .insert(payAccounts)
    .values({ client: a.client, ...set })
    .onConflictDoUpdate({ target: payAccounts.client, set });
}
