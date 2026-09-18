/**
 * Suppression: the one writer of `suppressions` and `suppression_events`.
 *
 * Every write here is a promise: an address or a whole domain that must never
 * receive another send. `activeSuppression` (guards.ts) is the read side compose
 * and send gate on; this module is the only place a row in either table gets
 * created, re-asserted, or lifted, so the compliance history in
 * `suppression_events` is complete no matter which caller did the writing.
 */
import {
  type Suppression,
  type SuppressionKind,
  type SuppressionReason,
  suppressionEvents,
  suppressions,
} from "@wren/core";
import type { Queryable } from "@wren/db";
import { and, eq, isNull } from "drizzle-orm";
import { pyReprStr as pyRepr } from "../outreach/pyrepr.js";
import type { StopReason } from "../schema.js";

// A stop is a do-not-contact PROMISE only for these three reasons — reply and
// manual stops are not, by themselves, evidence the address should never be
// mailed again. Compose and send both gate on the suppressions table, never on
// enrollments.stop_reason, so only these three actually get a row.
export const STOP_TO_SUPPRESSION_REASON: Readonly<Partial<Record<StopReason, SuppressionReason>>> =
  Object.freeze({ opt_out: "opt_out", complaint: "complaint", bounce: "bounce" });

// A domain value is judged by its character set alone plus "at least one dot":
// the bar is "not obviously junk", not "resolvable".
const HOSTNAME = /^[a-z0-9.-]+$/;
const CHECKPOINT_EVERY = 200;
const HEADER_ALIASES: ReadonlySet<string> = new Set([
  "email",
  "address",
  "domain",
  "value",
  "e-mail",
]);

export type Evidence = Record<string, unknown> | null;

function looksLikeHostname(text: string): boolean {
  return (
    text.length > 0 &&
    text.includes(".") &&
    !text.startsWith(".") &&
    !text.endsWith(".") &&
    HOSTNAME.test(text)
  );
}

/** strip+lowercase, then check the value's shape matches its claimed kind. */
export function normalizeValue(kind: SuppressionKind, value: string): string {
  const text = value.trim().toLowerCase();
  if (!text || /\s/.test(text)) {
    throw new Error(`empty or blank suppression value: ${pyRepr(value)}`);
  }
  if (kind === "email") {
    if (!text.includes("@") || text.startsWith("@") || text.endsWith("@")) {
      throw new Error(`not a valid email address: ${pyRepr(value)}`);
    }
  } else {
    if (text.includes("@")) throw new Error(`not a domain (contains '@'): ${pyRepr(value)}`);
    if (!looksLikeHostname(text)) {
      throw new Error(`not a domain (needs a dot; letters/digits/hyphens only): ${pyRepr(value)}`);
    }
  }
  return text;
}

/** EMAIL vs DOMAIN from the value's own shape: "@" means email, everything else a domain. */
export function classifyValue(value: string): [SuppressionKind, string] {
  const text = value.trim();
  const kind: SuppressionKind = text.includes("@") ? "email" : "domain";
  return [kind, normalizeValue(kind, text)];
}

export interface AddSuppressionInput {
  kind: SuppressionKind;
  value: string;
  reason: SuppressionReason;
  evidence?: Evidence;
}

/**
 * Get-or-create a suppression and ALWAYS append the event that (re)asserts it.
 * A revoked row is reactivated: whatever just happened is fresh evidence the
 * promise should hold again. LIFTED is only ever written by `liftSuppression`.
 */
export async function addSuppression(
  db: Queryable,
  input: AddSuppressionInput,
): Promise<{ row: Suppression; created: boolean }> {
  if (input.reason === "lifted") {
    throw new Error("LIFTED is only ever written by lift_suppression, not add_suppression");
  }
  const normalized = normalizeValue(input.kind, input.value);
  const evidence = input.evidence ?? null;
  const [existing] = await db
    .select()
    .from(suppressions)
    .where(and(eq(suppressions.kind, input.kind), eq(suppressions.value, normalized)))
    .limit(1);
  if (existing === undefined) {
    const [inserted] = await db
      .insert(suppressions)
      .values({ kind: input.kind, value: normalized, reason: input.reason })
      .onConflictDoNothing()
      .returning();
    if (inserted !== undefined) {
      await db
        .insert(suppressionEvents)
        .values({ suppressionId: inserted.id, reason: input.reason, evidence });
      return { row: inserted, created: true };
    }
    // Lost a race to another writer: fall through and re-assert its row.
    return addSuppression(db, input);
  }
  const [row] = await db
    .update(suppressions)
    .set({ revokedAt: null })
    .where(eq(suppressions.id, existing.id))
    .returning();
  await db
    .insert(suppressionEvents)
    .values({ suppressionId: existing.id, reason: input.reason, evidence });
  return { row: row ?? { ...existing, revokedAt: null }, created: false };
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

/** Revoke an active suppression; null when none is active (a question, not an error). */
export async function liftSuppression(
  db: Queryable,
  input: { kind: SuppressionKind; value: string; evidence?: Evidence; now?: Date },
): Promise<Suppression | null> {
  const normalized = normalizeValue(input.kind, input.value);
  const [existing] = await db
    .select()
    .from(suppressions)
    .where(
      and(
        eq(suppressions.kind, input.kind),
        eq(suppressions.value, normalized),
        isNull(suppressions.revokedAt),
      ),
    )
    .limit(1);
  if (existing === undefined) return null;
  const [row] = await db
    .update(suppressions)
    .set({ revokedAt: input.now ?? new Date() })
    .where(eq(suppressions.id, existing.id))
    .returning();
  await db
    .insert(suppressionEvents)
    .values({ suppressionId: existing.id, reason: "lifted", evidence: input.evidence ?? null });
  return row ?? existing;
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
