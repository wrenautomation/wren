/**
 * Every step of a link's money, alone and out of order. Synthetic ids and amounts only.
 */
import { describe, expect, it } from "vitest";
import {
  disputeOf,
  hasAccess,
  type LinkMoney,
  netCents,
  reached,
  settled,
  step,
} from "./states.js";
import type { StripeFact } from "./stripe.js";

const NOW = new Date("2026-10-14T12:00:00Z");
const sent: LinkMoney = {
  status: "sent",
  due: 4900,
  paidCents: null,
  paidAt: null,
  session: null,
  intent: null,
  live: null,
  refundedCents: 0,
  refundedAt: null,
  dispute: null,
  disputeAt: null,
};
let n = 0;
const fact = (o: Partial<StripeFact> & Pick<StripeFact, "type" | "kind">): StripeFact => ({
  event: `evt_test_${++n}`,
  created: null,
  session: "cs_test_1",
  link: "plink_test_1",
  intent: "pi_test_1",
  wren: null,
  status: null,
  cents: null,
  currency: "usd",
  email: null,
  refunded: null,
  live: false,
  ...o,
});
const paid = (cents = 4900) =>
  fact({ type: "checkout.session.completed", kind: "checkout", status: "paid", cents });
const pending = () =>
  fact({ type: "checkout.session.completed", kind: "checkout", status: "unpaid", cents: 4900 });
const cleared = () =>
  fact({
    type: "checkout.session.async_payment_succeeded",
    kind: "checkout",
    status: "paid",
    cents: 4900,
  });
const bounced = () =>
  fact({ type: "checkout.session.async_payment_failed", kind: "checkout", status: "unpaid" });
const refund = (total: number) =>
  fact({ type: "charge.refunded", kind: "refund", session: null, link: null, refunded: total });
const dispute = (status: string, created: number, type = "charge.dispute.updated") =>
  fact({ type, kind: "dispute", session: null, link: null, status, created });
/** Facts one after another, from `m`. */
const run = (m: LinkMoney, ...fs: StripeFact[]) => fs.reduce((x, f) => step(x, f, NOW).next, m);

describe("a checkout", () => {
  it("paid: the money, the session, the payment, the mode", () => {
    const r = step(sent, paid(), NOW);
    expect(r.result).toBe("paid");
    expect(r.changed).toBe(true);
    expect(r.drift).toBeNull();
    expect(r.next).toMatchObject({
      status: "paid",
      paidCents: 4900,
      paidAt: NOW,
      session: "cs_test_1",
      intent: "pi_test_1",
      live: false,
    });
  });
  it("paid twice: the second changes nothing", () => {
    const once = run(sent, paid());
    const r = step(once, paid(), NOW);
    expect(r.changed).toBe(false);
    expect(r.result).toBe("stale");
  });
  it("paid another amount: kept, and flagged as drift", () => {
    const r = step(sent, paid(5000), NOW);
    expect(r.next.paidCents).toBe(5000);
    expect(r.drift).toBe("paid 5000 cents of 4900");
  });
  it("paid even after a send failed: Stripe's word stands", () => {
    expect(run({ ...sent, status: "failed" }, paid()).status).toBe("paid");
  });
  it("a bank debit: processing, then paid when it clears", () => {
    const p = step(sent, pending(), NOW);
    expect(p.result).toBe("processing");
    expect(p.next.status).toBe("processing");
    expect(run(p.next, cleared()).status).toBe("paid");
  });
  it("a bank debit that fails: unpaid", () => {
    const m = run(sent, pending(), bounced());
    expect(m.status).toBe("unpaid");
    expect(m.paidCents).toBeNull();
  });
  it("a late processing never undoes paid or unpaid", () => {
    expect(run(sent, cleared(), pending()).status).toBe("paid");
    expect(run(sent, bounced(), pending()).status).toBe("unpaid");
  });
  it("a late failure never undoes paid", () => {
    expect(run(sent, cleared(), bounced()).status).toBe("paid");
  });
  it("a checkout of another kind is ignored", () => {
    const r = step(
      sent,
      fact({ type: "checkout.session.expired", kind: "checkout", status: "unpaid" }),
      NOW,
    );
    expect(r.result).toBe("ignored");
    expect(r.changed).toBe(false);
  });
});

describe("a refund", () => {
  const p = run(sent, paid());
  it("part: still paid, the refund counted", () => {
    const r = step(p, refund(1000), NOW);
    expect(r.result).toBe("refunded");
    expect(r.next).toMatchObject({ status: "paid", refundedCents: 1000, refundedAt: NOW });
    expect(netCents(r.next)).toBe(3900);
  });
  it("in full: refunded, access gone", () => {
    const m = run(p, refund(4900));
    expect(m.status).toBe("refunded");
    expect(hasAccess(m)).toBe(false);
    expect(netCents(m)).toBe(0);
  });
  it("Stripe's total is cumulative: an older, smaller total changes nothing", () => {
    const m = run(p, refund(4900), refund(1000));
    expect(m.refundedCents).toBe(4900);
    expect(m.status).toBe("refunded");
    expect(step(m, refund(1000), NOW).changed).toBe(false);
  });
  it("before its checkout (out of order): counted, settles when paid arrives", () => {
    const early = run(sent, refund(4900));
    expect(early.status).toBe("sent");
    expect(early.refundedCents).toBe(4900);
    expect(run(early, paid()).status).toBe("refunded");
  });
});

describe("a dispute", () => {
  const p = run(sent, paid());
  it("open keeps access; lost takes it; won gives it back", () => {
    const open = run(p, dispute("needs_response", 100, "charge.dispute.created"));
    expect(open).toMatchObject({ status: "paid", dispute: "open", disputeAt: 100 });
    expect(hasAccess(open)).toBe(true);
    const lost = run(open, dispute("lost", 200, "charge.dispute.closed"));
    expect(lost.status).toBe("refunded");
    expect(hasAccess(lost)).toBe(false);
    const won = run(open, dispute("won", 200, "charge.dispute.closed"));
    expect(won).toMatchObject({ status: "paid", dispute: "won" });
  });
  it("an older event never overrides a newer one (closed before updated)", () => {
    const m = run(p, dispute("lost", 300, "charge.dispute.closed"), dispute("under_review", 200));
    expect(m.dispute).toBe("lost");
    expect(m.status).toBe("refunded");
  });
  it("same time: applies (Stripe may send two in one second)", () => {
    expect(run(p, dispute("needs_response", 5), dispute("lost", 5)).dispute).toBe("lost");
  });
  it("an inquiry closed without a dispute reads as won", () => {
    expect(disputeOf("warning_closed")).toBe("won");
    expect(disputeOf("warning_needs_response")).toBe("open");
    expect(disputeOf("warning_under_review")).toBe("open");
    expect(disputeOf("charge_refunded")).toBeNull();
    expect(disputeOf(null)).toBeNull();
  });
  it("an unknown dispute status changes nothing", () => {
    const r = step(p, dispute("charge_refunded", 400), NOW);
    expect(r.changed).toBe(false);
    expect(r.result).toBe("stale");
  });
});

describe("any order", () => {
  it("every order of paid, part refund, dispute open, dispute won ends the same", () => {
    const fs = [paid(), refund(1000), dispute("needs_response", 10), dispute("won", 20)];
    const orders = [
      [0, 1, 2, 3],
      [3, 2, 1, 0],
      [1, 0, 3, 2],
      [2, 3, 0, 1],
      [1, 3, 2, 0],
    ];
    const ends = orders.map((o) => run(sent, ...o.map((i) => fs[i] as StripeFact)));
    for (const e of ends)
      expect(e).toMatchObject({ status: "paid", refundedCents: 1000, dispute: "won" });
  });
  it("other events are ignored", () => {
    const r = step(sent, fact({ type: "customer.created", kind: "other" }), NOW);
    expect(r).toMatchObject({ result: "ignored", changed: false });
  });
});

describe("what follows", () => {
  it("settled: unpaid links keep their status", () => {
    expect(settled(sent)).toBe("sent");
    expect(settled({ ...sent, status: "declined" })).toBe("declined");
  });
  it("reached: paid once money came; refunded; failed", () => {
    expect(reached(sent)).toEqual([]);
    expect(reached(run(sent, paid()))).toEqual(["paid"]);
    expect(reached(run(sent, paid(), refund(4900)))).toEqual(["paid", "refunded"]);
    expect(reached(run(sent, pending(), bounced()))).toEqual(["failed"]);
  });
});
