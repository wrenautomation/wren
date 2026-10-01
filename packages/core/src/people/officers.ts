/**
 * Officers from a state business registry (NY's CEO name, Florida's officer list),
 * matched to firms we already hold before they get here. One row a person: the
 * firm by `company_source_key` or `company_domain`, the officer's name and title,
 * and `registry_ref` naming the filing ("ny-dos:4424185"). Niche-agnostic.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { RawRow } from "../ingest/schema.js";
import { decodeCsvBytes, parseCsvRecords, rowsFromRecords } from "../ingest/sources.js";
import {
  type PersonItem,
  PersonRowInvalid,
  parseName,
  personRow,
  personRowError,
} from "./schema.js";
import type { PersonSource, PersonSourceFormat } from "./sources.js";

const cell = (row: RawRow, key: string): string | null => {
  const v = row[key];
  const t = v == null ? "" : String(v).trim();
  return t || null;
};

export function officerPersonRow(row: RawRow, sourceRef: string): PersonItem {
  const name = cell(row, "full_name");
  const parsed = name ? parseName(name) : null;
  if (!parsed) return personRowError("no full_name", row);
  const [fullName, firstName, lastName] = parsed;
  const ref = cell(row, "registry_ref");
  try {
    return personRow({
      fullName,
      firstName,
      lastName,
      title: cell(row, "title"),
      companyName: cell(row, "company_name"),
      companySourceKey: cell(row, "company_source_key"),
      companyDomain: cell(row, "company_domain"),
      origin: "registry",
      originRef: ref ?? sourceRef,
      asOf: cell(row, "as_of"),
      raw: row,
    });
  } catch (e) {
    if (e instanceof PersonRowInvalid) return personRowError(e.message, row);
    throw e;
  }
}

export class OfficersCsvSource implements PersonSource {
  readonly sourceType = "officers";
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
      yield officerPersonRow(row, this.sourceRef);
  }
}

export const OFFICERS_FORMAT: PersonSourceFormat = {
  name: "officers",
  help: "state registry officers matched to held firms: company_source_key|company_domain, full_name, title, registry_ref",
  build: (p) => new OfficersCsvSource(p),
  niche: null,
};
