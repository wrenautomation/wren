/**
 * The ownership gate. A guessed or asserted domain attaches to a company only after
 * the fetched homepage SPEAKS FOR THE FIRM: it carries the firm's distinctive name
 * tokens (plus one generic token when the name has any), or the firm's registry
 * number. Evidence is returned as data and stored with the attachment (a sighting).
 */
import { nameTokens } from "./candidates.js";

/** Why a page counted as the firm's own; serialized into sighting raw. */
export interface GateEvidence {
  url: string;
  matched_tokens: string[];
  matched_registry_key: boolean;
  page_title: string;
}

/** The numeric part of a scheme-prefixed registry key ("crd:105734" -> "105734"), when long enough to be distinctive. */
export function registryDigits(sourceKey: string | null | undefined): string | null {
  if (!sourceKey) return null;
  const i = sourceKey.indexOf(":");
  const value = (i < 0 ? "" : sourceKey.slice(i + 1)).trim();
  return /^\d{4,}$/.test(value) ? value : null;
}

export interface GateInput {
  url: string;
  pageTitle: string;
  pageText: string;
  companyName: string | null;
  sourceKey: string | null;
  genericWords?: ReadonlySet<string>;
}

/**
 * Evidence that this page belongs to this firm, or null. Either suffices:
 * - name match: every distinctive token appears, and at least one generic token when the name has any;
 * - registry match: the firm's registry number appears (>= 4 digits).
 */
export function gatePage(input: GateInput): GateEvidence | null {
  const generic = input.genericWords ?? new Set<string>();
  const haystack = ` ${`${input.pageTitle} ${input.pageText}`.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const has = (t: string) => haystack.includes(` ${t} `);

  const keyDigits = registryDigits(input.sourceKey);
  if (keyDigits && has(keyDigits))
    return {
      url: input.url,
      matched_tokens: [],
      matched_registry_key: true,
      page_title: input.pageTitle,
    };

  const tokens = nameTokens(input.companyName ?? "");
  const distinctive = tokens.filter((t) => !generic.has(t));
  const genericTokens = tokens.filter((t) => generic.has(t));
  if (distinctive.length === 0) return null; // a generic-only name can only be proven by registry key
  if (!distinctive.every(has)) return null;
  const matched = [...distinctive];
  if (genericTokens.length) {
    const hits = genericTokens.filter(has);
    if (hits.length === 0) return null;
    matched.push(...hits);
  }
  return {
    url: input.url,
    matched_tokens: matched,
    matched_registry_key: false,
    page_title: input.pageTitle,
  };
}
