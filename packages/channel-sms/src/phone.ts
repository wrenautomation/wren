/**
 * Phone numbers as E.164. Lifted numbers are US only: the leads are US
 * businesses, so a published number that is not a valid US number is dropped
 * before anything is stored against it. A person who gives us their number
 * (a form, a hand-add) may be US or Canadian: one +1 plan, two countries, and
 * each country is texted from a number of its own (`cannotReach` in pool.ts).
 *
 * NANP numbers carry no mobile/landline bit (a US number is "fixed line or
 * mobile" by its digits), so the line type comes from a carrier lookup, never
 * from here. Toll-free is the one type the digits do say.
 */
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { PHONE_COUNTRIES, type PhoneCountry } from "./schema.js";

export const E164 = /^\+[1-9][0-9]{7,14}$/;

function parse(raw: string) {
  const text = raw.trim();
  return text ? parsePhoneNumberFromString(text, "US") : undefined;
}

/** The US E.164 form of whatever a page or a person wrote, or null when it is not a valid US number. */
export function toUsE164(raw: string): string | null {
  const parsed = parse(raw);
  if (parsed?.country !== "US" || !parsed.isValid()) return null;
  return parsed.number;
}

/** The E.164 form of a valid US or Canadian number, or null. */
export function toPhoneE164(raw: string): string | null {
  const parsed = parse(raw);
  if (!parsed?.isValid() || !(PHONE_COUNTRIES as readonly string[]).includes(parsed.country ?? ""))
    return null;
  return parsed.number;
}

/** "US" or "CA" for a valid number of either, else null. */
export function countryOf(e164: string): PhoneCountry | null {
  const country = parse(e164)?.country;
  return (PHONE_COUNTRIES as readonly string[]).includes(country ?? "")
    ? (country as PhoneCountry)
    : null;
}

/** True for 800/833/844/855/866/877/888: never a person, never texted cold. */
export function isTollFree(e164: string): boolean {
  return /^\+18(00|33|44|55|66|77|88)\d{7}$/.test(e164);
}

/** "+15551234567" → "(555) 123-4567" (US and Canada alike), for people reading a list. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
