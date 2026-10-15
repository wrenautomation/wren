/**
 * Fractional positions: a card's place in its column as a string that sorts (byte order, so
 * Postgres `collate "C"`) between its neighbours. Moving a card writes one row, never the rest.
 * Digits are in ASCII order, so string order is digit order.
 */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS[0] as string;

/** A key strictly between `a` ("" for the start) and `b` (null for the end); `a < b`. */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a.endsWith(ZERO) || b?.endsWith(ZERO)) throw new Error("a position never ends in 0");
  if (b !== null) {
    // Their shared start stays; the rest is found between what follows it.
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const lo = a ? DIGITS.indexOf(a[0] as string) : 0;
  const hi = b !== null ? DIGITS.indexOf(b[0] as string) : DIGITS.length;
  if (hi - lo > 1) return DIGITS[Math.round((lo + hi) / 2)] as string;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return (DIGITS[lo] as string) + midpoint(a.slice(1), null);
}

/** A position between `before` and `after`; either is null at an end of the column. */
export function positionBetween(before: string | null, after: string | null): string {
  return midpoint(before ?? "", after);
}
