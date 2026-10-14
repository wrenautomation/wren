/**
 * The Import page: a client loads a CSV of its own contacts. The browser sends the file as
 * base64; this reads it with the same code as `wren crm import` (`CrmCsvSource`, then
 * `runCrmImport`), so a row is checked, merged and skipped the same way in both. A preview reads
 * the file and writes nothing. The import runs in one transaction, all or nothing, so its size is
 * capped: each person takes a few locks that last until it ends, and the transaction is held open
 * for the time it takes (about 15 ms a row on a local database).
 */
import { createHash } from "node:crypto";
import { emailSyntaxError } from "@wren/core";
import type { Client } from "@wren/core/clients";
import {
  PortalRefusal,
  type PortalRequest,
  pickForWrite,
  type SignedViewer,
} from "@wren/core/portal";
import { atomic, type Db, type Queryable, setAuditActor, snapshot } from "@wren/db";
import { sql } from "drizzle-orm";
import {
  CRM_FIELDS,
  CRM_FORMATS,
  type CrmField,
  type CrmFormat,
  guessHeaders,
  type HeaderMap,
  missingFields,
} from "../crm/formats.js";
import { runCrmImport } from "../crm/import.js";
import { CrmCsvSource, fileHeadersOf } from "../crm/source.js";
import { SOURCE_LABELS } from "./import-log.js";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "./routes.js";

/** What a column is called on screen. */
export const IMPORT_FIELDS: readonly { id: CrmField; label: string }[] = [
  { id: "fullName", label: "Full name" },
  { id: "firstName", label: "First name" },
  { id: "lastName", label: "Last name" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "title", label: "Job title" },
  { id: "company", label: "Company" },
  { id: "website", label: "Website" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "owner", label: "Owner" },
  { id: "status", label: "Status" },
  { id: "lastContacted", label: "Last contacted" },
  { id: "lastPlacement", label: "Last placement" },
  { id: "created", label: "Date added" },
  { id: "id", label: "ID in your system" },
];

/** The first rows a preview shows. */
const SAMPLE = 10;
/** The reasons a result lists, most common first. */
const REASONS = 6;

export interface ImportAsk {
  /** The file's bytes, base64. */
  file: string;
  /** Its name, as the person's computer calls it. */
  name: string;
  /** Where it came from: a CRM's name, or any contact export. */
  format?: string;
  /** Which of the file's columns serves each field; absent, the guess. A field left out is unused. */
  columns?: Record<string, string>;
}

export interface ImportSampleRow {
  /** Its row in the file, from 1. */
  row: number;
  name: string | null;
  company: string | null;
  email: string | null;
  title: string | null;
  /** Why this row will be left out. */
  skip: string | null;
  /** A thing to know about a row that goes in: no email, an email that looks wrong. */
  note: string | null;
}

export interface ImportPreview {
  format: string;
  formats: { id: string; label: string }[];
  /** The file's columns, as the map names them. */
  headers: string[];
  /** Which column serves each field. */
  columns: Partial<Record<CrmField, string>>;
  fields: { id: CrmField; label: string }[];
  rows: number;
  /** What the columns still lack, in words; nothing imports until it is empty. */
  missing: string[];
  /** Rows that will be left out, and why. */
  skipped: number;
  why: { reason: string; n: number }[];
  noEmail: number;
  badEmail: number;
  /** The first rows, as the import will read them. */
  sample: ImportSampleRow[];
  /** An earlier import of this very file: its number. */
  seen: number | null;
}

export interface ImportResult {
  /** Its number in the list. */
  id: number;
  rows: number;
  created: number;
  merged: number;
  skipped: number;
  why: { reason: string; n: number }[];
  noEmail: number;
  badEmail: number;
  seen: number | null;
}

export interface ImportDeps {
  main: Db;
  open(client: Client): Db;
}

const fail = (message: string, status: 400 | 422 = 400): never => {
  throw new PortalRefusal(message, status);
};

/** A file name without its folder, its colons or anything unprintable: the label it lists under. */
const labelOf = (name: unknown): string => {
  const base = [
    ...(String(name ?? "")
      .split(/[\\/]/)
      .pop() ?? ""),
  ]
    .map((c) => (c === ":" || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c))
    .join("")
    .trim()
    .slice(0, 120);
  return base || "contacts.csv";
};

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** What a browser sent, checked, and the file read: nothing is written. */
function read(req: PortalRequest & ImportAsk) {
  if (typeof req.file !== "string" || !req.file) return fail("Choose a file first.");
  if (req.file.length > Math.ceil((IMPORT_MAX_BYTES * 4) / 3) + 8 || !BASE64.test(req.file))
    return fail(
      `That file is over ${Math.floor(IMPORT_MAX_BYTES / 1_000_000)} MB, or didn't come through whole. Split it and load each part.`,
      422,
    );
  const bytes = new Uint8Array(Buffer.from(req.file, "base64"));
  if (bytes.length > IMPORT_MAX_BYTES)
    return fail(
      `That file is over ${Math.floor(IMPORT_MAX_BYTES / 1_000_000)} MB. Split it and load each part.`,
      422,
    );
  const name = labelOf(req.name);

  const formatName = typeof req.format === "string" && req.format ? req.format : "crm-generic";
  const format: CrmFormat | undefined = CRM_FORMATS.get(formatName);
  if (!format) return fail("Pick where this file came from.");

  let headers: string[];
  try {
    headers = fileHeadersOf(bytes, name);
  } catch (err) {
    return fail(`That doesn't read as a CSV: ${(err as Error).message}`, 422);
  }
  if (headers.length === 0 || headers.every((h) => !h.trim()))
    return fail("The file has no header row. The first line should name each column.", 422);

  let columns: HeaderMap;
  if (req.columns == null) columns = guessHeaders(format, headers);
  else {
    if (typeof req.columns !== "object" || Array.isArray(req.columns))
      return fail("Pick a column for each field.");
    columns = {};
    for (const [field, header] of Object.entries(req.columns)) {
      if (!(CRM_FIELDS as readonly string[]).includes(field))
        return fail(`No field called ${field}.`);
      if (header === "" || header == null) continue;
      if (typeof header !== "string" || !headers.includes(header))
        return fail(`The file has no column called ${String(header).slice(0, 80)}.`);
      columns[field as CrmField] = header;
    }
  }
  const missing = missingFields(columns);
  return { bytes, name, format, headers, columns, missing };
}

/** The source over a file whose columns are enough, refused when it holds too many rows. */
function sourceOf(r: ReturnType<typeof read>): CrmCsvSource {
  let source: CrmCsvSource;
  try {
    source = new CrmCsvSource(r.format, r.name, r.bytes, r.columns);
  } catch (err) {
    return fail((err as Error).message, 422);
  }
  if (source.rowCount === 0) return fail("The file has a header row but no people in it.", 422);
  if (source.rowCount > IMPORT_MAX_ROWS)
    return fail(
      `That file has ${source.rowCount.toLocaleString("en-US")} rows. Load up to ${IMPORT_MAX_ROWS.toLocaleString("en-US")} at a time.`,
      422,
    );
  return source;
}

const top = (counts: Map<string, number>) =>
  [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, REASONS)
    .map(([reason, n]) => ({ reason, n }));

/** Whether this client has loaded these very bytes before, and as which import. */
async function seenBefore(
  db: Queryable,
  format: string,
  bytes: Uint8Array,
): Promise<number | null> {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const [row] = await db.execute<{ id: number }>(sql`
    select id from imports where source_type = ${format} and content_hash = ${hash}
    order by id limit 1`);
  return row?.id ?? null;
}

/** The handlers as plain functions: `portalApi` carries them, tests call them. */
export function importApi(deps: ImportDeps) {
  return {
    /** Read the file with the guessed or chosen columns and show the first rows; writes nothing. */
    importPreview: async (req: PortalRequest & ImportAsk): Promise<ImportPreview> => {
      const { client } = await pickForWrite(deps.main, req);
      const r = read(req);
      const base = {
        format: r.format.name,
        formats: [...CRM_FORMATS.keys()].map((id) => ({ id, label: SOURCE_LABELS[id] ?? id })),
        headers: r.headers,
        columns: r.columns,
        fields: [...IMPORT_FIELDS],
      };
      if (r.missing.length) {
        return {
          ...base,
          rows: 0,
          missing: r.missing,
          skipped: 0,
          why: [],
          noEmail: 0,
          badEmail: 0,
          sample: [],
          seen: null,
        };
      }
      const source = sourceOf(r);
      const sample: ImportSampleRow[] = [];
      const why = new Map<string, number>();
      let skipped = 0;
      let noEmail = 0;
      let badEmail = 0;
      let row = 0;
      for (const item of source.rows()) {
        row += 1;
        const email = item.kind === "person" ? (source.record(row)?.email ?? null) : null;
        if (item.kind === "error") {
          skipped += 1;
          why.set(item.reason, (why.get(item.reason) ?? 0) + 1);
        } else if (!email) noEmail += 1;
        else if (emailSyntaxError(email)) badEmail += 1;
        if (sample.length < SAMPLE)
          sample.push(
            item.kind === "error"
              ? {
                  row,
                  name: null,
                  company: null,
                  email: null,
                  title: null,
                  skip: item.reason,
                  note: null,
                }
              : {
                  row,
                  name: item.fullName,
                  company: item.companyName ?? item.companyDomain,
                  email,
                  title: item.title,
                  skip: null,
                  note: !email ? "No email" : emailSyntaxError(email) ? "Email looks wrong" : null,
                },
          );
      }
      const seen = await snapshot(deps.open(client), (tx) =>
        seenBefore(tx, r.format.name, r.bytes),
      );
      return {
        ...base,
        rows: row,
        missing: [],
        skipped,
        why: top(why),
        noEmail,
        badEmail,
        sample,
        seen,
      };
    },

    /** Load the file: `runCrmImport`, the CLI's own, in one transaction. Sends nothing. */
    importRun: async (req: PortalRequest & ImportAsk): Promise<ImportResult> => {
      const { client, viewer }: { client: Client; viewer: SignedViewer } = await pickForWrite(
        deps.main,
        req,
      );
      const r = read(req);
      if (r.missing.length) return fail(`The file needs ${r.missing.join(" and ")}.`, 422);
      const source = sourceOf(r);
      return atomic(deps.open(client), async (tx) => {
        await setAuditActor(tx, viewer.email);
        // One load at a time: a second click waits, then finds the first one's people.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('portal-crm-import'))`);
        const { batch, stats } = await runCrmImport(tx, source, {});
        const reasons = await tx.execute<{ reason: string; n: number }>(sql`
          select reason, count(*)::int n from import_errors
          where import_id = ${batch.id} and kind = 'rejected' group by reason`);
        return {
          id: batch.id,
          rows: stats.rows,
          created: stats.people_created,
          merged: stats.people_seen,
          skipped: stats.errors,
          why: top(new Map(reasons.map((x) => [x.reason, x.n]))),
          noEmail: stats.emails_missing,
          badEmail: stats.emails_bad,
          seen: stats.replay_of ?? null,
        };
      });
    },
  };
}
