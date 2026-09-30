/**
 * LeadSource: a source only yields raw row objects plus enough identity for the
 * imports table; classification is schema.ts's job, so every source reuses the
 * whole edge unchanged.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { GoogleMapsCsvSource } from "./google-maps.js";
import type { RawRow } from "./schema.js";

export interface LeadSource {
  sourceType: string;
  sourceRef: string;
  /** sha256 of the exact bytes read; ties the batch to content, not a path. Sources without hashing omit it. */
  contentHash?: string;
  rows(): Iterable<RawRow> | AsyncIterable<RawRow>;
  /** Rows the source chose not to yield, by reason; read after `rows()` is spent. */
  declined?(): Record<string, number>;
}

const CP1252_UNDEFINED = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);

/**
 * Whole-file decoding decision, made upfront so a decode error can never hand the
 * importer half the rows twice. utf-8 (BOM stripped) wins if the whole file decodes;
 * cp1252 is the fallback for Windows/Excel exports. UTF-16/32 BOMs and NUL bytes are
 * refused: cp1252 would "decode" them into mojibake instead of failing.
 */
export function decodeCsvBytes(
  data: Uint8Array,
  name = "<bytes>",
): { text: string; encoding: "utf-8" | "cp1252" } {
  const b = (i: number) => data[i];
  if (
    (b(0) === 0xff && b(1) === 0xfe && b(2) === 0 && b(3) === 0) ||
    (b(0) === 0 && b(1) === 0 && b(2) === 0xfe && b(3) === 0xff) ||
    (b(0) === 0xff && b(1) === 0xfe) ||
    (b(0) === 0xfe && b(1) === 0xff)
  ) {
    throw new Error(`${name} looks like UTF-16/32 (BOM detected) — not a supported encoding`);
  }
  if (data.includes(0))
    throw new Error(`${name} contains a NUL byte — not a supported CSV encoding`);
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(data), encoding: "utf-8" };
  } catch {
    // fall through
  }
  for (const byte of data) {
    if (CP1252_UNDEFINED.has(byte)) throw new Error(`${name} decodes as neither utf-8 nor cp1252`);
  }
  return { text: new TextDecoder("windows-1252").decode(data), encoding: "cp1252" };
}

/** Suffix repeated header names instead of last-wins: two "Email" columns must both survive. */
export function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h}__${n}`;
  });
}

const blank = (cells: readonly (string | null)[]) => !cells.some((c) => c && String(c).trim());

/**
 * Records -> row objects without data loss: duplicate headers are suffixed, cells
 * beyond the header land in `_overflow`, short rows fill trailing fields with null.
 * All-blank lines are formatting, not data: skipped without consuming a row number.
 */
export function* rowsFromRecords(records: Iterable<string[]>): Generator<RawRow> {
  const it = records[Symbol.iterator]();
  const first = it.next();
  if (first.done) return;
  const fields = dedupeHeaders(first.value);
  const width = fields.length;
  for (let r = it.next(); !r.done; r = it.next()) {
    const cells = r.value;
    if (blank(cells)) continue;
    const row: RawRow = {};
    fields.forEach((f, i) => {
      row[f] = i < cells.length ? (cells[i] as string) : null;
    });
    if (cells.length > width) row._overflow = cells.slice(width);
    yield row;
  }
}

export function parseCsvRecords(text: string): string[][] {
  return parse(text, {
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: false,
  }) as string[][];
}

export class CsvLeadSource implements LeadSource {
  readonly sourceType = "csv";
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
    yield* rowsFromRecords(parseCsvRecords(text));
  }
}

/** The import-format seam: name -> how to build a LeadSource. Niche packages register their own. */
export interface SourceFormat {
  name: string;
  help: string;
  build: (path: string) => LeadSource;
  /** Stamped onto companies the import creates. null = generic. */
  niche: string | null;
  /** Whether --map applies (adapters own their dialect end to end). */
  columnMapped: boolean;
  /** Whether build() accepts a directory of source files. */
  directory: boolean;
}
export const BUILTIN_FORMATS: Readonly<Record<string, SourceFormat>> = {
  csv: {
    name: "csv",
    help: "generic CSV with header aliases",
    build: (p) => new CsvLeadSource(p),
    niche: null,
    columnMapped: true,
    directory: false,
  },
  "google-maps": {
    name: "google-maps",
    help: "gosom/google-maps-scraper CSV (listings -> companies, general inbox)",
    build: (p) => new GoogleMapsCsvSource(p),
    niche: null,
    columnMapped: false,
    directory: false,
  },
};
