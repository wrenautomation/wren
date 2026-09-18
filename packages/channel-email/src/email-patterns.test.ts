import { describe, expect, it } from "vitest";
import { applyPattern, inferPattern, nameToken, PATTERNS } from "./email-patterns.js";

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
