/**
 * Suppression: the one writer of `suppressions` and `suppression_events`.
 *
 * Every write here is a promise: an address, a domain or a phone number that
 * must never be contacted again. Every channel reads the same table, so a
 * promise made on one channel holds on all of them. This module is the only
 * place a row gets created, re-asserted, or lifted, so the compliance history in
 * `suppression_events` is complete no matter which channel did the writing.
 */
import type { Queryable } from "@wren/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  type Suppression,
  type SuppressionKind,
  type SuppressionReason,
  suppressionEvents,
  suppressions,
} from "./schema.js";

// A domain value is judged by its character set alone plus "at least one dot":
// the bar is "not obviously junk", not "resolvable".
const HOSTNAME = /^[a-z0-9.-]+$/;
const E164 = /^\+[1-9][0-9]{7,14}$/;

export type Evidence = Record<string, unknown> | null;

const quote = (value: string) => JSON.stringify(value);

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
    throw new Error(`empty or blank suppression value: ${quote(value)}`);
  }
  if (kind === "email") {
    if (!text.includes("@") || text.startsWith("@") || text.endsWith("@")) {
      throw new Error(`not a valid email address: ${quote(value)}`);
    }
  } else if (kind === "phone") {
    if (!E164.test(text)) throw new Error(`not an E.164 phone number: ${quote(value)}`);
  } else {
    if (text.includes("@")) throw new Error(`not a domain (contains '@'): ${quote(value)}`);
    if (!looksLikeHostname(text)) {
      throw new Error(`not a domain (needs a dot; letters/digits/hyphens only): ${quote(value)}`);
    }
  }
  return text;
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
    throw new Error("LIFTED is only ever written by liftSuppression, not addSuppression");
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

/** The active suppression on exactly this value, or null. */
export async function activeSuppressionOf(
  db: Queryable,
  kind: SuppressionKind,
  value: string,
): Promise<Suppression | null> {
  const [row] = await db
    .select()
    .from(suppressions)
    .where(
      and(
        eq(suppressions.kind, kind),
        eq(suppressions.value, normalizeValue(kind, value)),
        isNull(suppressions.revokedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}
