/**
 * Phone numbers as E.164, US only. The leads are US businesses and the
 * registration is US 10DLC, so a number that is not a valid US number is not a
 * contact: it is dropped here, before anything is stored against it.
 *
 * NANP numbers carry no mobile/landline bit (a US number is "fixed line or
 * mobile" by its digits), so the line type comes from a carrier lookup, never
 * from here. Toll-free is the one type the digits do say.
 */
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export const E164 = /^\+[1-9][0-9]{7,14}$/;

/** The US E.164 form of whatever a page or a person wrote, or null when it is not a valid US number. */
export function toUsE164(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const parsed = parsePhoneNumberFromString(text, "US");
  if (parsed?.country !== "US" || !parsed.isValid()) return null;
  return parsed.number;
}

/** True for 800/833/844/855/866/877/888: never a person, never texted cold. */
export function isTollFree(e164: string): boolean {
  return /^\+18(00|33|44|55|66|77|88)\d{7}$/.test(e164);
}

/** "+15551234567" → "(555) 123-4567", for people reading a list. */
export function formatUs(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
