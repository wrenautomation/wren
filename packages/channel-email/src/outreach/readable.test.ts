/** Stored values made sentence-ready, or refused. */
import { describe, expect, it } from "vitest";
import {
  readableCompany,
  readableCount,
  readableMoney,
  readablePersonName,
  readableTitle,
  TITLE_MAX_CHARS,
} from "./readable.js";

const cases = (
  name: string,
  fn: (v: unknown) => string | null,
  table: [unknown, string | null][],
) =>
  describe(name, () => {
    for (const [filed, expected] of table) {
      it(`${String(filed)} -> ${String(expected)}`, () => expect(fn(filed)).toBe(expected));
    }
  });

describe("anything already cased is returned untouched", () => {
  for (const value of [
    "Joshua Kirk Gibbs",
    "Hays Financial Group, LLC",
    "Chief Compliance Officer",
    "iShares Core",
  ]) {
    it(value, () => {
      expect(readablePersonName(value)).toBe(value);
      expect(readableCompany(value)).toBe(value);
      expect(readableTitle(value)).toBe(value);
    });
  }
});

cases("legal entity forms survive as themselves", readableCompany, [
  ["HAYS FINANCIAL GROUP, LLC", "Hays Financial Group, LLC"],
  ["FORESIGHT CAPITAL ADVISORS, INC.", "Foresight Capital Advisors, Inc."],
  ["GRADIENT RIDGE CAPITAL, L.P.", "Gradient Ridge Capital, L.P."],
  ["WATERWAY WEALTH, L.L.C.", "Waterway Wealth, L.L.C."],
  ["HLM MANAGEMENT CO., LLC", "HLM Management Co., LLC"],
  ["BULLDOG INVESTORS, LLP", "Bulldog Investors, LLP"],
]);
cases("short tokens are read as initialisms", readableCompany, [
  ["BCWM", "BCWM"],
  ["IMS CAPITAL MANAGEMENT", "IMS Capital Management"],
  ["AO WEALTH ADVISORY", "AO Wealth Advisory"],
  ["NW1 PARTNERS", "NW1 Partners"],
  ["UNIGESTION (US) LTD", "Unigestion (US) Ltd"],
  ["J.P. MORGAN PRIVATE WEALTH", "J.P. Morgan Private Wealth"],
]);
cases("common short words beat the initialism rule", readableCompany, [
  ["RED ARTS CAPITAL, LLC", "Red Arts Capital, LLC"],
  ["OAK WEALTH ADVISORS", "Oak Wealth Advisors"],
  ["NEW DAY CAPITAL", "New Day Capital"],
]);
cases("a hyphen is inside the word", readableCompany, [
  ["MID-AMERICAN WEALTH ADVISORY", "Mid-American Wealth Advisory"],
  ["OAK-TREE PARTNERS", "Oak-Tree Partners"],
  ["STRATEGIC ADVISOR / CO-FOUNDER", "Strategic Advisor / Co-Founder"],
]);
cases("titles keep initialisms and lowercase joiners", readableTitle, [
  ["CHIEF COMPLIANCE OFFICER", "Chief Compliance Officer"],
  ["CCO", "CCO"],
  ["MANAGING DIRECTOR / CFO / CCO", "Managing Director / CFO / CCO"],
  ["MANAGING MEMBER/CHIEF COMPLIANCE OFFICER", "Managing Member/Chief Compliance Officer"],
  ["PRESIDENT, CEO, AND CHIEF COMPLIANCE OFFICER", "President, CEO, and Chief Compliance Officer"],
  ["VP OF COMPLIANCE", "VP of Compliance"],
  ["CHIEF COMPLIANCE OFFICER & COO", "Chief Compliance Officer & COO"],
]);
it("a joiner that opens the value is still capitalised", () => {
  expect(readableCompany("THE ASHFORD GROUP")).toBe("The Ashford Group");
});
cases("person names never take the initialism shortcut", readablePersonName, [
  ["KORI", "Kori"],
  ["ANN", "Ann"],
  ["LEE", "Lee"],
  ["MCDONALD", "McDonald"],
  ["O'BRIEN", "O'Brien"],
  ["D'AMICO", "D'Amico"],
  ["JEAN-LUC", "Jean-Luc"],
  ["SMITH JR", "Smith Jr."],
  ["VAN DER BERG", "Van der Berg"],
  ["B.J.", "B.J."],
  ["J.P.", "J.P."],
  ["A.M.J.", "A.M.J."],
]);
cases("a one-letter name refuses", readablePersonName, [
  ["A", null],
  ["A.", null],
  ["D", null],
  ["S", null],
  ["", null],
  ["   ", null],
  [null, null],
]);
cases("money reads the way a person would say it", readableMoney, [
  [342_000_000, "$342M"],
  [665_209_282, "$665M"],
  [1_234_192_870, "$1.2B"],
  [7_450_399_384, "$7.4B"],
  [1_950_000_000, "$1.9B"],
  [2_000_000_000, "$2B"],
  [1_500_000_000_000, "$1.5T"],
  [999_999_999, "$999M"],
  [83_253_573, "$83M"],
  [1_999_999, "$1M"],
  [450_000, "$450K"],
  [900, "$900"],
]);
cases("money refuses what it cannot state", readableMoney, [
  [null, null],
  [0, null],
  [-5, null],
  ["not a number", null],
  [true, null],
]);
cases("money accepts whatever the column hands it", readableMoney, [
  [342_000_000, "$342M"],
  [342_000_000.0, "$342M"],
  ["342000000", "$342M"],
  [342_000_000n, "$342M"],
]);
cases("an accented letter is a letter", readablePersonName, [
  ["JOSÉ", "José"],
  ["MÜLLER", "Müller"],
  ["ZOË", "Zoë"],
  ["FRANÇOIS", "François"],
  ["NÚÑEZ", "Núñez"],
  ["BJÖRN", "Björn"],
  ["ANNA-MARÍA", "Anna-María"],
  ["ŁUKASZ", "Łukasz"],
]);
it("an accented firm name is rebuilt whole too", () => {
  expect(readableCompany("CRÉDIT AGRICOLE ADVISORS")).toBe("Crédit Agricole Advisors");
  expect(readableCompany("NÚÑEZ WEALTH PARTNERS, LLC")).toBe("Núñez Wealth Partners, LLC");
});
it("dotted initials beat the suffix table", () => {
  expect(readablePersonName("I.V.")).toBe("I.V.");
  expect(readablePersonName("SMITH IV")).toBe("Smith IV");
  expect(readablePersonName("SMITH JR")).toBe("Smith Jr.");
});
it("a curly apostrophe is handled like a straight one", () => {
  expect(readablePersonName("O’BRIEN")).toBe("O’Brien");
});
describe("degenerate input comes back whole or refuses", () => {
  for (const value of ["...", "---", "&", "   ,   ", "401", "1-2-3"]) {
    it(JSON.stringify(value), () => {
      expect(readablePersonName(value)).toBeNull();
      for (const out of [readableCompany(value), readableTitle(value)]) {
        expect(out === null || out.length === value.trim().length).toBe(true);
      }
    });
  }
});
it("repeated and trailing separators survive untouched", () => {
  expect(readableCompany("SMITH  &  JONES ADVISORS, LLC")).toBe("Smith  &  Jones Advisors, LLC");
  expect(readableCompany("A--B PARTNERS")).toBe("A--B Partners");
});
cases("a count above zero reads as a person writes it", readableCount, [
  [238, "238"],
  [1, "1"],
  [7066, "7,066"],
  [23100, "23,100"],
  ["23100", "23,100"],
]);
cases("a count of zero refuses", readableCount, [
  [0, null],
  [-3, null],
  [null, null],
  ["", null],
  ["lots", null],
  [true, null],
]);
cases("the short words the band actually contains", readableCompany, [
  ["VAN KAMPEN ADVISORS", "Van Kampen Advisors"],
  ["LAS VEGAS WEALTH ADVISORS", "Las Vegas Wealth Advisors"],
  ["SAN DIEGO CAPITAL, LLC", "San Diego Capital, LLC"],
  ["MAN GROUP", "Man Group"],
  ["DEL MAR ASSET MANAGEMENT", "Del Mar Asset Management"],
  ["VAN ECK ASSOCIATES", "Van ECK Associates"],
  ["LOS ANGELES CAPITAL MANAGEMENT", "Los Angeles Capital Management"],
  ["USA WEALTH", "USA Wealth"],
  ["RIA ADVISORS", "RIA Advisors"],
]);
cases("singapore and australian entity forms", readableCompany, [
  ["ACME CAPITAL PTE. LTD.", "Acme Capital Pte. Ltd."],
  ["ACME CAPITAL PTY LTD", "Acme Capital Pty Ltd"],
]);
it("an accented short token is a word not an initialism", () => {
  expect(readableCompany("SÃO PAULO CAPITAL LTDA.")).toBe("São Paulo Capital Ltda.");
  expect(readableTitle("DIRECTOR, SÃO PAULO OFFICE")).toBe("Director, São Paulo Office");
});
it("a possessive keeps the Mc rule on its head", () => {
  expect(readableCompany("MCDONALD'S CAPITAL")).toBe("McDonald's Capital");
  expect(readableCompany("JONES' ADVISORS")).toBe("Jones' Advisors");
  expect(readablePersonName("O'BRIEN")).toBe("O'Brien");
});
it("a title too long for a sentence refuses however it is cased", () => {
  const long =
    "CHIEF COMPLIANCE OFFICER; TRUSTEE OF JEANNE HOISINGTON 2011 FAMILY TRUST;" +
    " TRUSTEE OF DAVID MAXWELL HOISINGTON 2011 FAMILY TRUST";
  expect(readableTitle(long)).toBeNull();
  expect(readableTitle(long.toLowerCase())).toBeNull();
  expect(readableTitle("X".repeat(TITLE_MAX_CHARS))).not.toBeNull();
  expect(readableTitle("EXECUTIVE VICE PRESIDENT, GENERAL COUNSEL, CHIEF COMPLIANCE OFFICER")).toBe(
    "Executive Vice President, General Counsel, Chief Compliance Officer",
  );
});
