/**
 * Google Maps listings, as the current Maps scraper writes them (the MIT google-maps-scraper image)
 * (its CSV download or `-results out.csv`), turned into import rows. Niche-agnostic:
 * any local-business niche (HVAC, dentists, insurance) sources the same way.
 *
 * The file arrives from outside; this module never fetches. Rows are company-first:
 * `title` is the business name, `emails` (comma list, scraped from the website) gives
 * the general inbox. Identity is domain-first; a listing with no usable website is
 * keyed `gmaps:<cid>` (the place's stable id), never by its Maps URL.
 *
 * Scraper headers that alias to a person field (`title` = job title, `owner` = full
 * name) are re-homed under "<header> (raw)", so no business name reads as a person.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  emailDomain,
  extractDomain,
  isFreemail,
  isPlatformDomain,
  registrableDomain,
} from "../emails.js";
import { canonicalize, IDENTITY_KEY, type RawRow } from "./schema.js";
import { decodeCsvBytes, type LeadSource, parseCsvRecords, rowsFromRecords } from "./sources.js";

const cell = (row: RawRow, key: string): string | null => {
  const v = row[key];
  const t = v == null ? "" : String(v).trim();
  return t || null;
};

/** `complete_address` is a JSON object; a bad cell is data, not a reason to drop the row. */
function address(row: RawRow): {
  city?: string | undefined;
  state?: string | undefined;
  country?: string | undefined;
} {
  const raw = cell(row, "complete_address");
  if (!raw) return {};
  try {
    const a = JSON.parse(raw) as Record<string, unknown>;
    const s = (k: string) => (typeof a[k] === "string" && a[k] ? (a[k] as string) : undefined);
    return { city: s("city"), state: s("state"), country: s("country") };
  } catch {
    return {};
  }
}

/**
 * The firm's inbox from `emails`: one on its site's domain, else a free-mail one. Another
 * domain on a firm's site is its web agency or a vendor (wpm@webmastered.com), not the firm.
 * No site: the first. The whole cell rides along either way.
 */
function inbox(row: RawRow, domain: string | null): string | undefined {
  const all = (cell(row, "emails") ?? "").split(/[,;\s]+/).filter((e) => e.includes("@"));
  if (!domain) return all[0];
  const site = registrableDomain(domain);
  return (
    all.find((e) => registrableDomain(emailDomain(e)) === site) ??
    all.find((e) => isFreemail(emailDomain(e)))
  );
}

/** One scraper row -> an import row: canonical fields first, the listing riding along. */
export function mapsRow(row: RawRow): RawRow {
  const name = cell(row, "title");
  const website = cell(row, "website");
  const domain = website ? extractDomain(website) : null;
  const own = domain && !isPlatformDomain(domain) ? domain : null;
  const email = inbox(row, own);
  const { city, state, country } = address(row);
  const geo = [city, state].filter(Boolean).join(", ");
  const out: RawRow = {
    ...(name ? { company_name: name } : {}),
    ...(website ? { website } : {}),
    ...(email ? { email } : {}),
    ...(geo ? { geo } : {}),
    ...(country ? { country } : {}),
    source: "google_maps",
  };
  for (const [header, value] of Object.entries(row)) {
    const aliased = Object.keys(canonicalize({ [header]: "x" })).length > 0;
    out[aliased || header in out ? `${header} (raw)` : header] = value;
  }
  const cid = cell(row, "cid");
  if (cid && !own) out[IDENTITY_KEY] = { source_key: `gmaps:${cid}` };
  return out;
}

export class GoogleMapsCsvSource implements LeadSource {
  readonly sourceType = "google_maps";
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
    for (const row of rowsFromRecords(parseCsvRecords(text))) yield mapsRow(row);
  }
}
