/**
 * Shopify Partners directory: saved listing pages plus fetched profiles.
 *
 * `ShopifyPagesSource` (the `shopify-pages` import format) is parse-only, like every
 * directory adapter: a human saves the paginated listing pages by hand (robots.txt
 * disallows `*page=*` for crawlers, so the paging stays human), and this source reads
 * them plus whatever profile pages the `shopify-partner-profiles` dataset has already
 * fetched to disk (`data/agencies/bulk/shopify-partner-profiles/<slug>.html`; see
 * datasets.ts for the one sanctioned fetching path).
 *
 * A profile page carries what the listing card can't: the firm's own website and a
 * contact email. Website joins the row as its identity domain; the email rides along
 * under "Directory Email", deliberately NOT an `email` alias, so a company-first row
 * never masquerades as a person row. Firms whose profile isn't fetched yet still
 * import: they key by `shopify:<slug>` and re-import cleanly after the fetch.
 */
import { existsSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { extractDomain, type LeadSource, type RawRow } from "@wren/core";
import { augmentedRows, filesHash, pageTokens, readPage, savedPageFiles } from "./directory.js";

export const PROFILE_DATASET_NAME = "shopify-partner-profiles";
export const profileUrl = (slug: string) =>
  `https://www.shopify.com/partners/directory/partner/${slug}`;

const CARD_START = /<div[^>]*data-component-name="listing-profile-card"/g;
export const PROFILE_HREF = /\/partners\/directory\/partner\/([a-z0-9][a-z0-9-]*)/g;
const RATING = /^[0-5]\.\d$/;
const REVIEWS = /^\( ?([\d,]+) ?\)$/;
const LOCATION = /^[^,%\d][^,]{1,39}, [A-Za-z][A-Za-z .]{1,30}$/;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
// The real tier vocabulary, in both shapes profiles render ("Plus tier" badge,
// "Plus Partner" heading). A closed list: a generic word would match filter boilerplate.
const TIER = /\b(Select|Plus|Premier|Platinum)(?: tier| Partner\b)/;
const SINCE = /\bPartner since ([A-Z][a-z]+ \d{4})\b/;

type Card = Record<string, string>;

export class ShopifyPagesSource implements LeadSource {
  readonly sourceType = "shopify_pages";
  readonly sourceRef: string;
  readonly contentHash: string;
  readonly files: string[];
  /** Where fetched profile pages live; a nonstandard layout just means no enrichment. */
  readonly profilesDir: string;

  constructor(readonly path: string) {
    this.files = savedPageFiles(path);
    this.sourceRef = path;
    this.contentHash = filesHash(this.files);
    const base = statSync(path).isDirectory() ? path : dirname(path);
    // data/agencies/shopify/<category> -> data/agencies/bulk/<dataset>
    this.profilesDir = join(dirname(dirname(base)), "bulk", PROFILE_DATASET_NAME);
  }

  *rows(): Generator<RawRow> {
    let count = 0;
    for (const row of augmentedRows(this.cards())) {
      count += 1;
      yield row;
    }
    if (count === 0) {
      throw new Error(
        `${this.sourceRef}: no partner cards parsed — are these really saved Shopify Partners listing pages?`,
      );
    }
  }

  private *cards(): Generator<RawRow> {
    const dir = statSync(this.path).isDirectory() ? this.path : dirname(this.path);
    const category = basename(dir);
    for (const file of this.files) {
      const raw = readPage(file);
      const starts = [...raw.matchAll(CARD_START)].map((m) => m.index);
      for (const [index, start] of starts.entries()) {
        const parsed = parseCard(raw.slice(start, starts[index + 1] ?? raw.length));
        if (parsed === null) continue;
        const { slug, card } = parsed;
        yield {
          ...card,
          ...profileFields(join(this.profilesDir, `${slug}.html`)),
          Category: category,
          Position: String(index + 1),
          "Source File": basename(file),
        };
      }
    }
  }
}

function parseCard(fragment: string): { slug: string; card: Card } | null {
  const slug = new RegExp(PROFILE_HREF.source).exec(fragment)?.[1];
  if (slug === undefined) return null;
  const tokens = pageTokens(fragment);
  if (tokens.length === 0) return null;

  const first = (pattern: RegExp, group = 0): string => {
    for (const token of tokens) {
      const match = pattern.exec(token);
      if (match) return match[group] ?? "";
    }
    return "";
  };
  const after = (label: string): string => {
    const index = tokens.indexOf(label);
    if (index < 0) return "";
    return tokens.slice(index + 1).find((t) => t !== label) ?? "";
  };
  const services = after("Services");
  return {
    slug,
    card: {
      "Company Name": tokens[0] as string,
      Website: "", // filled from the fetched profile when present
      "Profile URL": profileUrl(slug),
      Rating: first(RATING),
      Reviews: first(REVIEWS, 1),
      Location: first(LOCATION),
      "Price Range": after("Price range for services"),
      Services: services.startsWith("+") ? "" : services,
    },
  };
}

/**
 * Contact fields off a fetched profile page, blank-safe: a missing or unparseable
 * file contributes nothing (the row keys by slug and the next import fills these in).
 */
function profileFields(profilePath: string): Record<string, string> {
  if (!existsSync(profilePath)) return {};
  const text = pageTokens(readPage(profilePath)).join(" ");
  // The header/contact region sits above the free-text description; cutting there
  // keeps the patterns from grabbing look-alikes out of prose.
  const cut = text.indexOf("Business description");
  const head = cut > 0 ? text.slice(0, cut) : text.slice(0, 4000);

  const fields: Record<string, string> = {};
  const contactAt = head.indexOf("Contact information");
  if (contactAt >= 0) {
    const contact = head.slice(contactAt, contactAt + 400);
    const email = EMAIL.exec(contact);
    if (email) fields["Directory Email"] = email[0];
    const site = contact.split(/\s+/).find((w) => !w.includes("@") && extractDomain(w) !== null);
    if (site) fields.Website = site;
  }
  // Tier and partner-since live outside the head slice on real pages.
  const tier = TIER.exec(text);
  if (tier) fields["Partner Tier"] = tier[1] as string;
  const since = SINCE.exec(text);
  if (since) fields["Partner Since"] = since[1] as string;
  return fields;
}

/** Whether a fetched page is really a partner profile (a 200-OK bot challenge echoes the URL, not this). */
export const looksLikeProfile = (text: string) =>
  text.includes("Contact information") || text.includes("Business description");

/** Every profile slug in the given hand-saved listing pages. */
export function listingSlugs(pages: readonly string[]): string[] {
  const slugs = new Set<string>();
  for (const file of pages) {
    for (const m of readPage(file).matchAll(PROFILE_HREF)) slugs.add(m[1] as string);
  }
  return [...slugs].sort();
}
