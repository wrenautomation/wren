/**
 * CRM dates to ISO days. Exports mix ISO ("2024-03-05 14:22"), slashes
 * ("3/5/24", "05/03/2024 2:22 PM"), month names ("Mar 5, 2024") and epoch
 * milliseconds (Bullhorn's API). Slash dates are month-first unless the file
 * shows a first part over 12 somewhere, which settles day-first for the file.
 * Anything else is null; the raw row keeps the original.
 */

export type DayOrder = "mdy" | "dmy";

const SLASH = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/;
const ISO = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Day-first when any value's first part cannot be a month. */
export function dayOrder(values: Iterable<string | null>): DayOrder {
  for (const v of values) {
    const m = v ? SLASH.exec(v.trim()) : null;
    if (m && Number(m[1]) > 12) return "dmy";
  }
  return "mdy";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "24" is 2024, "69" is 1969: CRM dates are in the past, so the latest such year not ahead of now. */
function fullYear(yy: number): number {
  const now = new Date().getUTCFullYear();
  return 2000 + yy <= now ? 2000 + yy : 1900 + yy;
}

/** A real calendar day, 1970-2100; 1970-01-01 is epoch zero, a placeholder, not a date. */
function isoDay(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  if (y < 1970 || y > 2100 || (y === 1970 && m === 1 && d === 1)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseCrmDate(raw: string | null, order: DayOrder = "mdy"): string | null {
  const s = raw?.trim();
  if (!s) return null;
  let m = ISO.exec(s);
  if (m) return isoDay(Number(m[1]), Number(m[2]), Number(m[3]));
  m = SLASH.exec(s);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const y = (m[3] as string).length === 2 ? fullYear(Number(m[3])) : Number(m[3]);
    return order === "mdy" ? isoDay(y, a, b) : isoDay(y, b, a);
  }
  if (/^\d{12,13}$/.test(s)) {
    const t = new Date(Number(s));
    return isoDay(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  // "Mar 5, 2024" / "5 March 2024" / "5-Mar-2024" / "March 5th, 2024"
  const words = s
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, "$1")
    .replace(/[,-]/g, " ")
    .split(/\s+/);
  const month = words.findIndex((w) => MONTHS.includes(w.slice(0, 3)) && /^[a-z]+\.?$/.test(w));
  if (month >= 0) {
    const nums = words.filter((w) => /^\d{1,4}$/.test(w)).map(Number);
    const year = nums.find((n) => n > 31);
    const day = nums.find((n) => n >= 1 && n <= 31);
    const mo = MONTHS.indexOf((words[month] as string).slice(0, 3)) + 1;
    if (year !== undefined && day !== undefined) return isoDay(year, mo, day);
  }
  return null;
}
