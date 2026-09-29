/**
 * Edge validation for person rows and name parsing.
 *
 * A PersonSource yields typed PersonRows (unlike lead sources, which yield raw
 * objects for the alias map): person sources parse structured formats, so
 * classification happens inside the adapter and the importer only sees validated
 * rows. Parse failures travel as PersonRowError values, never exceptions.
 *
 * Name parsing is pragmatic. Registries speak two shapes: inverted
 * ("NESS, BRIAN, STEVEN" = last, first, middle) and direct ("JOHN V. BOARDMAN III").
 * Case is normalized only when a word is all-upper or all-lower: a filer's own
 * mixed case ("VanWinkle") is better information than any rule. The untouched
 * original always rides in raw.
 */
import type { PersonOrigin } from "../schema.js";

/** Dropped when picking the MATCHING last name; kept verbatim in full_name. */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "esq"]);
/** Dropped from the front when picking the first name ("Dr. Jane Doe" is Jane). */
const HONORIFICS = new Set(["dr", "mr", "mrs", "ms", "miss", "mx", "prof"]);
/** Letters written after a comma ("Jane Doe, CPA"): credentials, not an inverted name. */
const CREDENTIALS = new Set([
  ...SUFFIXES,
  "phd",
  "md",
  "mba",
  "cpa",
  "cfa",
  "cpc",
  "ctc",
  "pe",
  "rn",
  "jd",
  "dds",
  "pmp",
  "phr",
  "sphr",
  "shrm-cp",
  "shrm-scp",
]);
const bare = (w: string) => w.replace(/\./g, "").toLowerCase();

const hasCase = (w: string) => w.toUpperCase() !== w.toLowerCase();
const capitalizeRuns = (w: string) =>
  w.replace(/[A-Za-z]+/g, (run) => run[0]?.toUpperCase() + run.slice(1).toLowerCase());

/** Title-case a word only when the source shouted or whispered it; mixed case is kept. */
export function smartCase(word: string): string {
  if (hasCase(word) && (word === word.toUpperCase() || word === word.toLowerCase()))
    return capitalizeRuns(word);
  return word;
}

export type ParsedName = [full: string, first: string | null, last: string | null];

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** "LAST, FIRST, MIDDLE..." -> [full, first, last]; null if empty. A comma-less value falls through to direct parsing. */
export function parseInvertedName(raw: string): ParsedName | null {
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parseDirectName(raw);
  const last = words(parts[0] as string)
    .map(smartCase)
    .join(" ");
  const given = parts.slice(1).flatMap((p) => words(p).map(smartCase));
  const first = given[0] ?? null;
  const full = (given.length ? [...given, last] : [last]).filter(Boolean).join(" ");
  return [full, first, last || null];
}

/** "FIRST [MIDDLE] LAST [SUFFIX]" -> [full, first, last]; null if empty. */
export function parseDirectName(raw: string): ParsedName | null {
  const tokens = words(raw).map(smartCase);
  if (tokens.length === 0) return null;
  const full = tokens.join(" ");
  let core = tokens.filter((t) => !SUFFIXES.has(t.replace(/\.+$/, "").toLowerCase()));
  if (core.length === 0) core = tokens;
  while (core.length > 1 && HONORIFICS.has(bare(core[0] as string))) core = core.slice(1);
  const first = core[0] as string;
  const last = core.length > 1 ? (core[core.length - 1] as string) : null;
  return [full, first, last];
}

/**
 * A name cell of unknown shape. "Doe, Jane" is inverted; "Jane Doe, CPA" is
 * direct with credentials after the comma (dropped); no comma is direct.
 */
export function parseName(raw: string): ParsedName | null {
  const [head = "", ...tail] = raw.split(",");
  if (tail.length === 0) return parseDirectName(raw);
  const after = tail.flatMap(words);
  if (head.trim() && after.length && after.every((w) => CREDENTIALS.has(bare(w))))
    return parseDirectName(head);
  return parseInvertedName(raw);
}

/**
 * The keyless-dedupe key within one company: (first, last) when both are known so
 * "KORI CUSICK" and "CUSICK, KORI, ANN" meet, else the normalized full name. A false
 * merge is recoverable from sightings; a missed merge is just two rows.
 */
export function matchKey(
  firstName: string | null,
  lastName: string | null,
  fullName: string,
): string {
  const text = firstName && lastName ? `${firstName} ${lastName}` : fullName;
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A validated person claim from one source, bound to a company by source_key or domain. */
export interface PersonRow {
  kind: "person";
  companySourceKey: string | null;
  companyDomain: string | null;
  companyName: string | null;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  isCompliance: boolean;
  /** A client quoted on the company's own page, not staff: stored and tagged, never enrolled under that company. */
  isTestimonial: boolean;
  testimonialOrg: string | null;
  origin: PersonOrigin;
  originRef: string;
  /** ISO date (YYYY-MM-DD). */
  asOf: string | null;
  /** Scheme-prefixed registry id, e.g. "crd-ind:123". */
  sourceKey: string | null;
  linkedinUrl: string | null;
  raw: Record<string, unknown>;
}
export interface PersonRowError {
  kind: "error";
  reason: string;
  raw: Record<string, unknown> | null;
}
export type PersonItem = PersonRow | PersonRowError;

export type PersonRowInput = Pick<PersonRow, "fullName" | "origin" | "originRef" | "raw"> &
  Partial<Omit<PersonRow, "kind" | "fullName" | "origin" | "originRef" | "raw">>;

export class PersonRowInvalid extends Error {
  override name = "PersonRowInvalid";
}

/** Build a validated PersonRow; throws PersonRowInvalid (adapters convert that into a PersonRowError). */
export function personRow(input: PersonRowInput): PersonRow {
  const fullName = input.fullName.trim();
  if (!fullName) throw new PersonRowInvalid("empty name");
  for (const key of [input.sourceKey, input.companySourceKey]) {
    if (key != null && key.length > 64)
      throw new PersonRowInvalid(`source key longer than 64 chars: '${key}'`);
  }
  const companySourceKey = input.companySourceKey ?? null;
  const companyDomain = input.companyDomain ?? null;
  if (companySourceKey == null && companyDomain == null)
    throw new PersonRowInvalid("person row needs a company source_key or domain");
  const linkedinUrl = input.linkedinUrl ?? null;
  return {
    kind: "person",
    companySourceKey,
    companyDomain,
    companyName: input.companyName ?? null,
    fullName,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    title: input.title ?? null,
    isCompliance: input.isCompliance ?? false,
    isTestimonial: input.isTestimonial ?? false,
    testimonialOrg: input.testimonialOrg ?? null,
    origin: input.origin,
    originRef: input.originRef,
    asOf: input.asOf ?? null,
    sourceKey: input.sourceKey ?? null,
    // String(512) column; the untouched original rides in raw.
    linkedinUrl:
      linkedinUrl != null && linkedinUrl.length > 512 ? linkedinUrl.slice(0, 512) : linkedinUrl,
    raw: input.raw,
  };
}

export const personRowError = (
  reason: string,
  raw: Record<string, unknown> | null = null,
): PersonRowError => ({
  kind: "error",
  reason,
  raw,
});
