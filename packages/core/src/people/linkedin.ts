/**
 * LinkedIn people, as autobrowse's `people` command writes them: one row a
 * person, their current role, and (enriched) the employer's website off its
 * LinkedIn page. Niche-agnostic: an RIA founder and an agency owner arrive
 * the same way.
 *
 * The company is found by its website's domain, so a LinkedIn founder meets
 * the firm a Maps or registry import already made. With no website the
 * company is keyed by its LinkedIn page (`li-co:<handle>`); with neither the
 * row is an error, kept in import_errors whole. The person is keyed by their
 * profile (`li:<vanity>`), so a re-import is a sighting, not a second person.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extractDomain, isPlatformDomain } from "../emails.js";
import type { RawRow } from "../ingest/schema.js";
import { decodeCsvBytes, parseCsvRecords, rowsFromRecords } from "../ingest/sources.js";
import {
  type PersonItem,
  PersonRowInvalid,
  parseDirectName,
  personRow,
  personRowError,
} from "./schema.js";
import type { PersonSource, PersonSourceFormat } from "./sources.js";

const cell = (row: RawRow, key: string): string | null => {
  const v = row[key];
  const t = v == null ? "" : String(v).trim();
  return t || null;
};

const handleOf = (url: string | null, kind: "in" | "company"): string | null => {
  const m = url ? new RegExp(`linkedin\\.com/${kind}/([^/?#]+)`).exec(url) : null;
  return m?.[1] ? decodeURIComponent(m[1]).toLowerCase() : null;
};

/** A key only when it fits the column; a longer one is no key, never a cut one. */
const key = (prefix: string, handle: string | null) =>
  handle && prefix.length + handle.length <= 64 ? `${prefix}${handle}` : null;

export function linkedinPersonRow(row: RawRow, sourceRef: string): PersonItem {
  const name = cell(row, "full_name");
  const parsed = name ? parseDirectName(name) : null;
  if (!parsed) return personRowError("no full_name", row);
  const [fullName, firstName, lastName] = parsed;
  const website = cell(row, "website");
  const domain = website ? extractDomain(website) : null;
  const companyDomain = domain && !isPlatformDomain(domain, []) ? domain : null;
  const profile = cell(row, "linkedin_url");
  try {
    return personRow({
      fullName,
      firstName,
      lastName,
      title: cell(row, "title"),
      companyName: cell(row, "company_name"),
      companyDomain,
      companySourceKey: companyDomain
        ? null
        : key("li-co:", handleOf(cell(row, "company_linkedin"), "company")),
      sourceKey: key("li:", handleOf(profile, "in")),
      linkedinUrl: profile,
      origin: "linkedin",
      originRef: profile ?? sourceRef,
      raw: row,
    });
  } catch (e) {
    if (e instanceof PersonRowInvalid) return personRowError(e.message, row);
    throw e;
  }
}

export class LinkedInPeopleCsvSource implements PersonSource {
  readonly sourceType = "linkedin";
  readonly sourceRef: string;
  readonly contentHash: string;
  private readonly bytes: Uint8Array;

  constructor(readonly path: string) {
    this.sourceRef = path;
    this.bytes = readFileSync(path);
    this.contentHash = createHash("sha256").update(this.bytes).digest("hex");
  }

  *rows(): Generator<PersonItem> {
    const { text } = decodeCsvBytes(this.bytes, this.path);
    for (const row of rowsFromRecords(parseCsvRecords(text)))
      yield linkedinPersonRow(row, this.sourceRef);
  }
}

/** People formats every niche can use. */
export const BUILTIN_PERSON_FORMATS: readonly PersonSourceFormat[] = [
  {
    name: "linkedin",
    help: "autobrowse `people` CSV: LinkedIn profiles, current role, employer website",
    build: (p) => new LinkedInPeopleCsvSource(p),
    niche: null,
  },
];
