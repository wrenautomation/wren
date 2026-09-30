import { describe, expect, it } from "vitest";
import { currencyOf, formatCents, formatMoney, parseCents, printedCents, toCad } from "./money.js";

describe("parseCents", () => {
  it("reads amounts as printed", () => {
    expect(parseCents("$1,234.56")).toBe(123456);
    expect(parseCents("CA$7.00")).toBe(700);
    expect(parseCents("10")).toBe(1000);
    expect(parseCents("147.00 CAD")).toBe(14700);
  });

  it("reads negatives however they are printed", () => {
    expect(parseCents("-$5.00")).toBe(-500);
    expect(parseCents("−5.00")).toBe(-500);
    expect(parseCents("($5.00)")).toBe(-500);
  });

  it("rounds a third decimal half up, and is null with no number", () => {
    expect(parseCents("$7.005")).toBe(701);
    expect(parseCents("$7.004")).toBe(700);
    expect(parseCents("free")).toBeNull();
  });
});

describe("printedCents", () => {
  it("finds every number, with or without thousands commas, unsigned", () => {
    const found = printedCents("Total $1,234.56 (was 1234.56), credit -5");
    expect(found.has(123456)).toBe(true);
    expect(found.has(500)).toBe(true);
    expect(found.has(-500)).toBe(false);
  });
});

describe("currencyOf", () => {
  it("names the currency a mark or code pins, null for a bare $", () => {
    expect(currencyOf("CA$147.00")).toBe("CAD");
    expect(currencyOf("147.00 CAD")).toBe("CAD");
    expect(currencyOf("US$10.98")).toBe("USD");
    expect(currencyOf("€5")).toBe("EUR");
    expect(currencyOf("$5.00")).toBeNull();
  });
});

describe("formatting", () => {
  it("prints cents with thousands and sign", () => {
    expect(formatCents(123456)).toBe("1,234.56");
    expect(formatCents(-500)).toBe("-5.00");
    expect(formatCents(7)).toBe("0.07");
    expect(formatMoney(14700, "CAD")).toBe("147.00 CAD");
  });
});

describe("toCad", () => {
  it("converts exactly, rounding half away from zero", () => {
    expect(toCad(10000, "1.37500000")).toBe(13750);
    expect(toCad(1, "1.5")).toBe(2);
    expect(toCad(-1, "1.5")).toBe(-2);
    expect(toCad(333, "1.3333")).toBe(444);
    expect(toCad(14700, "1")).toBe(14700);
  });
});
