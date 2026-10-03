import { describe, expect, it } from "vitest";
import {
  applyPattern,
  inferPattern,
  nameFromLocalPart,
  nameToken,
  PATTERNS,
} from "./email-patterns.js";

describe("nameToken", () => {
  it("lowercases, strips, folds accents; empty is null", () => {
    expect(nameToken("O'Brien-Smith")).toBe("obriensmith");
    expect(nameToken("Núñez")).toBe("nunez");
    expect(nameToken("")).toBeNull();
    expect(nameToken(null)).toBeNull();
    expect(nameToken("...")).toBeNull();
  });
});

describe("applyPattern", () => {
  it("renders names and initials", () => {
    expect(applyPattern("{first}.{last}", "Jane", "Doe")).toBe("jane.doe");
    expect(applyPattern("{f}{last}", "Jane", "Doe")).toBe("jdoe");
    expect(applyPattern("{f}.{last}", "Jane", "Doe")).toBe("j.doe");
  });
  it("missing required name is null; first-only survives a missing last", () => {
    expect(applyPattern("{first}.{last}", "Jane", null)).toBeNull();
    expect(applyPattern("{last}", null, null)).toBeNull();
    expect(applyPattern("{first}", "Jane", null)).toBe("jane");
  });
});

describe("inferPattern", () => {
  it("round-trips every pattern", () => {
    for (const p of PATTERNS) {
      const local = applyPattern(p, "Jane", "Doe");
      expect(local).not.toBeNull();
      expect(inferPattern(local as string, "Jane", "Doe")).toBe(p);
    }
  });
  it("unknown shape is null; case-insensitive", () => {
    expect(inferPattern("jd123", "Jane", "Doe")).toBeNull();
    expect(inferPattern("Jane.Doe", "Jane", "Doe")).toBe("{first}.{last}");
  });
});

describe("nameFromLocalPart", () => {
  it("reads first.last and first_last as a name", () => {
    expect(nameFromLocalPart("jane.doe", "acme.com")).toEqual({
      firstName: "Jane",
      lastName: "Doe",
    });
    expect(nameFromLocalPart("Jane_Doe", "www.acme.com")).toEqual({
      firstName: "Jane",
      lastName: "Doe",
    });
  });
  it("refuses desks, initials without vowels, the domain's own words and other shapes", () => {
    for (const local of [
      "sales.team",
      "alexis.manager",
      "dt.cadres",
      "acme.uk",
      "jdoe",
      "j.doe",
      "jane.doe2",
    ]) {
      expect(nameFromLocalPart(local, "acme.com")).toBeNull();
    }
  });
});
