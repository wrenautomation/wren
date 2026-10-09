import { describe, expect, it } from "vitest";
import { depositOf, fillSlots, lineAmount, lineTax, money, slotsLeft, totalsOf } from "./lines.js";

describe("lines", () => {
  it("rounds tax per line and totals the rounded parts", () => {
    const lines = [
      { name: "Filter", qty: 3, unit_cents: 333, tax_pct: 8.25 },
      { name: "Labor", qty: 1.5, unit_cents: 9999, tax_pct: null },
    ];
    expect(lines.map(lineAmount)).toEqual([999, 14999]);
    expect(lines.map(lineTax)).toEqual([82, 0]);
    expect(totalsOf(lines)).toEqual({ subtotalCents: 15998, taxCents: 82, totalCents: 16080 });
    expect(totalsOf([])).toEqual({ subtotalCents: 0, taxCents: 0, totalCents: 0 });
  });

  it("takes a deposit as a share, none under $0.50", () => {
    expect(depositOf(16080, 25)).toBe(4020);
    expect(depositOf(100, 10)).toBeNull();
    expect(depositOf(16080, null)).toBeNull();
  });

  it("fills known slots and names the rest once", () => {
    const text = "Hi {contact.first_name}, from {biz.name}. {field.size} {biz.name} {constructor}";
    const filled = fillSlots(text, { "contact.first_name": "Sam", "biz.name": "Acme Air" });
    expect(filled).toBe("Hi Sam, from Acme Air. {field.size} Acme Air {constructor}");
    expect(slotsLeft(filled, "{field.size}")).toEqual(["{field.size}", "{constructor}"]);
    expect(fillSlots("{contact.name}", { "contact.name": "" })).toBe("{contact.name}");
  });

  it("prints money", () => {
    expect(money(120000)).toBe("$1,200.00");
  });
});
