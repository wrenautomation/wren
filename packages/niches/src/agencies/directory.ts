/**
 * Agency-directory exports (Clutch, DesignRush, Sortlist, …) as import rows.
 *
 * The agencies niche has no lawful bulk feed: the directories' terms ban automated
 * extraction, so rows arrive as MANUAL exports (a human copies listings into a CSV,
 * or saves the listing pages) and this module translates them. It must never grow
 * a fetching path.
 *
 * Identity is domain-first: a row whose website is a real business domain needs no
 * key. A scheme-prefixed slug key (`clutch:instrument`) is minted only when the row
 * has no usable domain, and only from a URL that names one listing (parent path
 * segment profile/agency/company/partner): a category URL names many firms, and
 * keying on it would fold them into one company, the unrepairable failure. Minted
 * keys ride the IDENTITY_KEY channel, so no raw column can forge one. A row with no
 * domain and no listing URL is a RowError: stored whole in import_errors, never
 * dropped.
 *
 * Rows are augmented, not replaced: a prepend is added only when it adds something
 * and the original row rides along, except that a cell whose header collides with a
 * prepended key is re-homed under "<header> (raw)" (non-blank) or dropped (blank).
 *
 * The format owns its dialect end to end, so `--map` is refused for it.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  canonicalize,
  decodeCsvBytes,
  extractDomain,
  IDENTITY_KEY,
  isPlatformDomain,
  type LeadSource,
  parseCsvRecords,
  type RawRow,
  rowsFromRecords,
} from "@wren/core";
import { HEADER_MAP } from "./facts.js";

/**
 * Listing hosts this niche sources from. Registered as the niche's platform domains:
 * a listing URL identifies the directory, never the business, in every import.
 */
export const DIRECTORY_DOMAINS: ReadonlySet<string> = new Set([
  "clutch.co",
  "designrush.com",
  "sortlist.com",
  "agencyspotter.com",
  "goodfirms.co",
  "upcity.com",
  "behance.net",
  "dribbble.com",
  // The Shopify Partners directory and hosted storefronts: a myshopify.com
  // subdomain is a merchant's rented address, never an agency's own domain.
  "shopify.com",
  "myshopify.com",
]);

/** Headers the manual-export template uses for the directory profile URL (matched after normalization). */
const PROFILE_HEADERS = new Set([
  "profile_url",
  "profile",
  "listing_url",
  "listing",
  "directory_url",
]);
const FACT_BY_HEADER = new Map(
  Object.entries(HEADER_MAP).flatMap(([fact, headers]) => headers.map((h) => [h, fact] as const)),
);
/** Path parents that name ONE listing on the directories above; "partner" is Shopify's shape. */
const LISTING_PARENTS = new Set(["profile", "agency", "company", "partner"]);
/** companies.source_key is varchar(64); a longer key would reject a row over an identity it never needed. */
const MAX_KEY_LENGTH = 64;

const blankish = (v: unknown) => v == null || !String(v).trim();

/** Header normalization, with the `__2` dedupe suffix stripped so a spare column still counts. */
const normalized = (header: string) =>
  header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_\d+$/, "");

/**
 * The directory identity policy over any dialect's raw rows: canonical prepends and
 * agency.* facts merged in, minted slug keys moved to the IDENTITY_KEY channel.
 * Shared by the CSV export source and the saved-page sources so their identity
 * behaviour can never drift apart.
 *
 * Same-source slug-key collisions across DIFFERENT names are the category-URL paste
 * (two firms copied off one listing page): the second row's key is withheld, so it
 * surfaces as a RowError instead of a silent merge.
 */
export function* augmentedRows(rawRows: Iterable<RawRow>): Generator<RawRow> {
  const mintedNames = new Map<string, string>();
  for (const row of rawRows) {
    if (!Object.values(row).some((v) => !blankish(v))) continue;
    const prepends: Record<string, string> = { ...prependsFor(row), ...factsOf(row) };
    const key = prepends.source_key;
    delete prepends.source_key;
    const merged: RawRow = { ...prepends };
    for (const [header, value] of Object.entries(row)) {
      if (header in prepends) {
        if (!blankish(value)) merged[`${header} (raw)`] = value;
        continue;
      }
      merged[header] = value;
    }
    if (key) {
      // Directory exports are company-first, but a bare "Name" column aliases to
      // full_name in the generic vocabulary: either field is this row's name signal.
      const fields = canonicalize(row);
      const name = fields.company_name ?? fields.full_name ?? "";
      const seen = mintedNames.get(key);
      if (seen === undefined) mintedNames.set(key, name);
      if (seen === undefined || seen === name) merged[IDENTITY_KEY] = { source_key: key };
    }
    yield merged;
  }
}

export class AgencyDirectoryCsvSource implements LeadSource {
  readonly sourceType = "agency_directory";
  readonly sourceRef: string;
  readonly contentHash: string;
  private readonly bytes: Uint8Array;

  constructor(readonly path: string) {
    this.sourceRef = path;
    this.bytes = readFileSync(path);
    this.contentHash = createHash("sha256").update(this.bytes).digest("hex");
  }

  *rows(): Generator<RawRow> {
    const { text } = decodeCsvBytes(this.bytes, this.path);
    yield* augmentedRows(rowsFromRecords(parseCsvRecords(text)));
  }
}
// --- saved-page dialect helpers (clutch-pages / shopify-pages) ---

const SKIP_ELEMENTS = /<(script|style|noscript|svg)\b[\s\S]*?<\/\1\s*>/gi;
const TAG = /<[^>]+>/g;
const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** HTML entities to text: the named handful plus numeric forms. */
export function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1]?.toLowerCase() === "x" ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Visible text of an HTML fragment as ordered, tag-delimited tokens. Directory cards
 * put each datum in its own element, so tokens line up with fields without a DOM.
 */
export function pageTokens(fragment: string): string[] {
  const text = fragment.replace(SKIP_ELEMENTS, " ");
  const tokens: string[] = [];
  for (const part of text.split(TAG)) {
    const token = unescapeHtml(part).split(/\s+/).filter(Boolean).join(" ");
    if (token) tokens.push(token);
  }
  return tokens;
}

const isHtml = (name: string) => [".html", ".htm"].includes(extname(name).toLowerCase());

/**
 * The *.html files a saved-page source reads: the file itself, or a category
 * directory's saves in name order. An empty input refuses loudly: a typo'd path
 * importing zero rows would read as a drained category, not the mistake it is.
 */
export function savedPageFiles(path: string): string[] {
  if (statSync(path).isFile()) {
    if (!isHtml(path)) throw new Error(`${path} is not a saved .html page`);
    return [path];
  }
  const files = readdirSync(path)
    .filter((name) => extname(name).toLowerCase() === ".html")
    .sort()
    .map((name) => join(path, name));
  if (files.length === 0) throw new Error(`no .html files under ${path} — nothing to import`);
  return files;
}

/** One content hash over many saved pages (name + per-file digest, in order). */
export function filesHash(files: readonly string[]): string {
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(basename(file));
    digest.update(createHash("sha256").update(readFileSync(file)).digest());
  }
  return digest.digest("hex");
}

/** Saved pages are read leniently: a stray byte must not sink a whole category. */
export const readPage = (file: string) =>
  new TextDecoder("utf-8", { fatal: false }).decode(readFileSync(file));

/**
 * Domain-first identity for one row: canonical prepends plus, under "source_key", a
 * minted slug key (moved to the identity channel by the caller). Runs the row through
 * the same vocabulary classifyRow will use, so this policy and the classifier can
 * never disagree about which column is the website.
 */
function prependsFor(row: RawRow): Record<string, string> {
  const fields = canonicalize(row);
  const prepends: Record<string, string> = {};
  if (!fields.email && !fields.company_name && fields.full_name) {
    // A row with no email holds no person: the name is the agency's.
    prepends.company_name = fields.full_name;
  }
  const website = fields.website;
  const urls = [website, profileUrl(row)].filter((u): u is string => Boolean(u));

  for (const url of urls) {
    const domain = extractDomain(url);
    if (domain && !isPlatformDomain(domain, DIRECTORY_DOMAINS)) {
      // A real domain identifies the agency; no key is minted. From the profile
      // column (operator put the live site there) it becomes the website.
      if (url !== website) prepends.website = url;
      return prepends;
    }
  }
  const directoryUrl = urls.find((u) => {
    const d = extractDomain(u);
    return d !== null && isPlatformDomain(d, DIRECTORY_DOMAINS);
  });
  if (!directoryUrl) return prepends; // nothing to key by; classifyRow records the row whole
  const key = slugKey(directoryUrl);
  if (!key) return prepends; // not a listing URL: better keyless than folding firms
  prepends.source_key = key;
  // The profile becomes the website field so classifyRow keeps it as social_url.
  if (!website) prepends.website = directoryUrl;
  return prepends;
}

/** The row's fact cells under normalized agency.* keys; first non-empty column wins per fact. */
function factsOf(row: RawRow): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value == null) continue;
    const fact = FACT_BY_HEADER.get(normalized(key));
    if (fact === undefined || fact in facts) continue;
    const text = String(value).trim();
    if (text) facts[fact] = text;
  }
  return facts;
}

function profileUrl(row: RawRow): string | null {
  for (const [key, value] of Object.entries(row)) {
    if (value == null || !PROFILE_HEADERS.has(normalized(key))) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

/**
 * `clutch:instrument` from https://clutch.co/profile/instrument: the scheme is the
 * directory's first host label, the slug the last path segment, accepted only when
 * its parent segment marks a single listing. A key that would overflow the column
 * is refused rather than sinking a row that never needed it.
 */
export function slugKey(url: string): string {
  const domain = extractDomain(url);
  if (!domain) return "";
  let pathname: string;
  try {
    pathname = new URL(url.includes("://") ? url : `https://${url}`).pathname;
  } catch {
    return "";
  }
  const segments = pathname.split("/").filter(Boolean);
  const parent = segments.at(-2)?.toLowerCase();
  if (segments.length < 2 || parent === undefined || !LISTING_PARENTS.has(parent)) return "";
  const slug = (segments.at(-1) as string)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "";
  const key = `${domain.split(".")[0]}:${slug}`;
  return key.length <= MAX_KEY_LENGTH ? key : "";
}
