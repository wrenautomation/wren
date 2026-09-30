/** Recruiting's lead sources: which places are not staffing firms, and what gets registered. */
import type { OverturePlace } from "@wren/core";
import { describe, expect, it } from "vitest";
import {
  declineNonStaffing,
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
