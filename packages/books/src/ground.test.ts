import { describe, expect, it } from "vitest";
import { check, printedDays, type Reading, type VendorFacts } from "./ground.js";

const vendor: VendorFacts = { name: "Acme", currency: "USD", cycle: "monthly", gstClaimable: null };
const sentAt = new Date("2026-08-08T15:00:00Z");

const INVOICE = `Acme Cloud Inc.
Invoice #INV-0042
Date of issue: August 8, 2026
Due: Aug 22, 2026
Service period: 2026-08-01 to 2026-08-31
Pro plan 1 x $20.00 $20.00
Extra seats 2 x $5.00 $10.00
Subtotal $30.00
GST 5% (123456789 RT0001) $1.50
Total US$31.50
Charged CA$43.21
Paid with Mastercard`;

type Bill = NonNullable<Reading["bill"]>;

const reading = (bill: Partial<Bill> = {}, payments: Reading["payments"] = []): Reading => ({
  kind: "bill",
  bill: {
    number: "#INV-0042",
    kind: "invoice",
    issued_on: "2026-08-08",
    due_on: "2026-08-22",
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    currency: "USD",
    lines: [
      { description: "Pro plan", quantity: "1", unit_price: "$20.00", amount: "$20.00" },
      { description: "Extra seats", quantity: "2", unit_price: "$5.00", amount: "$10.00" },
    ],
    subtotal: "$30.00",
    taxes: [{ name: "GST", rate_percent: "5", amount: "$1.50", tax_number: "123456789 RT0001" }],
    total: "US$31.50",
    charged_cad: "CA$43.21",
    payment_method: "Mastercard",
    plan: "Pro",
    cycle: "monthly",
    ...bill,
  },
  payments,
});

const checked = (r: Reading, text = INVOICE, facts = vendor) => check(r, { text, sentAt }, facts);

describe("printedDays", () => {
  it("reads the ways invoices print a day", () => {
    const days = printedDays(
      "2026-08-08 · 2026/8/9 · 08/10/2026 · Aug 11, 2026 · August 12th 2026 · 13 Aug 2026 · 14th September 2026 · Sept. 15, 2026",
    );
    for (const d of [
      "2026-08-08",
      "2026-08-09",
      "2026-08-10",
      "2026-10-08",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-09-14",
      "2026-09-15",
    ])
      expect(days.has(d), d).toBe(true);
  });

  it("skips days that do not exist", () => {
    expect(printedDays("2026-02-30 and 31/04/2026").size).toBe(0);
  });
});

describe("check", () => {
  it("keeps a bill whose every figure is printed and adds up", () => {
    const { kind, bill, notes } = checked(reading());
    expect(kind).toBe("bill");
    expect(notes).toEqual([]);
    expect(bill).toMatchObject({
      number: "INV-0042",
      kind: "invoice",
      issuedOn: "2026-08-08",
      dueOn: "2026-08-22",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      currency: "USD",
      subtotalCents: 3000,
      taxCents: 150,
      totalCents: 3150,
      chargedCadCents: 4321,
      plan: "Pro",
      cycle: "monthly",
      reasons: [],
    });
    expect(bill?.lines.map((l) => l.amountCents)).toEqual([2000, 1000]);
    expect(bill?.taxes[0]).toMatchObject({ amountCents: 150, claimable: true, ratePercent: "5" });
  });

  it("holds a bill whose total is not printed or does not add up", () => {
    const { bill } = checked(reading({ total: "US$99.00" }));
    expect(bill?.reasons).toContain("total US$99.00 is not printed");
    expect(bill?.reasons.some((r) => r.includes("is not the total 99.00"))).toBe(true);
  });

  it("holds lines that do not add to the subtotal", () => {
    const text = `${INVOICE}\nSetup $5.00`;
    const lines = [
      { description: "Pro plan", amount: "$20.00" },
      { description: "Extra seats", amount: "$10.00" },
      { description: "Setup", amount: "$5.00" },
    ];
    expect(checked(reading({ lines }), text).bill?.reasons).toEqual([
      "lines add to 35.00, subtotal is 30.00",
    ]);
  });

  it("holds a number that is not printed", () => {
    expect(checked(reading({ number: "INV-0043" })).bill?.reasons).toEqual([
      'number "INV-0043" is not printed',
    ]);
  });

  it("drops a period that is not printed, both ends, with a note", () => {
    const { bill, notes } = checked(reading({ period_end: "2026-09-30" }));
    expect(bill?.periodStart).toBeNull();
    expect(bill?.periodEnd).toBeNull();
    expect(bill?.reasons).toEqual([]);
    expect(notes).toEqual(["period end 2026-09-30 dropped: not printed"]);
  });

  it("takes the sent day for an issue date only the header gives", () => {
    const text = INVOICE.replace("Date of issue: August 8, 2026\n", "");
    expect(checked(reading(), text).bill?.reasons).toEqual([]);
    const bad = checked(reading({ issued_on: "08/08" }), text).bill;
    expect(bad?.issuedOn).toBe("2026-08-08");
    expect(bad?.reasons).toEqual(['issue date "08/08" is not a date']);
  });

  it("lets the due date, else the sent day, stand in for an issue date none is printed for", () => {
    const text = INVOICE.replace("Date of issue: August 8, 2026\n", "");
    const due = checked(reading({ issued_on: null }), text);
    expect(due.bill).toMatchObject({ issuedOn: "2026-08-22", reasons: [] });
    expect(due.notes).toEqual(["no issue date printed: the due date stands in"]);
    const sent = checked(reading({ issued_on: "", due_on: null }), text);
    expect(sent.bill).toMatchObject({ issuedOn: "2026-08-08", reasons: [] });
    expect(sent.notes).toEqual(["no issue date printed: the day it was sent stands in"]);
  });

  it("claims GST only when the vendor can charge it", () => {
    const simplified = checked(reading(), INVOICE, { ...vendor, gstClaimable: false });
    expect(simplified.bill?.taxes[0]?.claimable).toBe(false);
    const text = INVOICE.replace(" (123456789 RT0001)", "");
    const unknown = checked(
      reading({ taxes: [{ name: "GST", rate_percent: "5", amount: "$1.50" }] }),
      text,
    );
    expect(unknown.bill?.taxes[0]?.claimable).toBe(false);
    const salesTax = checked(
      reading({ taxes: [{ name: "Sales tax", amount: "$1.50", tax_number: "123456789 RT0001" }] }),
    );
    expect(salesTax.bill?.taxes[0]?.claimable).toBe(false);
  });

  it("takes the currency from the total's mark, then a printed code, then the vendor", () => {
    expect(checked(reading({ total: "$31.50", currency: "USD" })).bill?.currency).toBe("USD");
    const text = INVOICE.replace("US$", "$").replace("CA$43.21", "43.21");
    const bare = checked(reading({ total: "$31.50", currency: null }), text, {
      ...vendor,
      currency: null,
    }).bill;
    expect(bare?.currency).toBe("XXX");
    expect(bare?.reasons).toContain("no currency printed");
  });

  it("keeps a stated CAD charge only when it is printed", () => {
    const { bill, notes } = checked(reading({ charged_cad: "CA$50.00" }));
    expect(bill?.chargedCadCents).toBeNull();
    expect(notes).toEqual(["charged CAD dropped: charged CAD CA$50.00 is not printed"]);
  });

  it("turns a credit note negative", () => {
    const bill = checked(reading({ kind: "credit note" })).bill;
    expect(bill?.kind).toBe("credit_note");
    expect(bill?.totalCents).toBe(-3150);
    expect(bill?.chargedCadCents).toBe(-4321);
    expect(bill?.lines.map((l) => l.amountCents)).toEqual([-2000, -1000]);
  });

  it("drops a bill with no total but keeps the document a bill", () => {
    const out = checked(reading({ total: null }));
    expect(out.bill).toBeNull();
    expect(out.kind).toBe("bill");
    expect(out.notes).toEqual(["bill dropped: no total"]);
  });

  it("keeps payments whose number, day and amount are printed", () => {
    const out = checked(
      reading({}, [
        {
          invoice_number: "INV-0042",
          paid_on: "2026-08-08",
          amount: "US$31.50",
          method: "Mastercard",
          reference: "ch_1",
        },
        { invoice_number: "INV-0099", paid_on: "2026-08-08", amount: "$31.50" },
        { invoice_number: "INV-0042", paid_on: "2026-08-08", amount: "$31.50" },
      ]),
    );
    expect(out.payments).toEqual([
      {
        invoiceNumber: "INV-0042",
        paidOn: "2026-08-08",
        amountCents: 3150,
        currency: "USD",
        method: "Mastercard",
        reference: "ch_1",
        key: "ch_1",
      },
      {
        invoiceNumber: "INV-0042",
        paidOn: "2026-08-08",
        amountCents: 3150,
        currency: "USD",
        method: null,
        reference: null,
        key: "2026-08-08:3150",
      },
    ]);
    expect(out.notes).toEqual([
      'payment toward "INV-0099" dropped: invoice number "INV-0099" is not printed',
    ]);
  });
});
