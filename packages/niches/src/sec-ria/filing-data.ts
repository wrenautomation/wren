/**
 * The SEC's monthly ADV filing-data zip as person rows.
 *
 * One zip holds every ADV filing submitted that month as per-section CSVs keyed by
 * FilingID. Three members matter for people:
 * - IA_ADV_Base_A: the FilingID -> firm join (1E1 = CRD, 1B1/1A = names,
 *   DateSubmitted). 1D is the 801- SEC file number, NOT the CRD.
 * - IA_Schedule_A_B: direct (A) and indirect (B) owners and executive officers.
 *   Individuals carry DE/FE/I = "I" and inverted names ("NESS, BRIAN, STEVEN");
 *   entity rows are owners, not people, and are skipped (the zip keeps them).
 * - IA_ADV_1J_1K: the Chief Compliance Officer's name (1J1) and the additional
 *   regulatory contact (1K), both in direct order. These power the avoid-list; when
 *   the CCO also appears on Schedule A the importer's name match merges them and
 *   flips is_compliance.
 *
 * ERA_* members (exempt reporting advisers) are a future pool, deliberately not
 * parsed. The adapter translates dialect and nothing else; identity, dedupe and
 * storage policy live in the generic people importer.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  type PersonItem,
  PersonRowInvalid,
  type PersonSource,
  parseCsvRecords,
  parseDirectName,
  parseInvertedName,
  personRow,
  type RawRow,
  rowsFromRecords,
} from "@wren/core";
import { unzipSync } from "fflate";

const BASE_MEMBER = "IA_ADV_Base_A_";
const SCHEDULE_MEMBER = "IA_Schedule_A_B_";
const CCO_MEMBER = "IA_ADV_1J_1K_";

interface Filing {
  crd: string;
  firmName: string | null;
  submitted: string | null;
}

const cell = (row: RawRow, key: string) => String(row[key] ?? "").trim();

export class AdvFilingDataSource implements PersonSource {
  readonly sourceType = "sec-adv-filing-data";
  readonly sourceRef: string;
  readonly contentHash: string;
  private readonly bytes: Uint8Array;

  constructor(readonly path: string) {
    this.sourceRef = path;
    this.bytes = readFileSync(path);
    this.contentHash = createHash("sha256").update(this.bytes).digest("hex");
  }

  *rows(): Generator<PersonItem> {
    const members = unzipSync(this.bytes);
    const names = Object.keys(members);
    const member = (prefix: string): string => {
      const matches = names.filter((n) => basename(n).startsWith(prefix));
      if (matches.length !== 1) {
        throw new Error(
          `${basename(this.path)}: expected one ${prefix}* member, found ${JSON.stringify(matches)}`,
        );
      }
      return matches[0] as string;
    };
    // cp1252, like every SEC IAPD product; rowsFromRecords keeps duplicate headers
    // and overflow cells, so raw provenance is complete.
    const csvRows = (name: string) =>
      rowsFromRecords(
        parseCsvRecords(new TextDecoder("windows-1252").decode(members[name] as Uint8Array)),
      );

    const baseMember = member(BASE_MEMBER);
    const filings = new Map<string, Filing>();
    for (const row of csvRows(baseMember)) {
      const filingId = cell(row, "FilingID");
      if (!filingId) continue;
      filings.set(filingId, {
        crd: cell(row, "1E1"),
        firmName: cell(row, "1B1") || cell(row, "1A") || null,
        submitted: submittedOn(row),
      });
    }

    const scheduleMember = member(SCHEDULE_MEMBER);
    for (const row of csvRows(scheduleMember)) {
      if (cell(row, "DE/FE/I").toUpperCase() !== "I") continue; // entity owners are not people
      yield this.schedulePerson(row, filings, scheduleMember);
    }

    const ccoMember = member(CCO_MEMBER);
    for (const row of csvRows(ccoMember)) {
      for (const [column, title, isCompliance] of [
        ["1J1 Name", "Chief Compliance Officer", true],
        ["1K Name", "Additional Regulatory Contact (ADV Item 1K)", false],
      ] as const) {
        const name = cell(row, column);
        if (!name) continue;
        yield this.contactPerson(row, filings, ccoMember, name, title, isCompliance);
      }
    }
  }

  private schedulePerson(row: RawRow, filings: Map<string, Filing>, member: string): PersonItem {
    const filingId = cell(row, "FilingID");
    const filing = resolveFiling(filings, filingId);
    if (typeof filing === "string") return { kind: "error", reason: filing, raw: row };
    const parsed = parseInvertedName(cell(row, "Full Legal Name"));
    if (parsed === null)
      return { kind: "error", reason: "Schedule A/B individual without a name", raw: row };
    const [fullName, firstName, lastName] = parsed;
    return this.person(row, {
      companySourceKey: `crd:${filing.crd}`,
      companyName: filing.firmName,
      fullName,
      firstName,
      lastName,
      title: cell(row, "Title or Status") || null,
      originRef: `${basename(this.path)}!${member}#FilingID=${filingId}`,
      asOf: filing.submitted,
    });
  }

  private contactPerson(
    row: RawRow,
    filings: Map<string, Filing>,
    member: string,
    name: string,
    title: string,
    isCompliance: boolean,
  ): PersonItem {
    const filingId = cell(row, "FilingID");
    const filing = resolveFiling(filings, filingId);
    if (typeof filing === "string") return { kind: "error", reason: filing, raw: row };
    const parsed = parseDirectName(name);
    if (parsed === null)
      return { kind: "error", reason: "contact row without a parseable name", raw: row };
    const [fullName, firstName, lastName] = parsed;
    return this.person(row, {
      companySourceKey: `crd:${filing.crd}`,
      companyName: filing.firmName,
      fullName,
      firstName,
      lastName,
      title,
      isCompliance,
      originRef: `${basename(this.path)}!${member}#FilingID=${filingId}`,
      asOf: filing.submitted,
    });
  }

  /** Validation failures travel as PersonRowError values, never exceptions. */
  private person(
    row: RawRow,
    fields: Omit<Parameters<typeof personRow>[0], "origin" | "raw">,
  ): PersonItem {
    try {
      return personRow({ ...fields, origin: "registry", raw: row });
    } catch (err) {
      if (err instanceof PersonRowInvalid) return { kind: "error", reason: err.message, raw: row };
      throw err;
    }
  }
}

/** "07/15/2026 03:21:09 PM" -> "2026-07-15"; anything else is null. */
function submittedOn(row: RawRow): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) /.exec(cell(row, "DateSubmitted"));
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/** The filing's firm, or the reason there is none. */
function resolveFiling(filings: Map<string, Filing>, filingId: string): Filing | string {
  if (!filingId) return "row without a FilingID";
  const entry = filings.get(filingId);
  if (entry === undefined) return `FilingID ${filingId} not present in ${BASE_MEMBER}*`;
  if (!entry.crd) return `FilingID ${filingId} has no CRD (1E1) in the base file`;
  return entry;
}
