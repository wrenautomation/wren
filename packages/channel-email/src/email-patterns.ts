/**
 * Email pattern vocabulary: apply and infer. A pattern is a template over a
 * person's normalized names — "{first}.{last}" -> "jane.doe". One VALID verdict on
 * a pattern-generated address proves the pattern for the whole domain, and a
 * scraped address's inferred pattern is proof without spending anything.
 */

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
  const folded = name.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
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
