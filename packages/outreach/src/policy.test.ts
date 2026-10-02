import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  daysBetween,
  fleetDay,
  inWindow,
  parseClock,
  standingOf,
} from "./policy.js";

// A Thursday, 14:00 New York (EDT = UTC-4).
const THU_2PM = new Date("2026-10-01T18:00:00Z");

describe("parseClock", () => {
  it("reads hh:mm", () => {
    expect(parseClock("10:00")).toBe(600);
    expect(parseClock("9:30")).toBe(570);
  });
  it("refuses nonsense", () => {
    expect(() => parseClock("25:00")).toThrow();
    expect(() => parseClock("ten")).toThrow();
  });
});

describe("inWindow", () => {
  it("is open on a weekday afternoon", () => {
    expect(inWindow(THU_2PM, DEFAULT_POLICY)).toBe(true);
  });
  it("is shut at night and on weekends", () => {
    expect(inWindow(new Date("2026-10-02T03:00:00Z"), DEFAULT_POLICY)).toBe(false); // Thu 23:00 NY
    expect(inWindow(new Date("2026-10-03T18:00:00Z"), DEFAULT_POLICY)).toBe(false); // Saturday
  });
  it("end is exclusive", () => {
    expect(inWindow(new Date("2026-10-01T21:00:00Z"), DEFAULT_POLICY)).toBe(false); // 17:00
    expect(inWindow(new Date("2026-10-01T20:59:00Z"), DEFAULT_POLICY)).toBe(true);
  });
});

describe("fleetDay", () => {
  it("counts in New York, not UTC", () => {
    expect(fleetDay(new Date("2026-10-02T03:00:00Z"))).toBe("2026-10-01");
    expect(daysBetween("2026-09-01", "2026-10-01")).toBe(30);
  });
});

describe("standingOf", () => {
  it("reddit with no health read is frozen at lurk", () => {
    const s = standingOf(
      { platform: "reddit", startedOn: "2026-09-01", health: null },
      DEFAULT_POLICY,
      THU_2PM,
    );
    expect(s.frozen).toMatch(/no health/);
    expect(s.caps.messages).toBe(0);
  });
  it("reddit on the ladder's top is capped by policy too", () => {
    const s = standingOf(
      {
        platform: "reddit",
        startedOn: "2026-08-01",
        health: {
          handle: "x",
          createdAt: "2026-08-01T00:00:00Z",
          karma: 500,
          suspended: false,
          acceptsMessages: true,
          raw: {},
          asOf: THU_2PM.toISOString(),
        },
      },
      { ...DEFAULT_POLICY, reddit: { messagesPerDay: 2 } },
      THU_2PM,
    );
    expect(s.frozen).toBeNull();
    expect(s.caps.messages).toBe(2);
  });
  it("linkedin ramps weekly to the cap", () => {
    const day0 = standingOf(
      { platform: "linkedin", startedOn: "2026-10-01", health: null },
      DEFAULT_POLICY,
      THU_2PM,
    );
    expect(day0.caps).toEqual({ connects: 5, messages: 20 });
    const week3 = standingOf(
      { platform: "linkedin", startedOn: "2026-09-10", health: null },
      DEFAULT_POLICY,
      THU_2PM,
    );
    expect(week3.caps.connects).toBe(20);
    const year = standingOf(
      { platform: "linkedin", startedOn: "2025-10-01", health: null },
      DEFAULT_POLICY,
      THU_2PM,
    );
    expect(year.caps.connects).toBe(20);
  });
  it("a suspended linkedin account is frozen", () => {
    const s = standingOf(
      {
        platform: "linkedin",
        startedOn: "2026-09-01",
        health: {
          handle: "x",
          createdAt: null,
          karma: null,
          suspended: true,
          acceptsMessages: null,
          raw: {},
          asOf: "",
        },
      },
      DEFAULT_POLICY,
      THU_2PM,
    );
    expect(s.frozen).toBe("suspended");
  });
});
