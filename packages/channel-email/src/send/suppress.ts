/**
 * Email's side of suppression: which stops become promises, bulk import, CSV.
 *
 * The writers themselves (`addSuppression`, `liftSuppression`) live in core so
 * every channel writes one table through one path; `activeSuppression`
 * (guards.ts) is the read side compose and send gate on.
 */
import {
  type AddSuppressionInput,
  addSuppression,
  type Evidence,
  liftSuppression,
  normalizeValue,
  type Suppression,
  type SuppressionKind,
  type SuppressionReason,
  suppressions,
} from "@wren/core";
import type { Queryable } from "@wren/db";
import { and, eq } from "drizzle-orm";
import { pyReprStr as pyRepr } from "../outreach/pyrepr.js";
import type { StopReason } from "../schema.js";

// A stop is a do-not-contact PROMISE only for these three reasons — reply and
// manual stops are not, by themselves, evidence the address should never be
// mailed again. Compose and send both gate on the suppressions table, never on
// enrollments.stop_reason, so only these three actually get a row.
export const STOP_TO_SUPPRESSION_REASON: Readonly<Partial<Record<StopReason, SuppressionReason>>> =
  Object.freeze({ opt_out: "opt_out", complaint: "complaint", bounce: "bounce" });

const CHECKPOINT_EVERY = 200;
const HEADER_ALIASES: ReadonlySet<string> = new Set([
  "email",
  "address",
  "domain",
  "value",
  "e-mail",
]);

// The writers live in core (every channel suppresses into one table); email
// keeps its stop mapping, bulk import and CSV reading here.
export { type AddSuppressionInput, addSuppression, type Evidence, liftSuppression, normalizeValue };

/** EMAIL vs DOMAIN from the value's own shape: "@" means email, everything else a domain. */
export function classifyValue(value: string): [SuppressionKind, string] {
  const text = value.trim();
  const kind: SuppressionKind = text.includes("@") ? "email" : "domain";
  return [kind, normalizeValue(kind, text)];
}

/**
 * The Suppression a do-not-contact stop promises, for opt_out/complaint/bounce
 * only — reply/manual return null and write nothing. Every call appends an
 * event: a second bounce on an already-suppressed address is fresh evidence.
 */
export async function ensureSuppression(
  db: Queryable,
  email: string,
  reason: StopReason,
  evidence?: Evidence,
): Promise<Suppression | null> {
  const suppressionReason = STOP_TO_SUPPRESSION_REASON[reason];
  if (suppressionReason === undefined) return null;
  const { row } = await addSuppression(db, {
    kind: "email",
    value: email.trim().toLowerCase(),
    reason: suppressionReason,
    evidence: evidence ?? null,
  });
  return row;
}

export interface ImportStats {
  read: number;
  added: number;
  reasserted: number;
  invalid: number;
  emails: number;
  domains: number;
  invalid_values: string[];
}

/**
 * Bulk-add do-not-contact values: each classified by `classifyValue` and
 * get-or-created via `addSuppression`, sharing one evidence payload.
 * `dryRun` classifies and counts but writes nothing.
 */
export async function importValues(
  db: Queryable,
  values: Iterable<string>,
  opts: {
    reason: SuppressionReason;
    evidence?: Evidence;
    dryRun?: boolean;
    checkpoint?: () => Promise<void> | void;
  },
): Promise<ImportStats> {
  if (opts.reason === "lifted") {
    throw new Error("LIFTED is only ever written by lift_suppression, not import_values");
  }
  const stats: ImportStats = {
    read: 0,
    added: 0,
    reasserted: 0,
    invalid: 0,
    emails: 0,
    domains: 0,
    invalid_values: [],
  };
  let writes = 0;
  for (const raw of values) {
    stats.read += 1;
    let kind: SuppressionKind;
    let value: string;
    try {
      [kind, value] = classifyValue(raw);
    } catch {
      stats.invalid += 1;
      stats.invalid_values.push(raw);
      continue;
    }
    stats[kind === "email" ? "emails" : "domains"] += 1;
    if (opts.dryRun) {
      const [exists] = await db
        .select({ id: suppressions.id })
        .from(suppressions)
        .where(and(eq(suppressions.kind, kind), eq(suppressions.value, value)))
        .limit(1);
      stats[exists === undefined ? "added" : "reasserted"] += 1;
      continue;
    }
    const { created } = await addSuppression(db, {
      kind,
      value,
      reason: opts.reason,
      evidence: opts.evidence ?? null,
    });
    stats[created ? "added" : "reasserted"] += 1;
    writes += 1;
    if (opts.checkpoint && writes % CHECKPOINT_EVERY === 0) await opts.checkpoint();
  }
  return stats;
}

function looksLikeValue(cell: string): boolean {
  try {
    classifyValue(cell);
    return true;
  } catch {
    return false;
  }
}

/**
 * One column of do-not-contact values from parsed CSV rows. With a header row:
 * `column` (case-insensitive) picks it; else the first header naming
 * email/address/domain/value/"e-mail"; else the first column. A file whose
 * first cell already looks like a value is read as one bare value per row.
 */
export function csvValues(
  rows: readonly (readonly string[])[],
  opts: { column?: string | null; where?: string } = {},
): string[] {
  const kept = rows.filter((row) => row.length > 0);
  const first = kept[0];
  if (first === undefined) return [];
  const firstCell = (first[0] ?? "").trim();
  if (looksLikeValue(firstCell)) {
    return kept.map((row) => (row[0] ?? "").trim()).filter((v) => v.length > 0);
  }
  const header = first.map((cell) => cell.trim().toLowerCase());
  let index: number;
  if (opts.column != null) {
    index = header.indexOf(opts.column.trim().toLowerCase());
    if (index < 0) {
      throw new Error(
        `no column ${pyRepr(opts.column)} in ${opts.where ?? "csv"} — header is [${first.map(pyRepr).join(", ")}]`,
      );
    }
  } else {
    const found = header.findIndex((name) => HEADER_ALIASES.has(name));
    index = found < 0 ? 0 : found;
  }
  const values: string[] = [];
  for (const row of kept.slice(1)) {
    const cell = row[index];
    if (cell?.trim()) values.push(cell.trim());
  }
  return values;
}
