/**
 * The Import head's plain parts: the file as base64, the lines under a preview and under a
 * result. No React, so a test reads them.
 */
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "@wren/reactivation/portal-routes";
import type { ImportPreview, ImportResult } from "../../api.js";

/** The columns shown up front; the rest sit under "More columns". */
export const MAIN_FIELDS: readonly string[] = [
  "fullName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "title",
  "company",
  "website",
];

export const LIMITS = { bytes: IMPORT_MAX_BYTES, rows: IMPORT_MAX_ROWS };

const n = (x: number) => x.toLocaleString("en-US");
export const plural = (x: number, one: string, many = `${one}s`) =>
  `${n(x)} ${x === 1 ? one : many}`;

/** A file's bytes as base64, in slices so a big file doesn't overflow the call's arguments. */
export function base64Of(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** What stops a file before it goes up, or null. */
export function tooBig(size: number): string | null {
  return size > LIMITS.bytes
    ? `That file is over ${Math.floor(LIMITS.bytes / 1_000_000)} MB. Split it and load each part.`
    : null;
}

/** People the file will add or update: its rows less those left out. */
export const willLoad = (p: Pick<ImportPreview, "rows" | "skipped">) => p.rows - p.skipped;

/** The counts under a preview, one short line each. */
export function previewLines(p: ImportPreview): string[] {
  const lines = [
    `${plural(p.rows, "row")} in the file. ${n(willLoad(p))} will load${
      p.skipped ? ` and ${n(p.skipped)} will be left out` : ""
    }.`,
  ];
  if (p.noEmail) lines.push(`${plural(p.noEmail, "person", "people")} with no email.`);
  if (p.badEmail)
    lines.push(
      `${plural(p.badEmail, "person", "people")} with an email that looks wrong. They still load.`,
    );
  if (p.seen !== null)
    lines.push(`You loaded this file before (import ${p.seen}). Loading it again merges.`);
  return lines;
}

/** The counts after a load. */
export function resultLine(r: ImportResult): string {
  return `${n(r.created)} new, ${n(r.merged)} merged, ${n(r.skipped)} skipped.`;
}

/** A `why` entry as one phrase: "no name (2)". */
export const whyLine = (w: { reason: string; n: number }) => `${w.reason} (${n(w.n)})`;
