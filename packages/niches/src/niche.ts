/**
 * The typed niche contract. A niche is data: its facts view, its site page, its crawl and
 * discovery vocabulary, its templates (loaded from *.email files) and its sequences. New
 * niches (insurance, HVAC, oil & gas, ...) add one module and one registry entry; nothing
 * in core, research or channel-email branches on a niche name.
 */

import { fileURLToPath } from "node:url";
import {
  type EnrollmentRule,
  enrollmentPlan,
  loadTemplates,
  pyReprStr,
  type Sequence,
  type Template,
} from "@wren/channel-email";
import type { Company, PersonSourceFormat, SourceFormat } from "@wren/core";

export interface Niche {
  readonly name: string;
  /** The sanctioned targeting read surface for this niche (a view name), or null. */
  readonly factsView: string | null;
  /** This niche's page on the site, path only (the sign-off links it). */
  readonly lander: string;
  /** Site-navigation vocabulary this niche's sites use for people-content pages. */
  readonly crawlHints: ReadonlySet<string>;
  /** Industry vocabulary firms drop when registering short domains. */
  readonly discoveryGenericWords: ReadonlySet<string>;
  readonly templates: ReadonlyMap<string, Template>;
  readonly sequences: ReadonlyMap<string, Sequence>;
  /** Which sequence a new enrollment gets, by facts, in order (the last rule may be ungated). */
  readonly plan: readonly EnrollmentRule[];
  /** Where the company keeps office hours, as the source wrote it ("City, ST"), or null. */
  readonly companyLocation: (company: Company) => string | null;
  /** How this niche's lead files (rosters, feeds, saved listing pages) become import rows. */
  readonly leadSourceFormats: readonly SourceFormat[];
  /** How this niche's people files become person rows. */
  readonly personSourceFormats: readonly PersonSourceFormat[];
  /**
   * Hosts whose URLs identify a directory or registry, never a business. Merged into
   * the platform-domain set at import so a pasted listing URL can never key a company.
   */
  readonly platformDomains: ReadonlySet<string>;
}

export interface NicheSpec {
  readonly name: string;
  readonly factsView: string | null;
  readonly lander: string;
  readonly crawlHints: readonly string[];
  readonly discoveryGenericWords: readonly string[];
  /** Directory holding the *.email files. */
  readonly templatesDir: string;
  readonly sequences: readonly Sequence[];
  /** The live campaign's routing: first matching rule wins. */
  readonly plan: readonly EnrollmentRule[];
  readonly companyLocation: (company: Company) => string | null;
  readonly leadSourceFormats?: readonly SourceFormat[];
  readonly personSourceFormats?: readonly PersonSourceFormat[];
  readonly platformDomains?: Iterable<string>;
}

/** A niche-owned import format: `build` and `help` here, name and niche from the caller. */
export function leadFormat(
  niche: string,
  name: string,
  help: string,
  build: SourceFormat["build"],
  opts: { directory?: boolean } = {},
): SourceFormat {
  return { name, help, build, niche, columnMapped: false, directory: opts.directory ?? false };
}

/** The templates directory beside a niche module: `templatesDir(import.meta.url, "agencies")`. */
export function templatesDir(moduleUrl: string, niche: string): string {
  return fileURLToPath(new URL(`../templates/${niche}`, moduleUrl));
}

/** Build and validate one niche: every sequence step registered, every opener with a subject. */
export function defineNiche(spec: NicheSpec): Niche {
  const templates = loadTemplates(spec.templatesDir);
  for (const [key, tpl] of templates) {
    if (key !== tpl.name) {
      throw new Error(
        `niche ${pyReprStr(spec.name)}: template registered as ${pyReprStr(key)}` +
          ` names itself ${pyReprStr(tpl.name)}`,
      );
    }
  }
  const sequences = new Map<string, Sequence>();
  for (const seq of spec.sequences) {
    if (sequences.has(seq.name)) {
      throw new Error(
        `niche ${pyReprStr(spec.name)}: sequence ${pyReprStr(seq.name)} registered twice`,
      );
    }
    const missing = [...new Set(seq.steps.map((s) => s.template))]
      .filter((t) => !templates.has(t))
      .sort();
    if (missing.length > 0) {
      throw new Error(
        `niche ${pyReprStr(spec.name)}: sequence ${pyReprStr(seq.name)} references` +
          ` unregistered templates: ${missing.join(", ")}`,
      );
    }
    const openerName = (seq.steps[0] as { template: string }).template;
    const opener = templates.get(openerName) as Template;
    if (opener.subject === null) {
      // A subjectless step 0 has no thread to ride yet: it would skip on day one and
      // finish the enrollment, permanently consuming the company for nothing.
      throw new Error(
        `niche ${pyReprStr(spec.name)}: sequence ${pyReprStr(seq.name)} opens with template` +
          ` ${pyReprStr(opener.name)} — the opening step needs a subject —` +
          " a thread-rider has no thread yet",
      );
    }
    sequences.set(seq.name, seq);
  }
  const plan = enrollmentPlan(
    spec.plan,
    new Set(sequences.keys()),
    `niche ${pyReprStr(spec.name)}`,
  );
  return {
    name: spec.name,
    factsView: spec.factsView,
    lander: spec.lander,
    crawlHints: new Set(spec.crawlHints),
    discoveryGenericWords: new Set(spec.discoveryGenericWords),
    templates,
    sequences,
    plan,
    companyLocation: spec.companyLocation,
    leadSourceFormats: spec.leadSourceFormats ?? [],
    personSourceFormats: spec.personSourceFormats ?? [],
    platformDomains: new Set(spec.platformDomains ?? []),
  };
}

/** A non-blank string under `raw[key]`, or null. */
export function rawLocation(company: Company, key: string): string | null {
  const raw = (company.raw ?? {}) as Record<string, unknown>;
  const value = raw[key];
  return typeof value === "string" && value.trim() ? value : null;
}
