import { describe, expect, it } from "vitest";
import {
  matchKey,
  type PersonRowInput,
  parseDirectName,
  parseInvertedName,
  personRow,
  smartCase,
} from "./schema.js";

describe("smartCase", () => {
  it("all-upper titles", () => expect(smartCase("NESS")).toBe("Ness"));
  it("all-lower titles", () => expect(smartCase("suresh")).toBe("Suresh"));
  it("mixed case is the filer's claim", () => expect(smartCase("VanWinkle")).toBe("VanWinkle"));
  it("apostrophes and hyphens get per-run caps", () =>
    expect(smartCase("O'BRIEN-SMITH")).toBe("O'Brien-Smith"));
});

describe("parseInvertedName", () => {
  it("last, first, middle", () =>
    expect(parseInvertedName("NESS, BRIAN, STEVEN")).toEqual([
      "Brian Steven Ness",
      "Brian",
      "Ness",
    ]));
  it("two-word last name", () =>
    expect(parseInvertedName("ROBINSON SAATHOFF, DANNA, M")).toEqual([
      "Danna M Robinson Saathoff",
      "Danna",
      "Robinson Saathoff",
    ]));
  it("lowercase filing", () =>
    expect(parseInvertedName("suresh, nisha, R")).toEqual(["Nisha R Suresh", "Nisha", "Suresh"]));
  it("no comma falls through to direct", () =>
    expect(parseInvertedName("KORI CUSICK")).toEqual(["Kori Cusick", "Kori", "Cusick"]));
  it("empty is null", () => expect(parseInvertedName("  ")).toBeNull());
});

describe("parseDirectName", () => {
  it("first last", () =>
    expect(parseDirectName("KORI CUSICK")).toEqual(["Kori Cusick", "Kori", "Cusick"]));
  it("suffix kept in full, dropped for last", () =>
    expect(parseDirectName("JOHN V. BOARDMAN III")).toEqual([
      "John V. Boardman Iii",
      "John",
      "Boardman",
    ]));
  it("single token", () =>
    expect(parseDirectName("MADONNA")).toEqual(["Madonna", "Madonna", null]));
});

describe("matchKey", () => {
  it("first+last beats middle-name noise", () =>
    expect(matchKey("Kori", "Cusick", "Kori Ann Cusick")).toBe(
      matchKey("Kori", "Cusick", "Kori Cusick"),
    ));
  it("falls back to full name", () =>
    expect(matchKey(null, null, "Kori  CUSICK")).toBe("kori cusick"));
});

describe("personRow", () => {
  const row = (overrides: Partial<PersonRowInput> = {}) =>
    personRow({
      companySourceKey: "crd:1",
      fullName: "Jane Doe",
      origin: "registry",
      originRef: "test",
      raw: {},
      ...overrides,
    });
  it("company identity required", () =>
    expect(() => row({ companySourceKey: null })).toThrow(/company source_key or domain/));
  it("company domain is enough", () =>
    expect(row({ companySourceKey: null, companyDomain: "firm.example" }).companyDomain).toBe(
      "firm.example",
    ));
  it("blank name rejected", () => expect(() => row({ fullName: "   " })).toThrow(/empty name/));
  it("overlong source key rejected", () =>
    expect(() => row({ sourceKey: `crd-ind:${"9".repeat(64)}` })).toThrow(/longer than 64/));
  it("overlong linkedin url is clipped", () =>
    expect(row({ linkedinUrl: "x".repeat(600) }).linkedinUrl).toHaveLength(512));
});
