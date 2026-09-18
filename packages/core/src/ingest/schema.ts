/**
 * Edge validation for imported rows: every raw row is classified before it
 * touches the DB.
 *   valid email                     -> lead row
 *   no email, usable web domain     -> company row
 *   no domain but a minted source_key -> company row with domain null (its platform
 *                                      URL kept as social_url)
 *   nothing to hold onto            -> row error (counted + recorded, never stored)
 * A row with a *broken* email is an error even when its website is usable.
 *
 * Headers are matched through an alias map after normalization. A header that IS
 * a canonical field name verbatim always wins over an alias-derived candidate;
 * among aliases the first non-empty value wins in column order.
 *
 * source_key is registry identity, never a passthrough field: an adapter mints it
 * as a DICT under IDENTITY_KEY. CSV cells are always strings, so no file content
 * can forge that channel.
 */
import {
  emailDomain,
  emailSyntaxError,
  extractDomain,
  isFreemail,
  isPlatformDomain,
  normalizeEmail,
  validDomain,
} from "../emails.js";
import { normalizeCountry } from "./countries.js";

export type RawRow = Record<string, unknown>;

const ALIASES = {
  // "mail" deliberately absent: a postal-address column named "Mail" is common.
  email: ["email", "e_mail", "email_address", "e_mail_address", "work_email", "contact_email"],
  first_name: ["first_name", "firstname", "given_name"],
  last_name: ["last_name", "lastname", "surname", "family_name"],
  full_name: ["full_name", "name", "contact_name", "contact", "owner", "owner_name"],
  title: ["title", "job_title", "position", "role"],
  company_name: [
    "company_name",
    "company",
    "business_name",
    "business",
    "organization",
    "organisation",
  ],
  website: [
    "website",
    "website_url",
    "url",
    "site",
    "web",
    "homepage",
    "domain",
    "company_website",
    "company_domain",
  ],
  persona: ["persona"],
  source: ["source", "lead_source"],
  // source_key deliberately absent: identity arrives only through IDENTITY_KEY.
  geo: ["geo", "location", "city", "state", "region"],
  country: ["country", "country_code", "nation"],
} as const satisfies Record<string, readonly string[]>;

export type CanonicalField = keyof typeof ALIASES;
export const CANONICAL_FIELDS: ReadonlySet<string> = new Set(Object.keys(ALIASES));
const CANONICAL_BY_ALIAS = new Map<string, CanonicalField>();
for (const [field, aliases] of Object.entries(ALIASES)) {
  for (const a of aliases) CANONICAL_BY_ALIAS.set(a, field as CanonicalField);
}
export type Fields = Partial<Record<CanonicalField, string>>;

/** The adapter-identity channel: a registry adapter puts {source_key} here as an object. */
export const IDENTITY_KEY = "_identity";

/** The adapter-minted source_key on this row, or null. Only an object under IDENTITY_KEY counts. */
export function mintedIdentity(raw: RawRow): string | null {
  const minted = raw[IDENTITY_KEY];
  if (typeof minted !== "object" || minted === null || Array.isArray(minted)) return null;
  const key = (minted as { source_key?: unknown }).source_key;
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

export interface LeadRow {
  kind: "lead";
  email: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  companyName: string | null;
  companyDomain: string | null; // null for freemail leads with no website
  socialUrl: string | null; // platform URL the row listed as its website
  country: string | null; // ISO alpha-2, normalized at the edge
  /** Raw country text, or null when no such field existed: distinguishes absent from unrecognized. */
  countryRaw: string | null;
  persona: string | null;
  source: string | null;
  geo: string | null;
  sourceKey: string | null; // adapter-minted registry identity
}
export interface CompanyRow {
  kind: "company";
  domain: string | null;
  name: string | null;
  sourceKey: string | null;
  socialUrl: string | null;
  country: string | null;
}
export interface RowError {
  kind: "error";
  reason: string;
}
export type ClassifiedRow = LeadRow | CompanyRow | RowError;
const rowError = (reason: string): RowError => ({ kind: "error", reason });

const normalizeHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const text = (v: unknown): string | null => {
  if (v == null) return null;
  const t = String(v).trim();
  return t || null;
};

/** Safe: the untouched original rides along in the row's `raw`, so truncating never loses data. */
const clip = (v: string | null, limit: number) =>
  v != null && v.length > limit ? v.slice(0, limit) : v;

export function canonicalize(raw: RawRow, columnMap?: Record<string, string>): Fields {
  const fields: Fields = {};
  // Pass 0: an explicit column_map entry is the operator's direct assertion; it outranks everything.
  if (columnMap) {
    for (const [header, field] of Object.entries(columnMap)) {
      if (!CANONICAL_FIELDS.has(field)) continue;
      const t = text(raw[header]);
      if (t) fields[field as CanonicalField] = t;
    }
  }
  // Pass 1: a header that IS a canonical field name verbatim.
  for (const [key, value] of Object.entries(raw)) {
    const n = normalizeHeader(key);
    if (!CANONICAL_FIELDS.has(n) || fields[n as CanonicalField]) continue;
    const t = text(value);
    if (t) fields[n as CanonicalField] = t;
  }
  // Pass 2: alias-derived candidates; first non-empty per field in column order.
  for (const [key, value] of Object.entries(raw)) {
    const field = CANONICAL_BY_ALIAS.get(normalizeHeader(key));
    if (!field || fields[field]) continue;
    const t = text(value);
    if (t) fields[field] = t;
  }
  return fields;
}

function splitName(fields: Fields): [string | null, string | null] {
  let first = fields.first_name ?? null;
  let last = fields.last_name ?? null;
  const full = fields.full_name;
  if (first == null && last == null && full) {
    if (full.includes(",")) {
      // Government-export standard "SMITH, JOHN": comma means LAST, FIRST.
      const i = full.indexOf(",");
      first = full.slice(i + 1).trim() || null;
      last = full.slice(0, i).trim() || null;
    } else {
      const i = full.indexOf(" ");
      first = i < 0 ? full : full.slice(0, i);
      last = i < 0 ? null : full.slice(i + 1).trim() || null;
    }
  }
  return [first, last];
}

/** Mirrors the DB constraints; a failure rejects THIS row, never the batch. */
export function validateCompanyRow(row: Omit<CompanyRow, "kind">): CompanyRow | RowError {
  if (row.domain != null && !validDomain(row.domain))
    return rowError(`row failed validation: invalid domain '${row.domain}'`);
  if (row.sourceKey != null && row.sourceKey.length > 64)
    return rowError(`row failed validation: source key longer than 64 chars: '${row.sourceKey}'`);
  if (row.domain == null && row.sourceKey == null)
    return rowError("row failed validation: company row needs a domain or a source_key");
  return { kind: "company", ...row, socialUrl: clip(row.socialUrl, 512) };
}
export function validateLeadRow(row: Omit<LeadRow, "kind">): LeadRow | RowError {
  const err = emailSyntaxError(row.email);
  if (err) return rowError(`row failed validation: ${err}`);
  if (row.companyDomain != null && !validDomain(row.companyDomain))
    return rowError(`row failed validation: invalid domain '${row.companyDomain}'`);
  if (row.sourceKey != null && row.sourceKey.length > 64)
    return rowError(`row failed validation: source key longer than 64 chars: '${row.sourceKey}'`);
  return {
    kind: "lead",
    ...row,
    persona: clip(row.persona, 64),
    source: clip(row.source, 64),
    geo: clip(row.geo, 64),
    socialUrl: clip(row.socialUrl, 512),
  };
}

export interface ClassifyOptions {
  columnMap?: Record<string, string>;
  /** Niche-registered listing hosts (clutch.co): a directory profile never keys a company. */
  extraPlatformDomains?: Iterable<string>;
}

export function classifyRow(raw: RawRow, opts: ClassifyOptions = {}): ClassifiedRow {
  const fields = canonicalize(raw, opts.columnMap);
  const mintedKey = mintedIdentity(raw);
  let websiteDomain: string | null = null;
  let socialUrl: string | null = null;
  if (fields.website != null) {
    websiteDomain = extractDomain(fields.website);
    // A LinkedIn/Facebook/maps URL can never key the business, but the profile is data.
    if (websiteDomain && isPlatformDomain(websiteDomain, opts.extraPlatformDomains ?? [])) {
      websiteDomain = null;
      socialUrl = fields.website;
    }
  }
  const emailRaw = fields.email;
  if (emailRaw) {
    const email = normalizeEmail(emailRaw);
    const error = emailSyntaxError(email);
    if (error) return rowError(`invalid email '${emailRaw}': ${error}`);
    const senderDomain = emailDomain(email);
    const companyDomain = websiteDomain ?? (isFreemail(senderDomain) ? null : senderDomain);
    const [firstName, lastName] = splitName(fields);
    const countryRaw = fields.country ?? null;
    return validateLeadRow({
      email,
      firstName,
      lastName,
      title: fields.title ?? null,
      companyName: fields.company_name ?? null,
      companyDomain,
      socialUrl,
      country: normalizeCountry(countryRaw),
      countryRaw,
      persona: fields.persona ?? null,
      source: fields.source ?? null,
      geo: fields.geo ?? null,
      sourceKey: mintedKey,
    });
  }
  if (websiteDomain || mintedKey) {
    return validateCompanyRow({
      domain: websiteDomain,
      name: fields.company_name ?? null,
      sourceKey: mintedKey,
      socialUrl,
      country: normalizeCountry(fields.country),
    });
  }
  // No email, no usable domain, no source_key: nothing any later phase could find it by.
  if (socialUrl)
    return rowError(`website is a platform profile, not a company domain: '${fields.website}'`);
  if (fields.website != null) return rowError(`unusable website '${fields.website}'`);
  if (fields.company_name != null) return rowError("company row without a usable domain");
  return rowError("no email or website");
}
