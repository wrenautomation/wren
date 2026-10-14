/**
 * A pay link's money, step by step (designs/2026-10-07-forms-and-pay.md, "Durable payments").
 * Pure: one Stripe fact in, the link's next money state out. The store runs it under a row lock.
 *
 * Stripe sends events at least once and in any order, so every step is safe twice and safe
 * late: paid sticks, a refund only grows (its total is cumulative), a dispute applies only if it
 * is newer than the one we hold, and the status is derived from those, never set by arrival.
 */
import type { StripeFact } from "./stripe.js";

/**
 * Where a link is. waiting: on a yes. sending: yes given, on its way. sent: out. processing:
 * checked out by a bank debit not yet cleared. unpaid: that debit failed; send a new link.
 * paid: Stripe has the money. refunded: refunded in full, or a dispute lost. declined: a person
 * said no. failed: Stripe or the send refused it (`why`).
 */
export const PAY_STATUSES = [
  "waiting",
  "sending",
  "sent",
  "processing",
  "unpaid",
  "paid",
  "refunded",
  "declined",
  "failed",
] as const;
export type PayStatus = (typeof PAY_STATUSES)[number];

/** A dispute as access reads it: open keeps access until it is lost. */
export const DISPUTES = ["open", "won", "lost"] as const;
export type Dispute = (typeof DISPUTES)[number];

/** Stripe's dispute statuses, ours. An inquiry closed without a dispute is won. */
export const disputeOf = (status: string | null): Dispute | null => {
  if (!status) return null;
  if (status === "lost") return "lost";
  if (status === "won" || status === "warning_closed") return "won";
  if (/needs_response|under_review/.test(status)) return "open";
  return null;
};

/** The money part of a link: all a step reads or writes. */
export interface LinkMoney {
  status: PayStatus;
  /** What it asks: amount times quantity. */
  due: number;
  paidCents: number | null;
  paidAt: Date | null;
  session: string | null;
  intent: string | null;
  live: boolean | null;
  refundedCents: number;
  refundedAt: Date | null;
  dispute: Dispute | null;
  /** When Stripe made the dispute event we hold (unix seconds): older ones change nothing. */
  disputeAt: number | null;
}

/** What one event did, kept on `pay_events.result`. */
export const PAY_EVENT_RESULTS = [
  "paid",
  "processing",
  "unpaid",
  "refunded",
  "disputed",
  "stale",
  "unknown",
  "ignored",
  "drift",
] as const;
export type EventResult = (typeof PAY_EVENT_RESULTS)[number];

export interface Stepped {
  next: LinkMoney;
  result: EventResult;
  /** The event changed something on the link. */
  changed: boolean;
  /** Paid, but not what the link asks: kept, and flagged for a person. */
  drift: string | null;
}

/** Paid, ever: the money came, whatever happened after. */
const wasPaid = (m: LinkMoney) => m.paidCents !== null;
/** Before any money: a checkout may still move these. */
const OPEN: readonly PayStatus[] = ["sending", "sent", "failed", "waiting"];

/** The status a paid link has now: refunded in full or a lost dispute takes access away. */
export function settled(m: LinkMoney): PayStatus {
  if (!wasPaid(m)) return m.status;
  if (m.dispute === "lost") return "refunded";
  if (m.refundedCents > 0 && m.refundedCents >= (m.paidCents ?? 0)) return "refunded";
  return "paid";
}

/** Does the payer have what they paid for? Paid, not refunded in full, no dispute lost. */
export const hasAccess = (m: Pick<LinkMoney, "status">) => m.status === "paid";

const same = (a: LinkMoney, b: LinkMoney) =>
  a.status === b.status &&
  a.paidCents === b.paidCents &&
  a.session === b.session &&
  a.intent === b.intent &&
  a.refundedCents === b.refundedCents &&
  a.dispute === b.dispute &&
  a.disputeAt === b.disputeAt;

/** One fact on one link, at `now`. Safe twice; safe in any order. */
export function step(m: LinkMoney, f: StripeFact, now: Date): Stepped {
  let next: LinkMoney = { ...m };
  let result: EventResult = "stale";
  let drift: string | null = null;

  if (f.kind === "checkout") {
    const paid =
      f.type === "checkout.session.async_payment_succeeded" ||
      (f.type === "checkout.session.completed" && f.status === "paid");
    const failed = f.type === "checkout.session.async_payment_failed";
    const pending = f.type === "checkout.session.completed" && f.status === "unpaid";
    if (paid) {
      result = "paid";
      if (!wasPaid(m)) {
        const cents = f.cents ?? m.due;
        next = {
          ...next,
          paidCents: cents,
          paidAt: now,
          session: f.session ?? m.session,
          live: f.live,
        };
        if (cents !== m.due) drift = `paid ${cents} cents of ${m.due}`;
      }
    } else if (failed) {
      result = "unpaid";
      if (!wasPaid(m)) next = { ...next, status: "unpaid", session: f.session ?? m.session };
    } else if (pending) {
      result = "processing";
      if (!wasPaid(m) && OPEN.includes(m.status))
        next = { ...next, status: "processing", session: f.session ?? m.session };
    } else result = "ignored";
  } else if (f.kind === "refund") {
    result = "refunded";
    const total = f.refunded ?? 0;
    if (total > m.refundedCents) next = { ...next, refundedCents: total, refundedAt: now };
  } else if (f.kind === "dispute") {
    result = "disputed";
    const d = disputeOf(f.status);
    const at = f.created ?? 0;
    if (d && at >= (m.disputeAt ?? 0)) next = { ...next, dispute: d, disputeAt: at };
  } else result = "ignored";

  // The payment's id, learned from the first event about it: refunds and disputes find it by it.
  if (result !== "ignored") next = { ...next, intent: next.intent ?? f.intent };
  next = { ...next, status: settled(next) };
  const changed = !same(m, next);
  if (!changed && result !== "ignored") result = "stale";
  return { next, result, changed, drift };
}

/** What a workflow or a webhook hears about a link, each once ever (`pay_links.told`). */
export const PAY_CHANGES = ["paid", "refunded", "failed"] as const;
export type PayChange = (typeof PAY_CHANGES)[number];

/** The changes this link has reached: paid once the money came, refunded, failed (unpaid). */
export function reached(m: Pick<LinkMoney, "status" | "paidCents">): PayChange[] {
  const out: PayChange[] = [];
  if (m.paidCents !== null) out.push("paid");
  if (m.status === "refunded") out.push("refunded");
  if (m.status === "unpaid") out.push("failed");
  return out;
}

/** What a payer has paid, net of refunds; nothing once access is gone. */
export const netCents = (m: Pick<LinkMoney, "status" | "paidCents" | "refundedCents">) =>
  m.status === "paid" ? Math.max(0, (m.paidCents ?? 0) - m.refundedCents) : 0;
