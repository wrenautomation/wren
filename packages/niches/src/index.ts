/**
 * The niche registry. Outreach vocabulary is per-niche and deliberately NOT merged:
 * template and sequence names repeat across niches, so campaigns address them as
 * (niche, name). Crawl hints and discovery words union when unscoped.
 */
import { pyReprStr } from "@wren/channel-email";
import { agencies } from "./agencies.js";
import type { Niche } from "./niche.js";
import { secRia } from "./sec-ria.js";

export type { Niche, NicheSpec } from "./niche.js";
export { defineNiche, rawLocation, templatesDir } from "./niche.js";
export { agencies, secRia };

export const NICHES: readonly Niche[] = [secRia, agencies];
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
