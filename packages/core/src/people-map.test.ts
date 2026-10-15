import { describe, expect, it } from "vitest";
import { countHits, isWatchPage, personaOf, roleOf, sizeOf } from "./people-map.js";

describe("persona rules", () => {
  it("reads a role from a title", () => {
    expect(roleOf("Founder & CEO")).toBe("owner");
    expect(roleOf("Owner")).toBe("owner");
    expect(roleOf("Vice President, Sales")).toBe("executive");
    expect(roleOf("CFO")).toBe("executive");
    expect(roleOf("Director of Ops")).toBe("executive");
    expect(roleOf("Office Manager")).toBe("manager");
    expect(roleOf("Recruiter")).toBe("staff");
    expect(roleOf("  ")).toBe("unknown");
    expect(roleOf(null)).toBe("unknown");
  });

  it("buckets a headcount", () => {
    expect([1, 2, 9, 10, 49, 50, 0, null].map((n) => sizeOf(n))).toEqual([
      "solo",
      "small",
      "small",
      "mid",
      "mid",
      "large",
      "unknown",
      "unknown",
    ]);
  });

  it("names a persona by what's known", () => {
    expect(personaOf("agencies", "owner")).toBe("agencies owner");
    expect(personaOf("unknown", "owner")).toBe("owner");
    expect(personaOf("unknown", "unknown")).toBe("unknown");
  });
});

describe("site counts", () => {
  it("counts pages and watch pages apart", () => {
    expect(isWatchPage("/watch/offer")).toBe(true);
    expect(isWatchPage("/v/abc")).toBe(true);
    expect(isWatchPage("/video")).toBe(false);
    const c = countHits([
      { ts: "2026-10-02T12:00:00Z", page: "/" },
      { ts: "2026-10-04T12:00:00Z", page: "/v/abc" },
      { ts: "2026-10-03T12:00:00Z", page: "/pricing" },
      { ts: "not a time", page: "/" },
    ]);
    expect(c.visits).toBe(3);
    expect(c.visitFirst?.toISOString()).toBe("2026-10-02T12:00:00.000Z");
    expect(c.visitLast?.toISOString()).toBe("2026-10-04T12:00:00.000Z");
    expect(c.watches).toBe(1);
  });
});
