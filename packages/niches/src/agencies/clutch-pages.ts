/**
 * Saved Clutch listing pages -> import rows.
 *
 * A human browses clutch.co at human pace and saves each listing page (Cmd+S into
 * `data/agencies/clutch/<category>/`); this source parses the saved files. It must
 * never grow a fetching path: Clutch's terms ban automated extraction.
 *
 * One category directory = one import batch, so batch provenance IS the segment
 * cohort. Each provider card yields one row in the collection-sheet dialect
 * (directory.ts normalizes the headers into identity fields and agency.* facts):
 * name and profile URL always; the real website only when the card's redirect link
 * carries it. Sponsored cards hide theirs behind a PPC click tracker; those rows key
 * by `clutch:<slug>` and pick up a domain later via discovery.
 *
 * Parsing is token-pattern extraction over each card's visible text: the saved
 * corpus is frozen bytes, so matching the captured markup beats maintaining a DOM's
 * worth of selectors, and a Clutch redesign only affects FUTURE captures, which
 * arrive through a human who will notice the page looks different.
 */
import { readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { LeadSource, RawRow } from "@wren/core";
import {
  augmentedRows,
  filesHash,
  pageTokens,
  readPage,
  savedPageFiles,
  unescapeHtml,
} from "./directory.js";

const CARD_START = /<div[^>]*class="[^"]*\bprovider-row\b[^"]*"/g;
const TITLE_ANCHOR = /<a\b[^>]*provider__title-link[^>]*>([\s\S]*?)<\/a>/;
const PROFILE_LINK = /https:\/\/clutch\.co\/profile\/[a-z0-9-]+/;
const HREF = /href="([^"]+)"/;
const REDIRECT = /href="(https:\/\/r\.clutch\.co\/redirect\?[^"]+)"/;
const PAGE_NUMBER = /[Pp]age (\d+)\b/;

// Card-token field shapes, matched wherever they appear so a reordered template
// degrades to blanks (repairable) instead of misfiled values.
const MIN_BUDGET = /^\$[\d,]+\+$/;
const HOURLY = /^(?:< )?\$[\d,]+(?: - \$[\d,]+)?\+? *\/ *hr$/;
const TEAM = /^[\d,]+ *- *[\d,]+$|^Freelancer$/;
const RATING = /^[0-5]\.\d$/;
const REVIEWS = /^([\d,]+) reviews?$/;
const SERVICE = /^\d+% \S/;
const LOCATION = /^[^,%\d][^,]{1,39}, [A-Za-z][A-Za-z .]{1,30}$/;
const BADGES = new Set(["Premier Verified", "Verified"]);
/** Tokens that end a card's data region; everything after is CTA chrome (or the footer). */
const CARD_END = new Set(["View Profile", "Visit Website", "See Portfolio"]);

type Card = Record<string, string>;

export class ClutchPagesSource implements LeadSource {
  readonly sourceType = "clutch_pages";
  readonly sourceRef: string;
  readonly contentHash: string;
  readonly files: string[];

  constructor(readonly path: string) {
    this.files = savedPageFiles(path);
    this.sourceRef = path;
    this.contentHash = filesHash(this.files);
  }

  *rows(): Generator<RawRow> {
    let count = 0;
    for (const row of augmentedRows(this.cards())) {
      count += 1;
      yield row;
    }
    // Files that parse to zero cards are the wrong files, not a drained category.
    if (count === 0) {
      throw new Error(
        `${this.sourceRef}: no provider cards parsed — are these really saved Clutch listing pages?`,
      );
    }
  }

  private *cards(): Generator<RawRow> {
    const dir = statSync(this.path).isDirectory() ? this.path : dirname(this.path);
    const category = basename(dir);
    const websites = websiteByProfile(this.path, this.files);
    for (const file of this.files) {
      const page = PAGE_NUMBER.exec(basename(file))?.[1] ?? "";
      const cards = cardFragments(readPage(file));
      for (const [index, fragment] of cards.entries()) {
        const row = parseCard(fragment);
        if (row === null) continue; // a provider-row wrapper with no title = chrome
        if (!row.Website) {
          // The same firm is often sponsored here (tracker URL only) and organic
          // elsewhere (real destination). Fill from any sibling card sharing the
          // profile URL, or the two cards import as two companies.
          row.Website = websites.get(row["Profile URL"] as string) ?? "";
        }
        yield {
          ...row,
          Category: category,
          Page: page,
          Position: String(index + 1),
          "Source File": basename(file),
        };
      }
    }
  }
}

/** Each provider card's markup, from its wrapper to the next wrapper (or the end of the page). */
function cardFragments(raw: string): string[] {
  const starts = [...raw.matchAll(CARD_START)].map((m) => m.index);
  return starts.map((start, i) => raw.slice(start, starts[i + 1] ?? raw.length));
}

/**
 * profile URL -> real website, read from EVERY saved Clutch page under the capture
 * root (the category's siblings included): cross-category is where the
 * sponsored/organic split usually happens. Falls back to the given files when the
 * conventional layout isn't there.
 */
function websiteByProfile(path: string, own: readonly string[]): Map<string, string> {
  const dir = statSync(path).isDirectory() ? path : dirname(path);
  const root = dirname(dir);
  let files: string[] = [];
  try {
    files = siblingPages(root);
  } catch {
    files = [];
  }
  if (files.length === 0) files = [...own];
  const websites = new Map<string, string>();
  for (const file of files) {
    for (const fragment of cardFragments(readPage(file))) {
      const row = parseCard(fragment);
      if (row?.Website && row["Profile URL"] && !websites.has(row["Profile URL"]))
        websites.set(row["Profile URL"], row.Website);
    }
  }
  return websites;
}

/** Every saved page one level under each of the capture root's category folders, in name order. */
function siblingPages(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const name of readdirSync(join(root, entry.name))) {
      if (name.toLowerCase().endsWith(".html")) files.push(join(root, entry.name, name));
    }
  }
  return files.sort();
}

const stripFragmentAndQuery = (url: string) => url.split("#")[0]?.split("?")[0] ?? "";

function parseCard(fragment: string): Card | null {
  const title = TITLE_ANCHOR.exec(fragment);
  if (title === null) return null;
  const anchorTag = fragment.slice(title.index, fragment.indexOf(">", title.index) + 1);
  const href = HREF.exec(anchorTag);
  let profileUrl = href ? stripFragmentAndQuery(unescapeHtml(href[1] as string)) : "";
  if (!profileUrl.includes("clutch.co/profile/")) {
    // Spotlight (ad) cards route even their title through the redirect tracker; the
    // direct profile link still appears elsewhere in the card (the reviews anchor).
    profileUrl = PROFILE_LINK.exec(fragment)?.[0] ?? "";
  }
  const name = unescapeHtml((title[1] as string).replace(/<[^>]+>/g, " "))
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");

  const redirect = redirectFields(fragment);
  let tokens = pageTokens(fragment.slice(title.index));
  const end = tokens.findIndex((t) => CARD_END.has(t));
  if (end >= 0) tokens = tokens.slice(0, end);

  const first = (pattern: RegExp, group = 0): string => {
    for (const token of tokens) {
      const match = pattern.exec(token);
      if (match) return match[group] ?? "";
    }
    return "";
  };
  const services = tokens.filter((t) => SERVICE.test(t));
  const badge = tokens.find((t) => BADGES.has(t)) ?? "";
  const sponsored = redirect.sponsored || tokens.includes("Sponsor");
  return {
    "Company Name": name,
    Website: redirect.website,
    "Profile URL": profileUrl,
    "Min. Project Size": first(MIN_BUDGET),
    "Avg. Hourly Rate": first(HOURLY),
    "Company Size": first(TEAM),
    Rating: first(RATING),
    Reviews: first(REVIEWS, 1),
    Location: first(LOCATION),
    Services: services.join(", "),
    Verification: badge,
    Sponsored: sponsored ? "yes" : "",
    "Listing URL": redirect.listingUrl,
  };
}

/**
 * (real website, sponsored?, listing URL) off the card's r.clutch.co redirect.
 * Organic cards carry the destination in `u`; sponsored ones point `u` at the PPC
 * click tracker, an ad's accounting URL, never the firm's site.
 */
function redirectFields(fragment: string): {
  website: string;
  sponsored: boolean;
  listingUrl: string;
} {
  const match = REDIRECT.exec(fragment);
  if (match === null) return { website: "", sponsored: false, listingUrl: "" };
  let query: URLSearchParams;
  try {
    query = new URL(unescapeHtml(match[1] as string)).searchParams;
  } catch {
    return { website: "", sponsored: false, listingUrl: "" };
  }
  const destination = query.get("u") ?? "";
  const listingUrl = query.get("from_page") ?? "";
  const sponsored = query.get("is_sponsor") === "true";
  if (!destination || destination.includes("ppc.clutch.co"))
    return { website: "", sponsored: true, listingUrl };
  return { website: destination.split("?")[0] as string, sponsored, listingUrl };
}
