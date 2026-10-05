/** Stored values made sentence-ready, or refused. */
import { describe, expect, it } from "vitest";
import {
  readableCompany,
  readableCount,
  readableMoney,
  readablePersonName,
  readableTitle,
  shortCompany,
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
    "Hays Financial Group",
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

cases("a firm is named without its legal form", readableCompany, [
  ["HAYS FINANCIAL GROUP, LLC", "Hays Financial Group"],
  ["FORESIGHT CAPITAL ADVISORS, INC.", "Foresight Capital Advisors"],
  ["GRADIENT RIDGE CAPITAL, L.P.", "Gradient Ridge Capital"],
  ["WATERWAY WEALTH, L.L.C.", "Waterway Wealth"],
  ["HLM MANAGEMENT CO., LLC", "HLM Management Co."],
  ["BULLDOG INVESTORS, LLP", "Bulldog Investors"],
  ["Catapult Recruiting LLC", "Catapult Recruiting"],
  ["Omni Healthcare Staffing, Inc.", "Omni Healthcare Staffing"],
  ["Flexible Pharmacy Staffing, PLLC", "Flexible Pharmacy Staffing"],
  ["Venus Solutions Limited Liability Company", "Venus Solutions"],
  ["Allpro Staffnet Limited-Liability Company", "Allpro Staffnet"],
  ["The Robinson Group, Ltd.", "The Robinson Group"],
  ["Acme Search Pte. Ltd.", "Acme Search"],
  ["Smith & Co.", "Smith & Co."],
  ["Rightclick Recruiting", "Rightclick Recruiting"],
  ["Polish, LLC", "Polish"],
  ["LLC", "LLC"],
  ["LANE STAFFING INC A CORP", "Lane Staffing"],
  ["EXCLUSIVE STAFFING LLC A CORP", "Exclusive Staffing"],
  ["CLASS A JOBS 411", "Class A Jobs 411"],
]);
cases("a firm is named without its tagline or brackets", readableCompany, [
  ["Career Personnel, Inc. -- the Professional Difference", "Career Personnel"],
  ["Acme Staffing | People First", "Acme Staffing"],
  ["Free Market Talent Hub (FMTH)", "Free Market Talent Hub"],
  ["Mid-Valley Interim Health Care Services Inc", "Mid-Valley Interim Health Care Services"],
]);
cases("a firm filed in lowercase is cased", readableCompany, [
  ["staffing fish, llc", "Staffing Fish"],
  ["abc talent partners", "ABC Talent Partners"],
]);
cases("short tokens are read as initialisms", readableCompany, [
  ["BCWM", "BCWM"],
  ["IMS CAPITAL MANAGEMENT", "IMS Capital Management"],
  ["AO WEALTH ADVISORY", "AO Wealth Advisory"],
  ["NW1 PARTNERS", "NW1 Partners"],
  ["UNIGESTION (US) LTD", "Unigestion"],
  ["J.P. MORGAN PRIVATE WEALTH", "J.P. Morgan Private Wealth"],
]);
cases("common short words beat the initialism rule", readableCompany, [
  ["RED ARTS CAPITAL, LLC", "Red Arts Capital"],
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
cases("a name filed in lowercase is cased", readablePersonName, [
  ["rona", "Rona"],
  ["mary-kate", "Mary-Kate"],
  ["o'neil", "O'Neil"],
]);
cases("a suffix filed as the whole name refuses", readablePersonName, [
  ["II", null],
  ["Jr.", null],
  ["III", null],
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
  expect(readableCompany("NÚÑEZ WEALTH PARTNERS, LLC")).toBe("Núñez Wealth Partners");
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
  expect(readableCompany("SMITH  &  JONES ADVISORS, LLC")).toBe("Smith  &  Jones Advisors");
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
  ["SAN DIEGO CAPITAL, LLC", "San Diego Capital"],
  ["MAN GROUP", "Man Group"],
  ["DEL MAR ASSET MANAGEMENT", "Del Mar Asset Management"],
  ["VAN ECK ASSOCIATES", "Van ECK Associates"],
  ["LOS ANGELES CAPITAL MANAGEMENT", "Los Angeles Capital Management"],
  ["USA WEALTH", "USA Wealth"],
  ["RIA ADVISORS", "RIA Advisors"],
]);
cases("singapore and australian entity forms", readableCompany, [
  ["ACME CAPITAL PTE. LTD.", "Acme Capital"],
  ["ACME CAPITAL PTY LTD", "Acme Capital"],
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

cases("a firm is called what a person would say, not what a listing prints", shortCompany, [
  ["Briggs and Associates", "Briggs"],
  ["Briggs & Associates, LLC", "Briggs"],
  ["Mavic Group", "Mavic"],
  ["Wander Staffing", "Wander"],
  ["Aero Medical Group", "Aero"],
  ["Grove Technical Resources", "Grove"],
  ["Superior Resource Specialists", "Superior Resource Specialists"],
  ["The Premier Staffing Group of Texas", "Premier Staffing Group of Texas"],
  ["Medical Staffing Network", "Medical Staffing Network"],
  ["Staffing Solutions", "Staffing Solutions"],
  ["Premier Staffing", "Premier Staffing"],
  ["Smith & Jones Staffing", "Smith & Jones"],
  ["Insight Global", "Insight"],
  ["Robert Half", "Robert Half"],
  ["Lucrative Staffing", "Lucrative Staffing"],
  ["Overflowing Talent Solutions", "Overflowing Talent Solutions"],
  ["KFORCE INC", "Kforce"],
  ["ASSERTIVE STAFFING SERVICES INC", "Assertive Staffing Services"],
  ["", null],
  [null, null],
]);
