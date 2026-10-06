/**
 * The niche registry. Outreach vocabulary is per-niche and deliberately NOT merged:
 * template and sequence names repeat across niches, so campaigns address them as
 * (niche, name). Crawl hints and discovery words union when unscoped.
 */
import { pyReprStr } from "@wren/channel-email";
import { FORM_SEQUENCES, type SmsSequence } from "@wren/channel-sms";
import {
  BUILTIN_FORMATS,
  BUILTIN_PERSON_FORMATS,
  type PersonSourceFormat,
  type SourceFormat,
} from "@wren/core";
import type { Dataset } from "@wren/research/fetch";
import { agencies } from "./agencies.js";
import type { Niche } from "./niche.js";
import { recruiting } from "./recruiting.js";
import { secRia } from "./sec-ria.js";

export type { Niche, NicheSpec } from "./niche.js";
export { defineNiche, leadFormat, rawLocation, templatesDir } from "./niche.js";
export { agencies, recruiting, secRia };

export const NICHES: readonly Niche[] = [secRia, agencies, recruiting];
export const NICHE_NAMES: ReadonlySet<string> = new Set(NICHES.map((n) => n.name));
if (NICHE_NAMES.size !== NICHES.length) throw new Error("duplicate niche name in registry");

const byName = new Map(NICHES.map((n) => [n.name, n] as const));

/** The niche name, validated against the registry; null (unscoped) passes through. */
export function requireNiche(niche: string | null): string | null {
  if (niche !== null && !byName.has(niche)) {
    throw new Error(
      `unknown niche ${pyReprStr(niche)} — registered: ${[...NICHE_NAMES].sort().join(", ")}`,
    );
  }
  return niche;
}

export function nicheFor(niche: string): Niche {
  const found = byName.get(niche);
  if (found === undefined) requireNiche(niche);
  return found as Niche;
}

const union = (pick: (n: Niche) => ReadonlySet<string>): ReadonlySet<string> =>
  new Set(NICHES.flatMap((n) => [...pick(n)]));

/** What the `adLibrary` stage needs from a niche: its searches, its platform hosts, its screen. */
export function adLibraryFor(niche: string) {
  const n = nicheFor(niche);
  return { keywords: n.adKeywords, platforms: n.platformDomains, screen: n.screen };
}

/** What the `fbGroups` stage needs from a niche: its group searches. */
export function fbGroupsFor(niche: string) {
  return { keywords: nicheFor(niche).groupKeywords };
}

/** What the `exaSearch` stage needs from a niche: its searches, their cities, its platform hosts, its screen. */
export function exaSearchFor(niche: string) {
  const n = nicheFor(niche);
  return {
    queries: n.exaQueries,
    cities: n.exaCities,
    platforms: n.platformDomains,
    screen: n.screen,
  };
}

/** What the `youtubeSearch` stage needs from a niche: its searches, its platform hosts, its screen. */
export function youtubeSearchFor(niche: string) {
  const n = nicheFor(niche);
  return { queries: n.youtubeQueries, platforms: n.platformDomains, screen: n.screen };
}

/** One niche's discovery vocabulary, or the union when unscoped. */
export function discoveryWordsFor(niche: string | null): ReadonlySet<string> {
  requireNiche(niche);
  return niche === null
    ? union((n) => n.discoveryGenericWords)
    : nicheFor(niche).discoveryGenericWords;
}

/** One niche's crawl hints, or the union when unscoped. */
export function crawlHintsFor(niche: string | null): ReadonlySet<string> {
  requireNiche(niche);
  return niche === null ? union((n) => n.crawlHints) : nicheFor(niche).crawlHints;
}

export const FACTS_VIEWS: ReadonlyMap<string, string> = new Map(
  NICHES.flatMap((n) => (n.factsView === null ? [] : [[n.name, n.factsView] as const])),
);
export const LANDERS_BY_NICHE: ReadonlyMap<string, string> = new Map(
  NICHES.map((n) => [n.name, n.lander]),
);
export const TEMPLATES_BY_NICHE = new Map(NICHES.map((n) => [n.name, n.templates] as const));
export const SEQUENCES_BY_NICHE = new Map(NICHES.map((n) => [n.name, n.sequences] as const));

/**
 * Every text sequence by name: each niche's, plus the core ones for site applicants.
 * Contacts store only the name, so a name is one sequence fleet-wide: a second
 * owner claiming it is refused here.
 */
export const SMS_SEQUENCES: ReadonlyMap<string, SmsSequence> = formatRegistry("sms sequence", [
  ...FORM_SEQUENCES.map((s) => ({ ...s, niche: null })),
  ...NICHES.flatMap((n) => [...n.smsSequences.values()].map((s) => ({ ...s, niche: n.name }))),
]);

/** Name -> format, refusing a name two owners claim: a format is one dialect, one niche. */
function formatRegistry<F extends { name: string; niche: string | null }>(
  what: string,
  entries: Iterable<F>,
): ReadonlyMap<string, F> {
  const byFormatName = new Map<string, F>();
  for (const format of entries) {
    const taken = byFormatName.get(format.name);
    if (taken !== undefined) {
      throw new Error(
        `${what} ${pyReprStr(format.name)} registered by both ${taken.niche ?? "core"} and ${format.niche ?? "core"}`,
      );
    }
    byFormatName.set(format.name, format);
  }
  return byFormatName;
}

/** Every import format: core's generic CSV plus each niche's own. */
export const LEAD_SOURCE_FORMATS: ReadonlyMap<string, SourceFormat> = formatRegistry(
  "lead format",
  [...Object.values(BUILTIN_FORMATS), ...NICHES.flatMap((n) => n.leadSourceFormats)],
);
export const PERSON_SOURCE_FORMATS: ReadonlyMap<string, PersonSourceFormat> = formatRegistry(
  "person format",
  [...BUILTIN_PERSON_FORMATS, ...NICHES.flatMap((n) => n.personSourceFormats)],
);

/** Every niche's directory and registry hosts: a listing URL never keys a company in any niche's import. */
export const NICHE_PLATFORM_DOMAINS: ReadonlySet<string> = union((n) => n.platformDomains);

/** Every niche's bulk datasets, with the niche each lands under: name -> (niche, dataset). */
export function datasetsFor(
  dataDir: string,
): ReadonlyMap<string, { niche: string; dataset: Dataset }> {
  return formatRegistry(
    "dataset",
    NICHES.flatMap((n) =>
      n.datasets(dataDir).map((dataset) => ({ name: dataset.name, niche: n.name, dataset })),
    ),
  );
}
