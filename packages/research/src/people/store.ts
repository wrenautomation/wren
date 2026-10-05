/**
 * Writes a lookup: every page read and each finding's source into `documents`
 * (once per url and text), the finding itself (seen again = `observed_at` moves), the person's
 * trusted profile, and where the lookup stands. Every write is an upsert, so
 * re-running a person is safe.
 */
import { people } from "@wren/core/schema";
import type { Queryable } from "@wren/db";
import { eq, sql } from "drizzle-orm";
import { keepDocument, keepFinding, pgSafe } from "../findings.js";
import { personLookups } from "../schema.js";
import type { LookupResult } from "./lookup.js";

export async function recordLookup(
  db: Queryable,
  personId: number,
  r: LookupResult,
  runId: string | null = null,
): Promise<void> {
  for (const page of r.pages) await keepDocument(db, page);
  for (const f of r.findings) await keepFinding(db, f);
  if (r.profile)
    await db.update(people).set({ linkedinUrl: r.profile.url }).where(eq(people.id, personId));
  const state = { state: r.state, tried: pgSafe(r.tried), retryAt: r.retryAt, runId };
  await db
    .insert(personLookups)
    .values({ personId, ...state })
    .onConflictDoUpdate({
      target: personLookups.personId,
      set: { ...state, lookedUpAt: sql`now()` },
    });
}
