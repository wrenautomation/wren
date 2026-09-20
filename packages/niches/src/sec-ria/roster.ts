/**
 * The SEC's investment-adviser firm roster (monthly FOIA CSV) as import rows.
 *
 * The roster is company-first (no email columns) and speaks its own dialect: ~448
 * columns, many coded by Form ADV item number ('5A' = employees, '5F(2)(c)' =
 * regulatory AUM), header names the generic alias map shouldn't learn ('Primary
 * Business Name'), Windows-1252 encoding. One row per firm, but 'Website Address'
 * holds only the first-listed URL, a social profile for ~40% of firms. Those firms
 * still import: the CRD becomes the source_key, so a firm without a usable domain
 * gets a domainless company row with its profile kept as social_url; real domains
 * come from discovery and the daily firm feed.
 *
 * The adapter translates the dialect and nothing else: no filtering. Targeting is
 * SQL after import. Rows are augmented, not replaced: canonical keys are prepended
 * and the full original row rides along, so companies.raw keeps every column.
 *
 * The CRD is minted into the IDENTITY_KEY channel, an object no CSV cell can forge.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  decodeCsvBytes,
  IDENTITY_KEY,
  type LeadSource,
  normalizeCountry,
  parseCsvRecords,
  type RawRow,
  rowsFromRecords,
} from "@wren/core";

const URL_SPLIT = /[,;\s]+/;

const cell = (row: RawRow, key: string) => String(row[key] ?? "").trim();
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export class SecInvestmentAdviserSource implements LeadSource {
  readonly sourceType = "sec_investment_advisers";
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
    for (const row of rowsFromRecords(parseCsvRecords(text))) {
      if (!Object.values(row).some((v) => v != null && String(v).trim())) continue;
      const out: RawRow = {
        // Prepended so canonicalize's first-non-empty rule prefers them over any
        // original column that happens to alias.
        company_name: cell(row, "Primary Business Name") || cell(row, "Legal Name"),
        website: primaryUrl(cell(row, "Website Address")),
        geo: geoOf(row),
        country: normalizeCountry(cell(row, "Main Office Country")) ?? "",
        ...row,
      };
      const crd = cell(row, "Organization CRD#");
      // Last, so no CSV cell (always a string) can shadow the minted object.
      if (crd) out[IDENTITY_KEY] = { source_key: `crd:${crd}` };
      yield out;
    }
  }
}

/** A cell can hold several URLs delimited inconsistently; the first token is the primary. */
export function primaryUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return (trimmed.split(URL_SPLIT)[0] as string).replace(/[;,.]+$/, "");
}

/** "City, ST" as the roster wrote it; `companyLocation` reads it back for the lead window. */
function geoOf(row: RawRow): string {
  const city = titleCase(cell(row, "Main Office City"));
  const state = cell(row, "Main Office State");
  return [city, state].filter(Boolean).join(", ");
}
