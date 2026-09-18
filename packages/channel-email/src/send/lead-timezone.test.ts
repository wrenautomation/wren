/** The lead's own clock: location text → IANA zone, never a guess. */
import { describe, expect, it } from "vitest";
import { timezoneForLocation, ZONE_BY_REGION } from "./lead-timezone.js";
import { canonicalZone } from "./tz.js";

describe("timezoneForLocation", () => {
  it.each([
    ["New York, NY", "America/New_York"],
    ["Austin, TX", "America/Chicago"],
    ["Denver, CO", "America/Denver"],
    ["Phoenix, AZ", "America/Phoenix"],
    ["Los Angeles, CA", "America/Los_Angeles"],
    ["Anchorage, AK", "America/Anchorage"],
    ["Honolulu, HI", "Pacific/Honolulu"],
    ["Washington, DC", "America/New_York"],
    ["Toronto, ON", "America/Toronto"],
    ["Vancouver, BC", "America/Vancouver"],
    ["Miami, FL", "America/New_York"],
    ["Nashville, TN", "America/Chicago"],
    ["Louisville, KY", "America/New_York"],
  ])("a city-state pair names its zone (%s)", (location, zone) => {
    expect(timezoneForLocation(location)).toBe(zone);
  });

  it.each([
    null,
    "",
    "   ",
    "Austin, United States",
    "London",
    "London, United Kingdom",
    "ANML, Inc.",
    "Acme, LLC",
    "Smith & Co",
    "Smith, Co",
    "Somewhere, XX",
    "Paris, TX, Inc.",
  ])("anything else is unknown, not guessed (%s)", (location) => {
    expect(timezoneForLocation(location)).toBeNull();
  });

  it("whitespace and a trailing period are tolerated", () => {
    expect(timezoneForLocation("  Chicago,IL  ")).toBe("America/Chicago");
    expect(timezoneForLocation("Chicago, IL.")).toBe("America/Chicago");
  });

  it("the tail is the last comma part", () => {
    expect(timezoneForLocation("Portland, Multnomah, OR")).toBe("America/Los_Angeles");
  });

  it("every region names a real zone", () => {
    for (const [region, zone] of Object.entries(ZONE_BY_REGION)) {
      expect(region).toMatch(/^[A-Z]{2}$/);
      expect(canonicalZone(zone)).not.toBeNull();
    }
  });
});
