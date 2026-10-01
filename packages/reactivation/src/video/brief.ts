/**
 * What a lead's video says about them: their firm's name, and nothing else on
 * screen. The name is the one we hold for the company (its source's record),
 * tidied the way the firm writes it: no legal suffix, no ALL CAPS. A name we
 * can't show cleanly means no video, never a guess.
 */
import type { Dossier } from "@wren/research/dossier";

export interface VideoBrief {
  companyId: number;
  /** The firm as it goes on screen: "Acme Staffing". */
  firm: string;
  domain: string | null;
}

/** Longer than this wraps in the portal's workspace card and breadcrumb. */
export const FIRM_MAX = 40;

const SUFFIX =
  /(?:^|[\s,]+)(?:llc|l\.l\.c\.?|inc\.?|incorporated|corp\.?|corporation|co\.?|company|ltd\.?|limited|llp|l\.l\.p\.?|lp|pllc|p\.c\.|ulc|lt[eé]e)$/i;
const SMALL = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "the", "to"]);

/** "ACME STAFFING SERVICES, INC." -> "Acme Staffing Services"; null when nothing is left. */
export function displayFirm(raw: string): string | null {
  let name = raw.replace(/\s+/g, " ").trim();
  for (let prev = ""; prev !== name; ) {
    prev = name;
    name = name.replace(SUFFIX, "").replace(/[\s,.]+$/, "");
  }
  if (!/[a-z]/i.test(name)) return null;
  if (!/[a-z]/.test(name)) name = titleCase(name);
  return name || null;
}

/** For an all-caps name: words title-cased, short ones (an acronym, likely) kept, small words lowered. */
function titleCase(upper: string): string {
  return upper
    .split(" ")
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i > 0 && SMALL.has(lower)) return lower;
      if (/^[A-Z]{2,3}$/.test(word) && !SMALL.has(lower)) return word;
      return lower.replace(
        /(^|[-'&/])([a-z])/g,
        (_, sep: string, ch: string) => sep + ch.toUpperCase(),
      );
    })
    .join(" ");
}

/** The brief, or why this firm gets no video. */
export function videoBrief(d: Dossier): VideoBrief | { skip: string } {
  if (!d.company.name) return { skip: "no name on file" };
  const firm = displayFirm(d.company.name);
  if (!firm) return { skip: `name "${d.company.name}" has no words to show` };
  if (firm.length > FIRM_MAX) return { skip: `name "${firm}" is longer than ${FIRM_MAX}` };
  return { companyId: d.company.id, firm, domain: d.company.domain };
}
