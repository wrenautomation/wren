/** Billing an engagement: our invoices and bills, paid by bank transfer into Wise; refunds and disputes (D15). */
import { usageLines } from "@wren/books/schema";
import { clients } from "@wren/core/clients";
import { VENDORS } from "@wren/core/vendors";
import { type Queryable, setAuditActor } from "@wren/db";
import { offerFor } from "@wren/offers";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { amount } from "./contract.js";
import { startIfReady } from "./onboarding.js";
import {
  addDays,
  bad,
  CURRENCY,
  DeliveryRefusal,
  dayOf,
  engagementOf,
  missing,
  ofClient,
  textIn,
  todayUtc,
} from "./rows.js";
import {
  agreements,
  type Engagement,
  engagements,
  INVOICE_DISPUTES,
  INVOICE_STATUSES,
  type Invoice,
  type InvoiceDispute,
  type InvoiceLine,
  type InvoiceStatus,
  invoices,
  results,
  type Terms,
} from "./schema.js";
import { postUpdate } from "./work.js";

/**
 * A new invoice on the engagement's record, numbered by us (`WREN-1001`). BillingWatch mails its
 * PDF to the client's billing people on its next pass (designs/2026-10-15-wise-billing.md).
 */
export async function addInvoice(
  db: Queryable,
  e: Engagement,
  input: {
    description: string;
    cents: number;
    currency?: string | undefined;
    issuedOn?: string | undefined;
    dueOn: string;
    /** The setup fee: paid with the contract signed, the plan starts. */
    setup?: boolean | undefined;
    /** The month a recurring bill is for, `2026-11`. */
    period?: string | undefined;
    /** Per-unit fees it bills. */
    units?: number | undefined;
    by: string;
  },
): Promise<Invoice> {
  if (!Number.isSafeInteger(input.cents) || input.cents <= 0)
    throw bad("the amount must be over 0, in whole cents");
  const currency = (input.currency ?? "USD").trim().toUpperCase();
  if (!CURRENCY.test(currency)) throw bad("the currency is three letters, like USD");
  const issuedOn = dayOf(input.issuedOn ?? todayUtc(), "the issue date");
  const dueOn = dayOf(input.dueOn, "the due date");
  if (dueOn < issuedOn) throw bad("it can't be due before it's issued");
  const period = input.period ?? null;
  if (period !== null) {
    if (!PERIOD.test(period)) throw bad("the period is a month, like 2026-11");
    const [billed] = await db
      .select({ number: invoices.number })
      .from(invoices)
      .where(
        and(
          eq(invoices.engagementId, e.id),
          eq(invoices.period, period),
          sql`${invoices.status} <> 'void'`,
        ),
      );
    if (billed)
      throw new DeliveryRefusal(`${period} is billed already, invoice ${billed.number}`, 409);
  }
  if (input.units !== undefined && !(Number.isSafeInteger(input.units) && input.units >= 0))
    throw bad("units is a whole number, 0 or more");
  const description = textIn(input.description, "what it's for", 200);
  // The month's bill, line by line, when this invoice is it; else one line, its description.
  const bill =
    period === null ? undefined : (await billsDue(db, period)).find((b) => b.engagementId === e.id);
  const itemized = bill !== undefined && billCents(bill) === input.cents;
  const lines = itemized ? billLines(bill) : [{ what: description, cents: input.cents }];
  const [row] = await db
    .insert(invoices)
    .values({
      engagementId: e.id,
      description,
      cents: input.cents,
      currency,
      issuedOn,
      dueOn,
      setup: input.setup === true,
      period,
      units: input.units ?? null,
      lines,
      createdBy: input.by,
    })
    .returning();
  await markUsage(db, e.clientId, lines, true);
  return row as Invoice;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** One vendor's month of the client's managed usage, at cost plus markup, not billed yet. */
export interface UsageItem {
  vendor: string;
  /** `2026-10`. */
  month: string;
  units: number;
  cents: number;
}

/** What to bill one engagement for a month (D15). */
export interface Bill {
  engagementId: number;
  clientId: string;
  /** `2026-11`. */
  period: string;
  monthlyCents: number;
  units: number;
  unitCents: number;
  /** What a unit is, singular: "meeting booked". */
  unit: string | null;
  currency: string;
  payDays: number;
  /** The client's unbilled usage before this month (designs/2026-10-09-rebilling.md). */
  usage: UsageItem[];
}

export const billCents = (b: Bill): number =>
  b.monthlyCents + b.units * b.unitCents + b.usage.reduce((n, u) => n + u.cents, 0);

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `2026-10` as "October 2026". */
export const monthName = (period: string) =>
  `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;

/** A bill as the lines the client reads on the invoice, in order. */
export function billLines(b: Bill): InvoiceLine[] {
  const out: InvoiceLine[] = [];
  if (b.monthlyCents > 0) out.push({ what: "Monthly fee", cents: b.monthlyCents });
  if (b.units > 0)
    out.push({
      what: `${b.units} × ${b.unit ?? "unit"} at ${amount(b.unitCents, b.currency)}`,
      cents: b.units * b.unitCents,
    });
  for (const u of b.usage) {
    const v = VENDORS.find((x) => x.id === u.vendor);
    const unit = v ? ` ${v.unit}${u.units === 1 ? "" : "s"}` : "";
    out.push({
      what: `${v?.name ?? u.vendor}, ${monthName(u.month)}: ${u.units.toLocaleString("en-US")}${unit}`,
      cents: u.cents,
      usage: { vendor: u.vendor, month: u.month },
    });
  }
  return out;
}

/**
 * Each client's draft usage lines before `period`, in cents over 0: what its next bill carries.
 * Lines on an invoice are past; a month still running is not billed.
 */
async function unbilledUsage(
  db: Queryable,
  clientIds: string[],
  period: string,
): Promise<Map<string, (UsageItem & { currency: string })[]>> {
  const out = new Map<string, (UsageItem & { currency: string })[]>();
  if (clientIds.length === 0) return out;
  const rows = await db
    .select({
      client: usageLines.client,
      vendor: usageLines.vendor,
      month: usageLines.month,
      units: usageLines.units,
      cents: usageLines.amountCents,
      currency: usageLines.currency,
    })
    .from(usageLines)
    .where(
      and(
        inArray(usageLines.client, clientIds),
        eq(usageLines.state, "draft"),
        lt(usageLines.month, `${period}-01`),
        sql`${usageLines.amountCents} > 0`,
      ),
    )
    .orderBy(asc(usageLines.month), asc(usageLines.vendor));
  for (const { client, ...r } of rows) {
    if (client === null) continue;
    const list = out.get(client) ?? [];
    list.push({ ...r, month: r.month.slice(0, 7) });
    out.set(client, list);
  }
  return out;
}

/** Usage lines from draft to `on_invoice`, or back: what an invoice's usage lines name. */
async function markUsage(db: Queryable, clientId: string, lines: InvoiceLine[], billed: boolean) {
  for (const l of lines) {
    if (!l.usage) continue;
    await db
      .update(usageLines)
      .set({ state: billed ? "on_invoice" : "draft" })
      .where(
        and(
          eq(usageLines.client, clientId),
          eq(usageLines.vendor, l.usage.vendor),
          eq(usageLines.month, `${l.usage.month}-01`),
        ),
      );
  }
}

/**
 * The month's bills, from each signed contract's terms: the monthly fee while the work runs
 * (from the first month after it started), plus a fee for each unit not billed yet, until the
 * cap. A non-void invoice for the month means it's sent. Nothing owed, no bill. The demo has none.
 */
export async function billsDue(db: Queryable, period: string): Promise<Bill[]> {
  const rows = await db
    .select({ e: engagements, terms: agreements.terms })
    .from(engagements)
    .innerJoin(agreements, eq(agreements.engagementId, engagements.id))
    .innerJoin(clients, eq(clients.id, engagements.clientId))
    .where(
      and(
        inArray(engagements.status, ["active", "done"]),
        sql`${agreements.signedAt} is not null`,
        eq(clients.demo, false),
      ),
    );
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.e.id);
  const [billed, counts] = await Promise.all([
    db
      .select({
        engagementId: invoices.engagementId,
        period: invoices.period,
        units: invoices.units,
      })
      .from(invoices)
      .where(and(inArray(invoices.engagementId, ids), sql`${invoices.status} <> 'void'`)),
    db.select().from(results).where(inArray(results.engagementId, ids)),
  ]);
  const usage = await unbilledUsage(db, [...new Set(rows.map((r) => r.e.clientId))], period);
  // A client's usage rides one bill: its lowest engagement not billed yet this month.
  const sorted = [...rows].sort((a, b) => a.e.id - b.e.id);
  return sorted.flatMap(({ e, terms: t }): Bill[] => {
    const mine = billed.filter((b) => b.engagementId === e.id);
    if (mine.some((b) => b.period === period)) return [];
    const theirs = usage.get(e.clientId) ?? [];
    const rides = theirs.filter((u) => u.currency === t.currency);
    usage.set(
      e.clientId,
      theirs.filter((u) => u.currency !== t.currency),
    );
    const monthlyCents =
      e.status === "active" && t.monthlyCents && e.startsOn < `${period}-01` ? t.monthlyCents : 0;
    let units = 0;
    const measure = offerFor(e.offerId).perUnitMeasure;
    if (t.perUnitCents && measure) {
      const done = mine.reduce((n, b) => n + (b.units ?? 0), 0);
      const count = counts.find((r) => r.engagementId === e.id && r.key === measure)?.value ?? 0;
      const room =
        t.capCents === null
          ? Infinity
          : Math.floor((t.capCents - done * t.perUnitCents) / t.perUnitCents);
      units = Math.max(0, Math.min(Math.floor(count) - done, room));
    }
    const bill: Bill = {
      engagementId: e.id,
      clientId: e.clientId,
      period,
      monthlyCents,
      units,
      unitCents: t.perUnitCents ?? 0,
      unit: t.unit,
      currency: t.currency,
      payDays: t.payDays,
      usage: rides.map(({ currency: _, ...u }) => u),
    };
    return billCents(bill) > 0 ? [bill] : [];
  });
}

/**
 * The month's bills as invoices (D15), made by BillingWatch from the 1st: each signed contract's
 * bill for `period`, due its pay days after `today`. A month with an invoice already is skipped,
 * so a pass run twice bills once.
 */
export async function billMonth(
  db: Queryable,
  period: string,
  today: string,
  by: string,
): Promise<Invoice[]> {
  const out: Invoice[] = [];
  for (const b of await billsDue(db, period)) {
    const e = await engagementOf(db, b.clientId, b.engagementId);
    out.push(
      await addInvoice(db, e, {
        description: monthName(period),
        cents: billCents(b),
        currency: b.currency,
        issuedOn: today,
        dueOn: addDays(today, b.payDays),
        period,
        units: b.units,
        by,
      }),
    );
  }
  return out;
}

/** The setup fee's invoice, from the contract's terms; none when there's no fee. */
export async function setupInvoice(
  db: Queryable,
  e: Engagement,
  terms: Pick<Terms, "setupCents" | "currency" | "payDays">,
  by: string,
  today = todayUtc(),
): Promise<Invoice | null> {
  if (terms.setupCents <= 0) return null;
  return addInvoice(db, e, {
    description: "Setup",
    cents: terms.setupCents,
    currency: terms.currency,
    issuedOn: today,
    dueOn: addDays(today, terms.payDays),
    setup: true,
    by,
  });
}

/** Paid on a day (today by default), void, or open again. A paid setup fee may start the plan. */
export async function markInvoice(
  db: Queryable,
  clientId: string,
  number: string,
  status: string,
  on?: string,
): Promise<Invoice> {
  if (!INVOICE_STATUSES.includes(status as InvoiceStatus))
    throw bad(`an invoice is ${INVOICE_STATUSES.join(", ")}`);
  const [row] = await db
    .update(invoices)
    .set({
      status: status as InvoiceStatus,
      paidOn: status === "paid" ? dayOf(on ?? todayUtc(), "the paid date") : null,
    })
    .where(and(eq(invoices.number, number.trim()), ofClient(db, invoices.engagementId, clientId)))
    .returning();
  if (!row) throw missing(`invoice '${number}'`);
  // Void, its usage is unbilled again and rides the next bill.
  await markUsage(db, clientId, row.lines, row.status !== "void");
  if (row.status === "paid" && row.setup)
    await startIfReady(db, await engagementOf(db, clientId, row.engagementId));
  return row;
}

/** Why a paid invoice no longer stands, or null while it does. A partial refund or open dispute doesn't end it. */
const reversal = (i: Pick<Invoice, "cents" | "refundedCents" | "dispute">): string | null =>
  i.dispute === "lost"
    ? "lost in a dispute"
    : i.refundedCents >= i.cents
      ? "refunded in full"
      : null;

/**
 * The reverse of `startIfReady`: a running plan whose setup fee was refunded in full or lost in a
 * dispute is paused. A partial refund leaves it running, and so does an open dispute (that one
 * is a flag, see `problems`). The pause is the engagement's own `paused` status; nothing resumes
 * it but `wren delivery engagement active`, once the money is settled. An onboarding plan needs
 * no pause: `startIfReady` won't start it without a fee that holds.
 */
export async function stopIfReversed(db: Queryable, e: Engagement, by: string): Promise<boolean> {
  if (e.status !== "active") return false;
  const paid = await db
    .select()
    .from(invoices)
    .where(
      and(eq(invoices.engagementId, e.id), eq(invoices.setup, true), eq(invoices.status, "paid")),
    );
  const gone = paid.find((i) => reversal(i) !== null);
  if (!gone) return false;
  const [stopped] = await db
    .update(engagements)
    .set({ status: "paused" })
    .where(and(eq(engagements.id, e.id), eq(engagements.status, "active")))
    .returning({ id: engagements.id });
  if (!stopped) return false;
  await postUpdate(db, e, {
    body: `Paused: setup invoice ${gone.number} was ${reversal(gone)}. Resume with \`wren delivery engagement active\` once it's settled.`,
    author: by,
    internal: true,
  });
  return true;
}

/** A paid invoice of the client's, by number: only a payment can be handed back or disputed. */
async function paidInvoice(db: Queryable, clientId: string, number: string): Promise<Invoice> {
  const [row] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.number, number.trim()), ofClient(db, invoices.engagementId, clientId)));
  if (!row) throw missing(`invoice '${number}'`);
  if (row.status !== "paid")
    throw new DeliveryRefusal(
      `invoice ${row.number} isn't paid: nothing to refund or dispute`,
      409,
    );
  return row;
}

/** What a reversal did: the invoice as it stands, and whether it paused the plan. */
export interface Reversed {
  invoice: Invoice;
  paused: boolean;
}

/** The total handed back on a paid invoice, in cents (0 clears it). In full, a setup fee's plan pauses. */
export async function refundInvoice(
  db: Queryable,
  clientId: string,
  number: string,
  refundedCents: number,
  by: string,
): Promise<Reversed> {
  // Who did it, on every row this changes (the audit log); the caller's transaction holds it.
  await setAuditActor(db, by);
  const i = await paidInvoice(db, clientId, number);
  if (!Number.isSafeInteger(refundedCents) || refundedCents < 0 || refundedCents > i.cents)
    throw bad(`the refund is the total handed back, 0 to ${i.cents} cents`);
  const [invoice] = await db
    .update(invoices)
    .set({ refundedCents })
    .where(eq(invoices.id, i.id))
    .returning();
  if (!invoice) throw missing(`invoice '${number}'`);
  return { invoice, paused: await reverseGate(db, clientId, invoice, by) };
}

/** A contested payment on a paid invoice, kept by hand: open, won or lost (null clears it). Lost, a setup fee's plan pauses. */
export async function disputeInvoice(
  db: Queryable,
  clientId: string,
  number: string,
  dispute: InvoiceDispute | null,
  by: string,
): Promise<Reversed> {
  // Who did it, on every row this changes (the audit log); the caller's transaction holds it.
  await setAuditActor(db, by);
  const i = await paidInvoice(db, clientId, number);
  if (dispute !== null && !INVOICE_DISPUTES.includes(dispute))
    throw bad(`a dispute is ${INVOICE_DISPUTES.join(", ")}`);
  const [invoice] = await db
    .update(invoices)
    .set({ dispute })
    .where(eq(invoices.id, i.id))
    .returning();
  if (!invoice) throw missing(`invoice '${number}'`);
  return { invoice, paused: await reverseGate(db, clientId, invoice, by) };
}

const reverseGate = async (db: Queryable, clientId: string, i: Invoice, by: string) =>
  i.setup && (await stopIfReversed(db, await engagementOf(db, clientId, i.engagementId), by));
