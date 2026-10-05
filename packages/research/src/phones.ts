/**
 * Phone numbers a firm published on its own pages, as US E.164. The leads are
 * US businesses, so a number that is not a valid US number is dropped before
 * anything is stored against it. NANP digits carry no mobile/landline bit; the
 * line type comes from a carrier lookup later. Toll-free is the one type the
 * digits do say.
 */
import { parsePhoneNumberFromString } from "libphonenumber-js/max";

export type FoundKind = "tel_link" | "page_text";

export interface FoundPhone {
  e164: string;
  kind: FoundKind;
}

/** The US E.164 form of whatever a page or a person wrote, or null when it is not a valid US number. */
export function toUsE164(raw: string): string | null {
  const text = raw.trim();
  const parsed = text ? parsePhoneNumberFromString(text, "US") : undefined;
  if (parsed?.country !== "US" || !parsed.isValid()) return null;
  return parsed.number;
}

/** True for 800/833/844/855/866/877/888: never a person, never texted cold. */
export function isTollFree(e164: string): boolean {
  return /^\+18(00|33|44|55|66|77|88)\d{7}$/.test(e164);
}

// NANP shapes as people type them: optional +1, area code (parens optional), 3, 4.
const TEXT_PHONE = /(?<![\d+])(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}(?!\d)/g;

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Every distinct valid US number from a page's `tel:` targets, then its text. */
export function phonesOf(tels: readonly string[], text: string | null): FoundPhone[] {
  const seen = new Map<string, FoundKind>();
  for (const tel of tels) {
    const e164 = toUsE164(decode(tel).split(/[;,?]/)[0] as string);
    if (e164 && !seen.has(e164)) seen.set(e164, "tel_link");
  }
  for (const m of (text ?? "").matchAll(TEXT_PHONE)) {
    const e164 = toUsE164(m[0]);
    if (e164 && !seen.has(e164)) seen.set(e164, "page_text");
  }
  return [...seen].map(([e164, kind]) => ({ e164, kind }));
}
