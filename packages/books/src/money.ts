/**
 * Money as vendors print it, turned into whole cents without floats, and back
 * into text. The reader copies amounts as printed; this is the only place they
 * become numbers.
 */

/** Marks that pin a currency when printed beside an amount. Longest first: "CA$" before "$". */
const MARKS: ReadonlyArray<[RegExp, string]> = [
  [/\bCAD\b|CA\$|C\$/i, "CAD"],
  [/\bUSD\b|US\$/i, "USD"],
  [/\bEUR\b|€/, "EUR"],
  [/\bGBP\b|£/, "GBP"],
  [/\bAUD\b|A\$/, "AUD"],
];

/** The currency a printed amount names ("CA$147.00" → CAD); null for a bare "$". */
export function currencyOf(printed: string): string | null {
  for (const [mark, code] of MARKS) if (mark.test(printed)) return code;
  return null;
}

/** True when `text` shows the currency's code or its mark anywhere. */
export function mentionsCurrency(text: string, code: string): boolean {
  return MARKS.some(([mark, c]) => c === code && mark.test(text));
}

const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/;

/**
 * "$1,234.56" → 123456; "-$5.00", "−5.00", "($5.00)" → -500; "10" → 1000.
 * A third decimal rounds half up. Null when no number is printed.
 */
export function parseCents(printed: string): number | null {
  const m = NUMBER.exec(printed);
  if (!m) return null;
  const [whole = "0", fraction = ""] = m[0].replaceAll(",", "").split(".");
  const padded = `${fraction}000`;
  const cents = Number(whole) * 100 + Number(padded.slice(0, 2)) + (Number(padded[2]) >= 5 ? 1 : 0);
  const before = printed.slice(0, m.index);
  const negative = /[-−–]/.test(before) || /^\s*\(.*\)\s*$/.test(printed);
  return negative ? -cents : cents;
}

/**
 * Every number the text prints, in cents, unsigned: what an amount the reader
 * reports must be found in. "1,234.56" and "1234.56" are the same number.
 */
export function printedCents(text: string): Set<number> {
  const found = new Set<number>();
  for (const m of text.matchAll(new RegExp(NUMBER.source, "g"))) {
    const cents = parseCents(m[0]);
    if (cents !== null) found.add(Math.abs(cents));
  }
  return found;
}

/** 123456 → "1,234.56"; -500 → "-5.00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** 14700, "CAD" → "147.00 CAD". */
export function formatMoney(cents: number, currency: string): string {
  return `${formatCents(cents)} ${currency}`;
}

/**
 * `cents` of a currency in CAD at `rate` (CAD per unit, as the database
 * stores it: a decimal string), rounded half away from zero. Exact: the rate
 * is scaled to an integer, never multiplied as a float.
 */
export function toCad(cents: number, rate: string): number {
  const [whole = "0", fraction = ""] = rate.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const scaled = BigInt(whole) * scale + BigInt(fraction || "0");
  const product = BigInt(Math.abs(cents)) * scaled;
  const rounded = (product * 2n + scale) / (2n * scale);
  return Number(cents < 0 ? -rounded : rounded);
}
