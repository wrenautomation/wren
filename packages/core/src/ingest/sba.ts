/**
 * SBA Small Business Search answers, as `wren fetch get` writes them (one JSON file
 * per NAICS code per day), turned into import rows. Niche-agnostic: a niche
 * registers a format with the NAICS codes it sells to.
 *
 * Import a directory: a firm listing several of the codes is in several files, so
 * records merge by UEI (the file sorting last, the newest, wins). A firm whose
 * primary NAICS is not one of the niche's codes is declined `not_primary`: it only
 * lists the code on the side (IT and consulting shops listing staffing, mostly).
 *
 * Each record rides along whole under `sba`. Lifted beside it: the named contact
 * (the registry shouts names; they are written as a person would), their title when
 * they are a listed principal, email and phone when the firm lets them show, "City,
 * ST", postcode, the site, and the legal name when the firm trades under another. Identity is domain-first; a firm with no usable site is keyed
 * `sba:<uei>`.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { extractDomain, isPlatformDomain } from "../emails.js";
import { IDENTITY_KEY, type RawRow } from "./schema.js";
import type { LeadSource, SourceFormat } from "./sources.js";

export type SbaFirm = Record<string, unknown>;

const US_STATES: Readonly<Record<string, string>> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "puerto rico": "PR",
  guam: "GU",
  "virgin islands": "VI",
  "u.s. virgin islands": "VI",
  "american samoa": "AS",
  "northern mariana islands": "MP",
};

/** Kept upper when a shouted name or title is written out. */
const KEEP_UPPER = new Set([
  "II",
  "III",
  "IV",
  "VI",
  "VII",
  "VIII",
  "CEO",
  "COO",
  "CFO",
  "CTO",
  "CIO",
  "CMO",
  "CRO",
  "CHRO",
  "CPO",
  "VP",
  "EVP",
  "SVP",
  "HR",
  "IT",
  "LLC",
  "USA",
]);

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null;

const capitalize = (w: string): string => {
  const lower = w.toLowerCase();
  const up = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  return /^mc[a-z]{2,}$/.test(lower) ? `Mc${up(lower.slice(2))}` : up(lower);
};

const SMALL = new Set(["of", "and", "for", "the", "in", "at", "to", "on"]);

/**
 * "JOHN O'NEIL-MCCOY JR" -> "John O'Neil-McCoy Jr", "PRESIDENT/CEO" -> "President/CEO",
 * "VP OF SALES" -> "VP of Sales". Text that already has lowercase is left alone.
 */
export function unshout(s: string): string {
  if (/[a-z]/.test(s)) return s;
  return s
    .split(" ")
    .map((word, i) => {
      if (i > 0 && SMALL.has(word.toLowerCase())) return word.toLowerCase();
      return word
        .split(/([-'/&])/)
        .map((part) => {
          if (/^[-'/&]$/.test(part)) return part;
          return KEEP_UPPER.has(part.replace(/[.,]/g, "")) ? part : capitalize(part);
        })
        .join("");
    })
    .join(" ");
}

/** "Texas" -> "TX"; a two-letter code passes through; anything else -> null. */
export function stateCode(state: string | null): string | null {
  if (!state) return null;
  if (/^[A-Za-z]{2}$/.test(state)) return state.toUpperCase();
  return US_STATES[state.toLowerCase()] ?? null;
}

/** The contact's title when they are one of `current_principals` ("NAME - TITLE; …"). */
export function principalTitle(principals: string | null, contact: string | null): string | null {
  if (!principals || !contact) return null;
  const want = contact.toUpperCase();
  for (const entry of principals.split(";")) {
    const at = entry.indexOf(" - ");
    if (at < 0) continue;
    if (entry.slice(0, at).trim().toUpperCase() === want) {
      const title = entry.slice(at + 3).trim();
      return title ? unshout(title) : null;
    }
  }
  return null;
}

/** The firm's first usable site: `website`, else `additional_website`. */
function firmSite(firm: SbaFirm): { website: string; domain: string } | null {
  for (const key of ["website", "additional_website"]) {
    const site = text(firm[key]);
    const domain = site ? extractDomain(site) : null;
    if (site && domain && !isPlatformDomain(domain)) return { website: site, domain };
  }
  return null;
}

/** One firm -> an import row: canonical fields first, the record whole under `sba`. */
export function sbaRow(firm: SbaFirm): RawRow {
  const legal = text(firm.legal_business_name);
  const name = text(firm.dba_name) ?? legal;
  const postcode = text(firm.zipcode);
  const site = firmSite(firm);
  const email = firm.display_email === false ? null : text(firm.email);
  const phone = firm.display_phone === false ? null : text(firm.phone);
  const contact = text(firm.contact_person);
  const title = principalTitle(text(firm.current_principals), contact);
  const city = text(firm.city);
  const geo = [city ? unshout(city) : null, stateCode(text(firm.state))].filter(Boolean).join(", ");
  const out: RawRow = {
    ...(name ? { company_name: name } : {}),
    ...(legal && legal !== name ? { legal_name: legal } : {}),
    ...(site ? { website: site.website } : {}),
    ...(email?.includes("@") ? { email } : {}),
    ...(contact ? { full_name: unshout(contact) } : {}),
    ...(title ? { title } : {}),
    ...(phone ? { phone } : {}),
    ...(geo ? { geo } : {}),
    ...(postcode ? { postcode } : {}),
    country: "US",
    source: "sba_search",
    sba: firm,
  };
  const uei = text(firm.uei);
  if (uei && !site) out[IDENTITY_KEY] = { source_key: `sba:${uei}` };
  return out;
}

const fetchedOn = (file: string): string => /(\d{4}-\d{2}-\d{2})\.json$/.exec(file)?.[1] ?? "";

/**
 * The answer files under `path` (a file, or a directory of `*.json`), oldest fetch
 * first (the date in the name), so a firm's newest answer wins whatever its code.
 */
function answerFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => fetchedOn(a).localeCompare(fetchedOn(b)) || a.localeCompare(b))
    .map((f) => join(path, f));
}

export class SbaSearchSource implements LeadSource {
  readonly sourceType = "sba_search";
  readonly sourceRef: string;
  readonly contentHash: string;
  readonly files: string[];
  private readonly counts: Record<string, number> = {};

  constructor(
    readonly path: string,
    private readonly naics: ReadonlySet<string>,
  ) {
    this.sourceRef = path;
    this.files = answerFiles(path);
    if (!this.files.length) throw new Error(`${path}: no SBA answer files (*.json)`);
    const hash = createHash("sha256");
    for (const f of this.files) hash.update(readFileSync(f));
    this.contentHash = hash.digest("hex");
  }

  *rows(): Generator<RawRow> {
    const byUei = new Map<string, SbaFirm>();
    const noUei: SbaFirm[] = [];
    for (const file of this.files) {
      const results = (JSON.parse(readFileSync(file, "utf8")) as { results?: unknown }).results;
      if (!Array.isArray(results))
        throw new Error(`${file}: not an SBA search answer (no results)`);
      for (const firm of results) {
        if (typeof firm !== "object" || firm === null) continue;
        const uei = text((firm as SbaFirm).uei);
        if (uei) byUei.set(uei, firm as SbaFirm);
        else noUei.push(firm as SbaFirm);
      }
    }
    for (const firm of [...byUei.values(), ...noUei]) {
      const primary = text(firm.naics_primary);
      if (!primary || !this.naics.has(primary)) {
        this.counts.not_primary = (this.counts.not_primary ?? 0) + 1;
        continue;
      }
      yield sbaRow(firm);
    }
  }

  declined(): Record<string, number> {
    return { ...this.counts };
  }
}

/** A niche's SBA search import format: `naics` are the primary codes it keeps. */
export function sbaSearchFormat(spec: {
  name: string;
  help: string;
  niche: string;
  naics: readonly string[];
}): SourceFormat {
  const naics = new Set(spec.naics);
  return {
    name: spec.name,
    help: spec.help,
    build: (p) => new SbaSearchSource(p, naics),
    niche: spec.niche,
    columnMapped: false,
    directory: true,
  };
}
