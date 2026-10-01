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
  factKeys,
  loadTemplates,
  pyReprStr,
  type RecontactOverrides,
  type RecontactPolicy,
  recontactPolicy,
  type Sequence,
  type Template,
} from "@wren/channel-email";
import { checkSequence, type SmsSequence } from "@wren/channel-sms";
import type { Company, CompanyScreen, PersonSourceFormat, SourceFormat } from "@wren/core";
import { OFFER_PAGES, offerFacts, offerFor } from "@wren/offers";
import type { Dataset } from "@wren/research/fetch";

export interface Niche {
  readonly name: string;
  /** The sanctioned targeting read surface for this niche (a view name), or null. */
  readonly factsView: string | null;
  /** This niche's page on the site, path only (the sign-off links it). Must be a live offer's page. */
  readonly lander: string;
  /** Site-navigation vocabulary this niche's sites use for people-content pages. */
  readonly crawlHints: ReadonlySet<string>;
  /** Industry vocabulary firms drop when registering short domains. */
  readonly discoveryGenericWords: ReadonlySet<string>;
  readonly templates: ReadonlyMap<string, Template>;
  readonly sequences: ReadonlyMap<string, Sequence>;
  /** Text sequences, by name. Empty for a niche nobody texts. */
  readonly smsSequences: ReadonlyMap<string, SmsSequence>;
  /** The offer each sequence pitches (its arm's), by sequence name: every sequence has one. */
  readonly offers: ReadonlyMap<string, string>;
  /** Each pitched offer's terms as `offer.*` facts, by offer id: `{offer.days}` in copy. */
  readonly offerFacts: ReadonlyMap<string, Readonly<Record<string, string>>>;
  /** Which sequence a new enrollment gets, by facts, in order (the last rule may be ungated). */
  readonly plan: readonly EnrollmentRule[];
  /** When a company that had a cold sequence may get another (lead recycling). */
  readonly recontact: RecontactPolicy;
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
  /**
   * Bulk files this niche pulls from publishers (regulator catalogs, directory
   * profiles), given the data directory: `<dataDir>/<niche>/` is the niche's own,
   * `<dataDir>/<niche>/bulk/<dataset>/` where the files land.
   */
  readonly datasets: (dataDir: string) => readonly Dataset[];
  /** Which stored firms are no buyer (`wren email screen`, and after every import), or null. */
  readonly screen: CompanyScreen | null;
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
  /** Text sequences (plain data, checked at load: steps in order, STOP in the opener). */
  readonly smsSequences?: readonly SmsSequence[];
  /**
   * The offer each arm pitches, by arm name (an arm is one offer, one hook). Every
   * sequence must open in an arm named here, so every enrollment carries an offer.
   */
  readonly offers: Readonly<Record<string, string>>;
  /** The live campaign's routing: first matching rule wins. */
  readonly plan: readonly EnrollmentRule[];
  /** Rest periods and yearly cap over the defaults (designs/2026-09-30-lead-recycling.md). */
  readonly recontact?: RecontactOverrides;
  readonly companyLocation: (company: Company) => string | null;
  readonly leadSourceFormats?: readonly SourceFormat[];
  readonly personSourceFormats?: readonly PersonSourceFormat[];
  readonly platformDomains?: Iterable<string>;
  readonly datasets?: (dataDir: string) => readonly Dataset[];
  readonly screen?: CompanyScreen;
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
  if (!OFFER_PAGES.has(spec.lander)) {
    throw new Error(
      `niche ${pyReprStr(spec.name)}: lander ${pyReprStr(spec.lander)} is no live offer's page` +
        ` — the site serves: ${[...OFFER_PAGES].sort().join(", ")}`,
    );
  }
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
  const offers = new Map<string, string>();
  const termsByOffer = new Map<string, Readonly<Record<string, string>>>();
  for (const seq of sequences.values()) {
    if (seq.arm === null) {
      throw new Error(
        `niche ${pyReprStr(spec.name)}: sequence ${pyReprStr(seq.name)} opens on a shared` +
          " template, so no arm says what it pitches — move its opener into an arm",
      );
    }
    const offer = spec.offers[seq.arm];
    if (offer === undefined) {
      throw new Error(
        `niche ${pyReprStr(spec.name)}: arm ${pyReprStr(seq.arm)} names no offer in \`offers\``,
      );
    }
    const facts = offerFacts(offerFor(offer)); // offerFor throws on an id the registry does not know
    // Copy quoting a term the offer doesn't set would refuse every draft at compose; say so now.
    for (const step of seq.steps) {
      const unset = [...factKeys(templates.get(step.template) as Template)]
        .filter((k) => k.startsWith("offer.") && !(k in facts))
        .sort();
      if (unset.length > 0) {
        throw new Error(
          `niche ${pyReprStr(spec.name)}: template ${pyReprStr(step.template)} quotes` +
            ` ${unset.join(", ")}, which offer ${pyReprStr(offer)} does not set`,
        );
      }
    }
    offers.set(seq.name, offer);
    termsByOffer.set(offer, facts);
  }
  const armed = new Set([...sequences.values()].map((s) => s.arm));
  const idle = Object.keys(spec.offers).filter((arm) => !armed.has(arm));
  if (idle.length > 0) {
    throw new Error(
      `niche ${pyReprStr(spec.name)}: offers named for arms no sequence opens in: ${idle.sort().join(", ")}`,
    );
  }
  const plan = enrollmentPlan(
    spec.plan,
    new Set(sequences.keys()),
    `niche ${pyReprStr(spec.name)}`,
  );
  const smsSequences = new Map<string, SmsSequence>();
  for (const seq of spec.smsSequences ?? []) {
    if (smsSequences.has(seq.name)) {
      throw new Error(
        `niche ${pyReprStr(spec.name)}: sms sequence ${pyReprStr(seq.name)} registered twice`,
      );
    }
    smsSequences.set(seq.name, checkSequence(seq));
  }
  return {
    name: spec.name,
    factsView: spec.factsView,
    lander: spec.lander,
    crawlHints: new Set(spec.crawlHints),
    discoveryGenericWords: new Set(spec.discoveryGenericWords),
    templates,
    sequences,
    smsSequences,
    offers,
    offerFacts: termsByOffer,
    plan,
    recontact: recontactPolicy(spec.recontact, `niche ${pyReprStr(spec.name)}`),
    companyLocation: spec.companyLocation,
    leadSourceFormats: spec.leadSourceFormats ?? [],
    personSourceFormats: spec.personSourceFormats ?? [],
    platformDomains: new Set(spec.platformDomains ?? []),
    datasets: spec.datasets ?? (() => []),
    screen: spec.screen ?? null,
  };
}

/** A non-blank string under `raw[key]`, or null. */
export function rawLocation(company: Company, key: string): string | null {
  const raw = (company.raw ?? {}) as Record<string, unknown>;
  const value = raw[key];
  return typeof value === "string" && value.trim() ? value : null;
}
