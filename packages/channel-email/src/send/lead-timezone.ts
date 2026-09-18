/**
 * The lead's own clock: location text → IANA zone. Reads the "City, ST" shape
 * the niches store and answers with the zone that state or province keeps.
 * Never guesses: a city-only string, a company suffix caught as a place, a
 * lowercase or three-letter tail all come back null, and null means the fleet
 * window decides alone.
 */

// The last ", ST" of the text, and only an UPPERCASE two-letter tail.
const STATE_TAIL = /,\s*([A-Z]{2})\.?\s*$/;

const EASTERN = "America/New_York";
const CENTRAL = "America/Chicago";
const MOUNTAIN = "America/Denver";
const ARIZONA = "America/Phoenix";
const PACIFIC = "America/Los_Angeles";
const ALASKA = "America/Anchorage";
const HAWAII = "Pacific/Honolulu";

/** US states, DC and Puerto Rico, then the Canadian provinces. No code appears in both. */
export const ZONE_BY_REGION: Readonly<Record<string, string>> = Object.freeze({
  CT: EASTERN,
  DC: EASTERN,
  DE: EASTERN,
  FL: EASTERN,
  GA: EASTERN,
  IN: EASTERN,
  KY: EASTERN,
  MA: EASTERN,
  MD: EASTERN,
  ME: EASTERN,
  MI: EASTERN,
  NC: EASTERN,
  NH: EASTERN,
  NJ: EASTERN,
  NY: EASTERN,
  OH: EASTERN,
  PA: EASTERN,
  RI: EASTERN,
  SC: EASTERN,
  VA: EASTERN,
  VT: EASTERN,
  WV: EASTERN,
  AL: CENTRAL,
  AR: CENTRAL,
  IA: CENTRAL,
  IL: CENTRAL,
  KS: CENTRAL,
  LA: CENTRAL,
  MN: CENTRAL,
  MO: CENTRAL,
  MS: CENTRAL,
  ND: CENTRAL,
  NE: CENTRAL,
  OK: CENTRAL,
  SD: CENTRAL,
  TN: CENTRAL,
  TX: CENTRAL,
  WI: CENTRAL,
  CO: MOUNTAIN,
  ID: MOUNTAIN,
  MT: MOUNTAIN,
  NM: MOUNTAIN,
  UT: MOUNTAIN,
  WY: MOUNTAIN,
  AZ: ARIZONA,
  CA: PACIFIC,
  NV: PACIFIC,
  OR: PACIFIC,
  WA: PACIFIC,
  AK: ALASKA,
  HI: HAWAII,
  PR: "America/Puerto_Rico",
  ON: "America/Toronto",
  QC: "America/Toronto",
  NS: "America/Halifax",
  NB: "America/Halifax",
  PE: "America/Halifax",
  NL: "America/St_Johns",
  MB: "America/Winnipeg",
  SK: "America/Regina",
  AB: "America/Edmonton",
  BC: "America/Vancouver",
  YT: "America/Whitehorse",
  NT: "America/Yellowknife",
  NU: "America/Iqaluit",
});

/** The IANA zone a "City, ST" location keeps, or null when it names no known region. */
export function timezoneForLocation(location: string | null | undefined): string | null {
  if (!location) return null;
  const match = STATE_TAIL.exec(location);
  if (!match?.[1]) return null;
  return ZONE_BY_REGION[match[1]] ?? null;
}
