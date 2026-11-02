/**
 * The lead's own clock: location text → IANA zone. Reads the "City, ST" shape
 * the niches store and answers with the zone that state or province keeps.
 * Never guesses: a city-only string, a company suffix caught as a place, a
 * lowercase or three-letter tail all come back null, and null means the fleet
 * window decides alone.
 */

import { type Company, companies } from "@wren/core";
import type { Queryable } from "@wren/db";
import { and, eq, isNull } from "drizzle-orm";

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

export interface TimezoneFillStats {
  /** Companies of the niche with no zone yet, looked at this pass. */
  candidates: number;
  resolved: number;
  /** Location text the table does not read, or none stored; the fleet window decides for these. */
  unresolved: number;
}

/**
 * Fill `companies.timezone` for every company of `niche` still without one, from the
 * location text the niche reads off the source row. Idempotent; a company whose text
 * resolves to nothing stays null and is looked at again next pass (cheap, and a later
 * sighting may carry a better location). Run before compose so the lead window has a
 * clock for every new enrollment.
 */
export async function fillTimezones(
  db: Queryable,
  opts: { niche: string; locationOf: (company: Company) => string | null },
): Promise<TimezoneFillStats> {
  const rows = await db
    .select()
    .from(companies)
    .where(and(eq(companies.niche, opts.niche), isNull(companies.timezone)));
  const stats: TimezoneFillStats = { candidates: rows.length, resolved: 0, unresolved: 0 };
  for (const company of rows) {
    const zone = timezoneForLocation(opts.locationOf(company));
    if (zone === null) {
      stats.unresolved++;
      continue;
    }
    await db.update(companies).set({ timezone: zone }).where(eq(companies.id, company.id));
    stats.resolved++;
  }
  return stats;
}
