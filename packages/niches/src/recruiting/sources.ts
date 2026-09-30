/**
 * Where recruiting leads come from (designs/2026-09-30-recruiting-lead-sources.md):
 * free public data, US and Canada only. Core owns the readers; this file only says
 * which categories, which countries, and which places are not staffing firms.
 */
import { type OverturePlace, overtureFormat, type PlaceDecline, sbaSearchFormat } from "@wren/core";
import { overturePlaces, pppLoans, sbaSearch } from "@wren/research/fetch";

export const RECRUITING_COUNTRIES = ["US", "CA"] as const;

/** Overture `taxonomy.primary` for staffing and recruiting firms. */
export const STAFFING_PLACE_CATEGORIES = ["employment_agency", "temp_agency"] as const;

/** A domain at this many open places or more is a chain (core's default is 3). */
export const RECRUITING_CHAIN_AT = 11;

/** NAICS for placement, executive search and temp staffing. 561330 (PEOs) is left out: payroll, not recruiting. */
export const STAFFING_NAICS = ["561311", "561312", "561320"] as const;

const MILITARY_HOST =
  /(^|\.)(navy|airforce|goarmy|marines|gocoastguard|nationalguard|spaceforce)\.com$|nationalguard\.com$|(^|\.)forces\.ca$/;
const MILITARY_WORD =
  /\b(army|navy|air force|marines?|marine corps|national guard|coast guard|space force|armed forces|canadian forces)\b/i;
const MILITARY_OFFICE = /recruit|station|reserve|enlist|career center/i;
const STAFFING_WORD = /staff|recruit|search|talent|personnel|placement/i;

const placeName = (place: OverturePlace): string => {
  const names = place.names;
  const primary =
    typeof names === "object" && names !== null ? (names as Record<string, unknown>).primary : null;
  return typeof primary === "string" ? primary : "";
};

/**
 * Overture files military recruiting offices and nonprofit job centers as
 * employment agencies. Neither buys. A .org that names itself a staffing firm stays.
 */
export const declineNonStaffing: PlaceDecline = (place, domain) => {
  const name = placeName(place);
  if (
    (domain && MILITARY_HOST.test(domain)) ||
    (MILITARY_WORD.test(name) && MILITARY_OFFICE.test(name))
  )
    return "military";
  if (domain?.endsWith(".org") && !STAFFING_WORD.test(name)) return "nonprofit";
  return null;
};

export const recruitingDatasets = () => [
  overturePlaces({
    name: "overture-staffing",
    description:
      "Overture Maps staffing and recruiting places, US + CA → import --format overture-staffing",
    categories: STAFFING_PLACE_CATEGORIES,
    countries: RECRUITING_COUNTRIES,
  }),
  sbaSearch({
    name: "sba-staffing",
    description:
      "SBA Small Business Search firms listing a staffing NAICS, one file per code → import --format sba-staffing <dir>",
    naics: STAFFING_NAICS,
  }),
  pppLoans({
    name: "ppp-staffing",
    description:
      "SBA PPP loans of staffing firms (jobs, payroll) → wren email size <dir> --niche recruiting",
    naics: STAFFING_NAICS,
  }),
];

export const recruitingLeadFormats = [
  overtureFormat({
    name: "overture-staffing",
    help: "Overture places JSON lines from `wren fetch get overture-staffing` (chains, closed, public, military, nonprofit declined)",
    niche: "recruiting",
    // 3 to 10 offices is a regional firm the owner still runs; 11+ is a national brand or franchise network.
    chainAt: RECRUITING_CHAIN_AT,
    decline: declineNonStaffing,
  }),
  sbaSearchFormat({
    name: "sba-staffing",
    help: "SBA search answers from `wren fetch get sba-staffing` (a directory; firms whose primary NAICS isn't staffing declined)",
    niche: "recruiting",
    naics: STAFFING_NAICS,
  }),
];
