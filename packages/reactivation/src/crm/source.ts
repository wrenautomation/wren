/**
 * A CRM export as a PersonSource. Each row becomes a person (origin `crm`) at a
 * company, plus a CrmRecord: the CRM's own facts (owner, last contact, the email
 * as the CRM holds it) that the importer hangs on `crm_contacts`.
 *
 * The company is found, in order, by the website's domain, the email's domain
 * when it is a work address, a domain another row gave the same company name, and
 * last by the name alone (`crm-co:<slug>`). A row with none is an import error.
 *
 * People carry no source key: the same person twice in the export is one person
 * (company + name) with two crm_contacts rows, so the health report sees the
 * duplicate and nothing downstream emails them twice.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  decodeCsvBytes,
  emailDomain,
  emailSyntaxError,
  extractDomain,
  isFreemail,
  isPlatformDomain,
  normalizeEmail,
  type PersonItem,
  PersonRowInvalid,
  type PersonSource,
  parseCsvRecords,
  parseDirectName,
  parseName,
  personRow,
  personRowError,
  type RawRow,
  rowsFromRecords,
  smartCase,
} from "@wren/core";
import { type DayOrder, dayOrder, parseCrmDate } from "./dates.js";
import {
  CRM_DATE_FIELDS,
  type CrmField,
  type CrmFormat,
  type HeaderMap,
  mapHeaders,
} from "./formats.js";

/** What the CRM knows beyond the person: stored whole on crm_contacts. */
export interface CrmRecord {
  crmKey: string;
  email: string | null;
  phone: string | null;
  owner: string | null;
  status: string | null;
  lastContactedOn: string | null;
  lastPlacementOn: string | null;
  addedOn: string | null;
}

const text = (v: unknown): string | null => {
  const t = v == null ? "" : String(v).trim();
  return t || null;
};

/**
 * Words (any script) joined by dashes, fit to a 64-char key after its prefix. A
 * longer name keeps its start and a hash of the whole, so two long names that
 * share a start stay two companies.
 */
export function companySlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if ([...slug].length <= 57) return slug;
  const hash = createHash("sha256").update(slug).digest("hex").slice(0, 16);
  return `${[...slug].slice(0, 40).join("").replace(/-+$/, "")}-${hash}`;
}

/**
 * Every address in a cell, in order: "a@x.com; b@y.com", "Jane Doe <jane@acme.com>",
 * a trailing dot or comma dropped.
 */
export function emailsIn(cell: string | null): string[] {
  if (!cell) return [];
  const found = cell.match(/[^\s<>;,"'()[\]]+@[^\s<>;,"'()[\]]+/g) ?? [];
  return found.map((e) => normalizeEmail(e.replace(/^mailto:/i, "").replace(/[.]+$/, "")));
}

/**
 * The first address in a cell: the one the CRM holds as the contact's own. A cell
 * with no address in it keeps its first word, so the health report counts it as
 * bad syntax rather than missing.
 */
export function firstEmail(cell: string | null): string | null {
  const first = emailsIn(cell)[0] ?? cell?.split(/[\s;,]+/).find(Boolean);
  return first ? normalizeEmail(first) : null;
}

/** A domain that names a business: syntactically sound, not a mail host, not a platform. */
function workDomain(email: string | null): string | null {
  if (!email || emailSyntaxError(email)) return null;
  const d = emailDomain(email);
  return isFreemail(d) || isPlatformDomain(d) ? null : d;
}

/** The first work domain among a cell's addresses: "jane@gmail.com; jane@acme.com" is acme.com. */
const cellWorkDomain = (cell: string | null): string | null =>
  emailsIn(cell)
    .map(workDomain)
    .find((d) => d !== null) ?? null;

function siteDomain(website: string | null): string | null {
  const d = website ? extractDomain(website) : null;
  return d && !isPlatformDomain(d) ? d : null;
}

export class CrmCsvSource implements PersonSource {
  readonly sourceType: string;
  readonly sourceRef: string;
  readonly contentHash: string;
  readonly headers: HeaderMap;
  private readonly raws: RawRow[];
  private readonly order: DayOrder;
  /** Company slug -> a domain some row gave it, so a freemail row still finds its firm. */
  private readonly domainsByName = new Map<string, string>();
  private readonly records: (CrmRecord | null)[] = [];

  constructor(
    readonly format: CrmFormat,
    readonly path: string,
    bytes: Uint8Array = readFileSync(path),
  ) {
    this.sourceType = format.name;
    this.sourceRef = path;
    this.contentHash = createHash("sha256").update(bytes).digest("hex");
    const records = parseCsvRecords(decodeCsvBytes(bytes, path).text);
    this.headers = mapHeaders(format, records[0] ?? []);
    this.raws = [...rowsFromRecords(records)];
    // One locale per export: a single day-first date anywhere settles every date column.
    this.order = dayOrder(CRM_DATE_FIELDS.flatMap((f) => this.raws.map((r) => this.cell(r, f))));
    for (const r of this.raws) {
      const name = this.cell(r, "company");
      const domain = siteDomain(this.cell(r, "website")) ?? cellWorkDomain(this.cell(r, "email"));
      if (name && domain && !this.domainsByName.has(companySlug(name)))
        this.domainsByName.set(companySlug(name), domain);
    }
  }

  get rowCount(): number {
    return this.raws.length;
  }

  /** The CRM facts for a landed row (1-based, as the importer counts). */
  record(rowNumber: number): CrmRecord | null {
    return this.records[rowNumber - 1] ?? null;
  }

  private cell(row: RawRow, field: CrmField): string | null {
    const header = this.headers[field];
    return header === undefined ? null : text(row[header]);
  }

  *rows(): Generator<PersonItem> {
    this.records.length = 0;
    const seen = new Map<string, number>();
    for (const raw of this.raws) {
      const item = this.person(raw);
      this.records.push(item.kind === "person" ? this.crmRecord(raw, seen) : null);
      yield item;
    }
  }

  private person(raw: RawRow): PersonItem {
    const first = this.cell(raw, "firstName");
    const last = this.cell(raw, "lastName");
    const full = this.cell(raw, "fullName");
    const joined = [first, last].filter(Boolean).join(" ");
    const parsed = full ? parseName(full) : joined ? parseDirectName(joined) : null;
    if (!parsed) return personRowError("no name", raw);
    const [fullName, parsedFirst, parsedLast] = parsed;

    const companyName = this.cell(raw, "company");
    const slug = companyName ? companySlug(companyName) : "";
    const companyDomain =
      siteDomain(this.cell(raw, "website")) ??
      cellWorkDomain(this.cell(raw, "email")) ??
      (slug ? (this.domainsByName.get(slug) ?? null) : null);
    const companySourceKey = !companyDomain && slug ? `crm-co:${slug}` : null;
    if (!companyDomain && !companySourceKey)
      return personRowError("no company: needs a website, a work email or a company name", raw);

    const contacted = parseCrmDate(this.cell(raw, "lastContacted"), this.order);
    const created = parseCrmDate(this.cell(raw, "created"), this.order);
    try {
      return personRow({
        fullName,
        firstName: first ? smartCase(first) : parsedFirst,
        lastName: last ? smartCase(last) : parsedLast,
        title: this.cell(raw, "title"),
        companyName,
        companyDomain,
        companySourceKey,
        linkedinUrl: this.cell(raw, "linkedin"),
        origin: "crm",
        originRef: `${this.format.name}:${this.sourceRef}`,
        asOf: contacted ?? created,
        raw,
      });
    } catch (e) {
      if (e instanceof PersonRowInvalid) return personRowError(e.message, raw);
      throw e;
    }
  }

  private crmRecord(raw: RawRow, seen: Map<string, number>): CrmRecord {
    const id = this.cell(raw, "id");
    const email = firstEmail(this.cell(raw, "email"));
    let crmKey: string;
    if (id && id.length <= 128) crmKey = id;
    else {
      // No id: who the row is (address, else name and company), not the whole row,
      // so an edited re-export updates its rows. Numbered so two such rows stay two.
      const who =
        email ??
        [this.cell(raw, "fullName"), this.cell(raw, "firstName"), this.cell(raw, "lastName")]
          .concat(this.cell(raw, "company"), this.cell(raw, "website"))
          .map((v) => v?.toLowerCase() ?? "")
          .join("|");
      const hash = createHash("sha256").update(who).digest("hex").slice(0, 40);
      const n = (seen.get(hash) ?? 0) + 1;
      seen.set(hash, n);
      crmKey = `h:${hash}#${n}`;
    }
    return {
      crmKey,
      email: email?.slice(0, 320) ?? null,
      phone: this.cell(raw, "phone")?.slice(0, 64) ?? null,
      owner: this.cell(raw, "owner"),
      status: this.cell(raw, "status"),
      lastContactedOn: parseCrmDate(this.cell(raw, "lastContacted"), this.order),
      lastPlacementOn: parseCrmDate(this.cell(raw, "lastPlacement"), this.order),
      addedOn: parseCrmDate(this.cell(raw, "created"), this.order),
    };
  }
}
