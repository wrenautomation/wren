import { describe, expect, it } from "vitest";
import type { Invoice } from "../schema.js";
import { invoiceFired, invoiceReached } from "./tell.js";

const base = {
  status: "open",
  refundedCents: 0,
  dueOn: "2026-11-01",
} as Pick<Invoice, "status" | "refundedCents" | "dueOn">;

describe("invoiceReached", () => {
  it("issued is the first change", () => {
    expect(invoiceReached(base, "2026-10-19")).toEqual(["invoiced"]);
  });
  it("an open invoice past its due day is late", () => {
    expect(invoiceReached(base, "2026-11-02")).toEqual(["invoiced", "late"]);
    expect(invoiceReached(base, "2026-11-01")).toEqual(["invoiced"]);
  });
  it("paid is not late", () => {
    expect(invoiceReached({ ...base, status: "paid" }, "2026-12-01")).toEqual(["invoiced", "paid"]);
  });
  it("a refund adds refunded", () => {
    expect(invoiceReached({ ...base, status: "paid", refundedCents: 100 }, "2026-10-19")).toEqual([
      "invoiced",
      "paid",
      "refunded",
    ]);
  });
  it("void reaches nothing", () => {
    expect(invoiceReached({ ...base, status: "void" }, "2027-01-01")).toEqual([]);
  });
});

describe("invoiceFired", () => {
  const inv = {
    number: "WREN-1001",
    description: "Setup",
    cents: 50_000,
    receivedCents: 0,
    refundedCents: 0,
    currency: "USD",
    setup: true,
  } as Invoice;
  const who = { client: "acme", name: "Acme", email: "owner@example.com" };
  it("tells a change once per number, about the billing person", () => {
    const f = invoiceFired(inv, "paid", who);
    expect(f.client).toBeNull();
    expect(f.facts).toEqual({ trigger: "trigger.payment", change: "paid" });
    expect(f.about).toEqual(["owner@example.com"]);
    expect(f.event.subject).toBe("payment:invoice:WREN-1001:paid");
    expect(f.event.kind).toBe("invoice");
    expect(f.event.data).toMatchObject({
      source: "invoice",
      id: "WREN-1001",
      amount_cents: 50_000,
      email: "owner@example.com",
    });
  });
  it("uses what came in when it is known", () => {
    const f = invoiceFired({ ...inv, receivedCents: 49_000 }, "paid", who);
    expect(f.event.data.amount_cents).toBe(49_000);
  });
  it("omits the email when none is known", () => {
    const f = invoiceFired(inv, "invoiced", { ...who, email: null });
    expect(f.about).toEqual([]);
    expect(f.event.data).not.toHaveProperty("email");
  });
});
