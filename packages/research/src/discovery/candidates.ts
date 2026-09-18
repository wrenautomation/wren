/**
 * Domain-candidate generation from a company name (funnel L1). Niche-agnostic: the
 * only niche input is a set of "generic words" (industry vocabulary firms drop when
 * registering short domains). Candidates are ordered most-specific-first; the caller
 * prunes with free DNS before any fetch.
 */
import { validDomain } from "@wren/core";

const LEGAL_SUFFIXES = new Set([
  "llc",
  "inc",
  "lp",
  "llp",
  "lllp",
  "ltd",
  "co",
  "corp",
  "corporation",
  "company",
  "pllc",
  "pc",
  "pa",
  "plc",
  "sa",
  "gmbh",
  "incorporated",
]);
const STOPWORDS = new Set(["the", "of", "and", "for", "a", "an"]);

/** Lowercased word tokens with legal suffixes and stopwords dropped; '&' reads as 'and'. */
export function nameTokens(name: string): string[] {
  const text = name.toLowerCase().replaceAll("&", " and ");
  return (text.match(/[a-z0-9]+/g) ?? []).filter(
    (t) => !LEGAL_SUFFIXES.has(t) && !STOPWORDS.has(t),
  );
}

export interface CandidateOptions {
  genericWords?: ReadonlySet<string>;
  tlds?: readonly string[];
  cap?: number;
}

/**
 * Plausible domains for a firm name, most-specific-first. Every candidate is a GUESS
 * until the ownership gate proves it: stay cheap, over-generate slightly; DNS and the
 * gate do the filtering.
 */
export function domainCandidates(name: string, opts: CandidateOptions = {}): string[] {
  const generic = opts.genericWords ?? new Set<string>();
  const tlds = opts.tlds ?? ["com", "net"];
  const cap = opts.cap ?? 6;
  const tokens = nameTokens(name);
  if (tokens.length === 0) return [];
  const distinctive = tokens.filter((t) => !generic.has(t));
  const stems: string[] = [];
  const add = (parts: string[], separator = "") => {
    if (parts.length === 0) return;
    const stem = parts.join(separator);
    if (stem.length >= 3 && !stems.includes(stem)) stems.push(stem);
  };
  add(tokens); // full name: acmewealthmanagement
  add(tokens.slice(0, 2)); // leading pair: acmewealth
  if (distinctive.length && distinctive.join(" ") !== tokens.join(" ")) {
    add(distinctive); // generic words dropped: acme
    add([...distinctive.slice(0, 1), ...tokens.filter((t) => generic.has(t)).slice(0, 1)]);
  }
  add(tokens, "-"); // hyphenated full name

  const candidates: string[] = [];
  for (const stem of stems) {
    for (const tld of tlds) {
      const domain = `${stem}.${tld}`;
      if (validDomain(domain) && !candidates.includes(domain)) candidates.push(domain);
      if (candidates.length >= cap) return candidates;
    }
  }
  return candidates;
}
