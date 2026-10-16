import { describe, expect, it } from "vitest";
import {
  type CreditFacts,
  type InvoiceFacts,
  matchCredit,
  nameKey,
  referencesIn,
  samePayer,
} from "./match.js";

const credit = (over: Partial<CreditFacts> = {}): CreditFacts => ({
  kind: "DEPOSIT",
  currency: "USD",
  cents: 100_000,
  feeCents: 0,
  payer: "Acme Staffing LLC",
  memo: null,
  description: null,
  ...over,
});
const inv = (over: Partial<InvoiceFacts> = {}): InvoiceFacts => ({
  id: 1,
  number: "WREN-1001",
  currency: "USD",
  cents: 100_000,
  receivedCents: 0,
  status: "open",
  clientName: "Acme Staffing",
  ...over,
});

describe("referencesIn", () => {
  it("reads our numbers however a bank form wrote them", () => {
    expect(referencesIn("Invoice WREN-1001")).toEqual(["WREN-1001"]);
    expect(referencesIn("wren 1002 and WREN1003, wren_01004")).toEqual([
      "WREN-1002",
      "WREN-1003",
      "WREN-1004",
    ]);
    expect(referencesIn("REF 1001")).toEqual([]);
  });
});

describe("payer names", () => {
  it("drops case, punctuation and company suffixes", () => {
    expect(nameKey("ACME Staffing, L.L.C.")).toBe("acme staffing l l c");
    expect(nameKey("The Acme Co.")).toBe("acme");
    expect(samePayer("ACME STAFFING LLC", "Acme Staffing")).toBe(true);
    expect(samePayer("Bolt Inc", "Acme Staffing")).toBe(false);
    expect(samePayer(null, "Acme Staffing")).toBe(false);
    expect(samePayer("Inc", "LLC")).toBe(false);
  });
});

describe("matchCredit", () => {
  it("the reference first: exact pays it, gross or net", () => {
    expect(matchCredit(credit({ memo: "WREN-1001", payer: "Someone Else" }), [inv()])).toEqual({
      status: "matched",
      invoiceId: 1,
      why: "reference",
      cents: 100_000,
    });
    // Wise took a fee: what was sent covers it.
    expect(
      matchCredit(credit({ memo: "wren 1001", cents: 99_500, feeCents: 500 }), [inv()]),
    ).toMatchObject({ status: "matched", cents: 100_000 });
  });

  it("partial, over, wrong currency or a closed invoice wait, with the candidate", () => {
    const [a] = [inv()];
    expect(matchCredit(credit({ memo: "WREN-1001", cents: 40_000 }), [a])).toMatchObject({
      status: "review",
      invoiceId: 1,
      why: "partial: USD 400.00 of USD 1000.00 due",
    });
    expect(matchCredit(credit({ memo: "WREN-1001", cents: 120_000 }), [a])).toMatchObject({
      status: "review",
      why: expect.stringMatching(/^over/),
    });
    expect(matchCredit(credit({ memo: "WREN-1001", currency: "CAD" }), [a])).toMatchObject({
      status: "review",
      invoiceId: 1,
      why: "wrong currency: CAD for a USD invoice",
    });
    expect(matchCredit(credit({ memo: "WREN-1001" }), [inv({ status: "paid" })])).toMatchObject({
      status: "review",
      why: "WREN-1001 is paid",
    });
    // Part paid already: the rest, exactly, pays it.
    expect(
      matchCredit(credit({ memo: "WREN-1001", cents: 60_000 }), [inv({ receivedCents: 40_000 })]),
    ).toMatchObject({ status: "matched", cents: 60_000 });
  });

  it("two invoices named wait", () => {
    expect(
      matchCredit(credit({ memo: "WREN-1001 WREN-1002" }), [
        inv(),
        inv({ id: 2, number: "WREN-1002" }),
      ]),
    ).toMatchObject({ status: "review", invoiceId: 1, why: "names WREN-1001, WREN-1002" });
  });

  it("no reference: exact amount and payer, and only one such invoice", () => {
    const bolt = inv({ id: 2, number: "WREN-1002", clientName: "Bolt" });
    expect(matchCredit(credit(), [inv(), bolt])).toMatchObject({
      status: "matched",
      invoiceId: 1,
      why: "amount and payer",
    });
    expect(matchCredit(credit(), [inv(), inv({ id: 3, number: "WREN-1003" })])).toMatchObject({
      status: "review",
      invoiceId: null,
      why: "2 invoices fit, no reference",
    });
    expect(matchCredit(credit({ payer: "Stranger" }), [inv()])).toMatchObject({
      status: "review",
      invoiceId: 1,
      why: "amount fits, payer and memo don't",
    });
    expect(matchCredit(credit({ cents: 30_000 }), [inv()])).toMatchObject({
      status: "review",
      invoiceId: 1,
      why: "partial: USD 300.00 of USD 1000.00 due",
    });
    expect(matchCredit(credit({ currency: "EUR" }), [inv()])).toMatchObject({
      status: "review",
      invoiceId: 1,
      why: "wrong currency: EUR for a USD invoice",
    });
    expect(matchCredit(credit({ payer: "Stranger", cents: 1 }), [inv()])).toEqual({
      status: "review",
      invoiceId: null,
      why: "no invoice fits",
    });
  });

  it("our own moves are never matched", () => {
    expect(matchCredit(credit({ kind: "CONVERSION", memo: "WREN-1001" }), [inv()])).toMatchObject({
      status: "ignored",
      invoiceId: null,
    });
  });
});
