/** Recruiting's lead sources: which places are not staffing firms, and what gets registered. */
import type { OverturePlace, ScreenedCompany } from "@wren/core";
import { describe, expect, it } from "vitest";
import {
  declineNonStaffing,
  declineRecruiting,
  GENERALIST_NAICS,
  RECRUITING_COUNTRIES,
  recruitingDatasets,
  recruitingLeadFormats,
  STAFFING_NAICS,
} from "./sources.js";

const named = (primary: string): OverturePlace => ({ names: { primary } });

describe("declineNonStaffing", () => {
  it.each([
    "goarmy.com",
    "navy.com",
    "airforce.com",
    "marines.com",
    "gocoastguard.com",
    "spaceforce.com",
    "nationalguard.com",
    "recruiting.goarmy.com",
    "ohionationalguard.com",
  ])("military host %s", (domain) => {
    expect(declineNonStaffing(named("Local Office"), domain)).toBe("military");
  });

  it.each([
    "U.S. Army Recruiting Station",
    "US Navy Recruiting",
    "Air Force Recruiting Office",
    "Marine Corps Recruiting Substation",
    "Army National Guard Recruiter",
    "Coast Guard Recruiting Office",
    "ARMY RESERVE CENTER",
  ])("military by name: %s", (name) => {
    expect(declineNonStaffing(named(name), null)).toBe("military");
    expect(declineNonStaffing(named(name), "somewhere.com")).toBe("military");
  });

  it.each([
    "Armada Staffing",
    "Navy Blue Consulting",
    "Marines Staffing Group",
    "Armstrong Search",
  ])("a military word alone, or none, keeps a firm: %s", (name) => {
    expect(declineNonStaffing(named(name), "firm.example")).toBeNull();
  });

  it("a host merely containing a service name is not military", () => {
    expect(declineNonStaffing(named("Navy Pier Events"), "navypier.com")).toBeNull();
    expect(declineNonStaffing(named("Go Army Staffing"), "goarmystaffing.com")).toBeNull();
  });

  it(".org without staffing words is a nonprofit job center", () => {
    expect(declineNonStaffing(named("Goodwill Career Center"), "goodwill.org")).toBe("nonprofit");
    expect(declineNonStaffing(named("Workforce Solutions"), "wfs.org")).toBe("nonprofit");
    expect(declineNonStaffing({}, "jobs.org")).toBe("nonprofit"); // no name at all
  });

  it.each([
    "Talent Bridge",
    "Premier Staffing",
    "Executive Search Partners",
    "Personnel Plus",
    "Recruiters Inc",
    "Placement Pros",
  ])(".org naming itself a staffing firm stays: %s", (name) => {
    expect(declineNonStaffing(named(name), "firm.org")).toBeNull();
  });

  it("a .com job center, or no domain, is not declined as a nonprofit", () => {
    expect(declineNonStaffing(named("Goodwill Career Center"), "goodwill.com")).toBeNull();
    expect(declineNonStaffing(named("Goodwill Career Center"), null)).toBeNull();
  });

  it("military wins over nonprofit", () => {
    expect(declineNonStaffing(named("Army Recruiting Station"), "armyfriends.org")).toBe(
      "military",
    );
  });

  it("names that are not strings are treated as blank", () => {
    expect(declineNonStaffing({ names: { primary: 42 } }, "x.org")).toBe("nonprofit");
    expect(declineNonStaffing({ names: "Army Recruiting" }, null)).toBeNull();
  });

  it("Canadian Armed Forces recruiting centre is military", () => {
    expect(declineNonStaffing(named("Canadian Armed Forces Recruiting Centre"), "forces.ca")).toBe(
      "military",
    );
  });
});

describe("registrations", () => {
  it("datasets: Overture places, SBA search, PPP loans", () => {
    expect(recruitingDatasets().map((d) => d.name)).toEqual([
      "overture-staffing",
      "sba-staffing",
      "ppp-staffing",
    ]);
  });

  it("formats: Overture file and SBA directory, both stamped recruiting", () => {
    expect(
      recruitingLeadFormats.map((f) => ({
        name: f.name,
        niche: f.niche,
        directory: f.directory,
        columnMapped: f.columnMapped,
      })),
    ).toEqual([
      { name: "overture-staffing", niche: "recruiting", directory: false, columnMapped: false },
      { name: "sba-staffing", niche: "recruiting", directory: true, columnMapped: false },
    ]);
  });

  it("every dataset name has a format or is the PPP sizing input", () => {
    const formats = new Set(recruitingLeadFormats.map((f) => f.name));
    for (const d of recruitingDatasets())
      expect(formats.has(d.name) || d.name === "ppp-staffing").toBe(true);
  });

  it("US and Canada; staffing NAICS leave PEOs out", () => {
    expect(RECRUITING_COUNTRIES).toEqual(["US", "CA"]);
    expect(STAFFING_NAICS).toEqual(["561311", "561312", "561320"]);
    expect(STAFFING_NAICS).not.toContain("561330");
  });
});

describe("declineRecruiting", () => {
  const firm = (name: string, raw: unknown = {}): ScreenedCompany => ({
    id: 1,
    domain: null,
    name,
    country: "US",
    raw,
  });

  it("job centers, charities and college offices by name", () => {
    expect(declineRecruiting(firm("American Job Center Largo"))).toBe("job_center");
    expect(declineRecruiting(firm("OhioMeansJobs Allen County"))).toBe("job_center");
    expect(declineRecruiting(firm("Workforce Solutions Greater Dallas"))).toBe("job_center");
    expect(declineRecruiting(firm("YMCA Employment Services"))).toBe("nonprofit");
    expect(declineRecruiting(firm("Algonquin College Employment Services"))).toBe("school");
  });

  it("a college's .edu site is a school, whatever the office calls itself", () => {
    const office = { ...firm("Student Employment Staffing"), domain: "employment.ku.edu" };
    expect(declineRecruiting(office)).toBe("school");
    expect(
      declineRecruiting({ ...firm("Edu Staffing LLC"), domain: "edustaffing.com" }),
    ).toBeNull();
  });

  it("a firm with an entity suffix or a staffing word stays", () => {
    for (const name of [
      "Acme Workforce Solutions",
      "Career Centers, LLC",
      "Goodwill Staffing LLC",
      "College Recruiter",
      "Mri Of University Circle",
      "Career Centered Staffing",
    ])
      expect(declineRecruiting(firm(name)), name).toBeNull();
  });

  it("an SBA generalist: 10+ codes and no staffing talk anywhere", () => {
    const codes = (n: number) => Array.from({ length: n }, (_, i) => String(561000 + i));
    const listing = (n: number, narrative = "") => ({
      sba: { naics_all_codes: codes(n), keywords: [], capabilities_narrative: narrative },
    });
    expect(declineRecruiting(firm("ACME HOLDINGS LLC", listing(GENERALIST_NAICS)))).toBe(
      "generalist",
    );
    expect(declineRecruiting(firm("ACME HOLDINGS LLC", listing(GENERALIST_NAICS - 1)))).toBeNull();
    expect(
      declineRecruiting(
        firm("ACME HOLDINGS LLC", listing(GENERALIST_NAICS, "IT staff augmentation")),
      ),
    ).toBeNull();
    // A nursing firm on a staffing code, or staffing talk in the domain, stays.
    expect(declineRecruiting(firm("ADVENTURE NURSING LLC", listing(GENERALIST_NAICS)))).toBeNull();
    expect(
      declineRecruiting({
        ...firm("BACKOFFICE INC", listing(GENERALIST_NAICS)),
        domain: "bgtalent.example",
      }),
    ).toBeNull();
  });
});
