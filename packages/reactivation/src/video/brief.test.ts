import type { Dossier } from "@wren/research/dossier";
import { describe, expect, it } from "vitest";
import { displayFirm, videoBrief } from "./brief.js";

describe("displayFirm", () => {
  it("drops legal suffixes, however written", () => {
    expect(displayFirm("Acme Staffing, Inc.")).toBe("Acme Staffing");
    expect(displayFirm("Acme Staffing LLC")).toBe("Acme Staffing");
    expect(displayFirm("Acme Search Group, L.L.C.")).toBe("Acme Search Group");
    expect(displayFirm("Acme Staffing Co., Ltd.")).toBe("Acme Staffing");
    expect(displayFirm("Placements Acme Ltée")).toBe("Placements Acme");
  });

  it("keeps a name that only ends like a suffix", () => {
    expect(displayFirm("Lincoln Search")).toBe("Lincoln Search");
    expect(displayFirm("The Incorporated Group of Firms")).toBe("The Incorporated Group of Firms");
  });

  it("title-cases ALL CAPS, keeping short acronyms and lowering small words", () => {
    expect(displayFirm("ACME STAFFING SERVICES, INC.")).toBe("Acme Staffing Services");
    expect(displayFirm("ABC SEARCH OF THE MIDWEST")).toBe("ABC Search of the Midwest");
    expect(displayFirm("O'BRIEN-SMITH STAFFING")).toBe("O'Brien-Smith Staffing");
  });

  it("leaves a mixed-case name as the firm wrote it", () => {
    expect(displayFirm("  TalentWorks   HR ")).toBe("TalentWorks HR");
    expect(displayFirm("iRecruit")).toBe("iRecruit");
  });

  it("is null when no word is left", () => {
    expect(displayFirm("LLC")).toBeNull();
    expect(displayFirm("123 456")).toBeNull();
    expect(displayFirm("  ")).toBeNull();
  });
});

const dossier = (name: string | null): Dossier => ({
  company: { id: 7, name, domain: "acme.com", niche: "recruiting", country: "US", timezone: null },
  facts: [],
  people: [],
});

describe("videoBrief", () => {
  it("is the tidied name", () => {
    expect(videoBrief(dossier("ACME STAFFING LLC"))).toEqual({
      companyId: 7,
      firm: "Acme Staffing",
      domain: "acme.com",
    });
  });

  it("says why there is no video rather than guess", () => {
    expect(videoBrief(dossier(null))).toEqual({ skip: "no name on file" });
    expect(videoBrief(dossier("INC."))).toHaveProperty("skip");
    expect(
      videoBrief(dossier("The Very Long Named Recruiting and Staffing Partners of America")),
    ).toHaveProperty("skip");
  });
});
