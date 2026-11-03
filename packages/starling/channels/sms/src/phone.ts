/**
 * Phone numbers as E.164. Published numbers are US only (`@wren/research/phones`
 * reads them off pages). A person who gives us their number
 * (a form, a hand-add) may be US or Canadian: one +1 plan, two countries, and
 * each country is texted from a number of its own (`cannotReach` in pool.ts).
 * A site applicant may also be from another country the form allows
 * (`WREN_SMS_FORM_COUNTRIES`): texted from a US number, on their own clock.
 *
 * NANP numbers carry no mobile/landline bit (a US number is "fixed line or
 * mobile" by its digits), so the line type comes from a carrier lookup, never
 * from here. Toll-free is the one type the digits do say.
 */
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { PHONE_COUNTRIES, type PhoneCountry } from "./schema.js";

export { isTollFree, toUsE164 } from "@wren/research/phones";

export const E164 = /^\+[1-9][0-9]{7,14}$/;

function parse(raw: string) {
  const text = raw.trim();
  return text ? parsePhoneNumberFromString(text, "US") : undefined;
}

/** The E.164 form of a valid number in `countries` (US or Canada unless named), or null. */
export function toPhoneE164(
  raw: string,
  countries: readonly string[] = PHONE_COUNTRIES,
): string | null {
  const parsed = parse(raw);
  if (!parsed?.isValid() || !countries.includes(parsed.country ?? "")) return null;
  return parsed.number;
}

/** The ISO country of any valid number ("IN" for +91…), else null. */
export function phoneCountry(raw: string): string | null {
  const parsed = parse(raw);
  return parsed?.isValid() ? (parsed.country ?? null) : null;
}

/**
 * Countries on one clock, so a number's country names its zone. The US and Canada span
 * several: theirs stays null (both US coasts must be open). Add one here before allowing it.
 */
export const COUNTRY_ZONES: Readonly<Record<string, string>> = {
  IN: "Asia/Kolkata",
  GB: "Europe/London",
  IE: "Europe/Dublin",
  DE: "Europe/Berlin",
  FR: "Europe/Paris",
  NL: "Europe/Amsterdam",
  ES: "Europe/Madrid",
  IT: "Europe/Rome",
  PH: "Asia/Manila",
  PK: "Asia/Karachi",
  SG: "Asia/Singapore",
  AE: "Asia/Dubai",
  NZ: "Pacific/Auckland",
  ZA: "Africa/Johannesburg",
};

/** The zone a number's country names: null for US and Canada (several zones) and unknowns. */
export const zoneOfPhone = (e164: string): string | null =>
  COUNTRY_ZONES[phoneCountry(e164) ?? ""] ?? null;

/** "US" or "CA" for a valid number of either, else null. */
export function countryOf(e164: string): PhoneCountry | null {
  const country = parse(e164)?.country;
  return (PHONE_COUNTRIES as readonly string[]).includes(country ?? "")
    ? (country as PhoneCountry)
    : null;
}

/** "+15551234567" → "(555) 123-4567" (US and Canada alike), for people reading a list. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
