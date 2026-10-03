/**
 * Email pattern vocabulary: apply and infer. A pattern is a template over a
 * person's normalized names — "{first}.{last}" -> "jane.doe". One VALID verdict on
 * a pattern-generated address proves the pattern for the whole domain, and a
 * scraped address's inferred pattern is proof without spending anything.
 */

import { ROLE_LOCALPARTS } from "./emails.js";

/** Most-common-first: this IS the ladder order for guessed candidates. */
export const PATTERNS = [
  "{first}.{last}",
  "{f}{last}",
  "{first}",
  "{first}{last}",
  "{first}_{last}",
  "{f}.{last}",
  "{last}",
] as const;
export type Pattern = (typeof PATTERNS)[number];

/** A name as it appears in local parts: lowercased, accents folded (Núñez -> nunez), punctuation dropped. */
export function nameToken(name: string | null | undefined): string | null {
  if (!name) return null;
  // Drop combining marks left by NFKD (accents) and anything else non-ASCII.
  const folded = name.normalize("NFKD").replace(/[^ -~]/g, "");
  const token = folded.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return token || null;
}

/** The local part this pattern yields, or null when a required name is missing. */
export function applyPattern(
  pattern: string,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  const first = nameToken(firstName);
  const last = nameToken(lastName);
  const values: Record<string, string | null> = {
    first,
    last,
    f: first ? (first[0] as string) : null,
  };
  let missing = false;
  const out = pattern.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key];
    if (v == null) missing = true;
    return v ?? "";
  });
  return missing ? null : out;
}

/** Which known pattern produced this local part, if any. */
export function inferPattern(
  localPart: string,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): Pattern | null {
  const local = localPart.toLowerCase();
  for (const p of PATTERNS) if (applyPattern(p, firstName, lastName) === local) return p;
  return null;
}

/** Words a first.last local part holds when it is a desk, not a person. */
const NOT_NAMES: ReadonlySet<string> = new Set([
  ...ROLE_LOCALPARTS,
  ...["accounting", "accounts", "apply", "applications", "candidates", "career", "careers"],
  ...["client", "clients", "customer", "dept", "desk", "employment", "enquiries", "finance"],
  ...["front", "general", "group", "hiring", "inquiries", "legal", "main", "management"],
  ...["manager", "media", "news", "online", "operations", "orders", "partners", "payroll"],
  ...["press", "reception", "recruiter", "recruiters", "recruiting", "recruitment", "resume"],
  ...["resumes", "service", "services", "staff", "staffing", "talent", "tech", "the", "web"],
  ...["us", "usa", "ca", "canada", "uk"],
]);

const cap = (t: string) => (t[0] as string).toUpperCase() + t.slice(1);

/**
 * "jane.doe" (or "jane_doe") at jane's firm read as Jane Doe: the owner's name, for an
 * address a site printed without naming anyone. Null for any other shape, a token
 * without a vowel ("dt"), a desk word ("sales.team"), or a word of the domain's own
 * name ("acme.uk" at acme.com).
 */
export function nameFromLocalPart(
  localPart: string,
  domain: string,
): { firstName: string; lastName: string } | null {
  const m = /^([a-z]{2,})[._]([a-z]{2,})$/.exec(localPart.toLowerCase());
  if (!m) return null;
  const first = m[1] as string;
  const last = m[2] as string;
  const label =
    domain
      .toLowerCase()
      .replace(/^www\./, "")
      .split(".")[0] ?? "";
  for (const token of [first, last]) {
    if (!/[aeiouy]/.test(token) || NOT_NAMES.has(token) || label.includes(token)) return null;
  }
  return { firstName: cap(first), lastName: cap(last) };
}
