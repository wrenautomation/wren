/**
 * Writes a hiring check: the finding and its source (upserts, so re-checking
 * is safe), then where the check stands, pointing at the finding it stands on.
 * A check that finds no openings points at nothing, so an old hiring finding
 * stops counting without being deleted. A capped or unresolved check learned
 * nothing (a timeout is not "stopped hiring"), so it keeps pointing where the
 * last real check did.
 */
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { keepFinding, pgSafe } from "../findings.js";
import { companyChecks, companyEventChecks } from "../schema.js";
import { type EventsResult, eventFinding } from "./events.js";
import type { HiringResult } from "./hiring.js";

export async function recordCompanyCheck(
  db: Queryable,
  companyId: number,
  r: HiringResult,
  runId: string | null = null,
): Promise<void> {
  const findingId = r.finding ? await keepFinding(db, r.finding) : null;
  const state = { state: r.state, findingId, tried: pgSafe(r.tried), retryAt: r.retryAt, runId };
  await db
    .insert(companyChecks)
    .values({ companyId, ...state })
    .onConflictDoUpdate({
      target: companyChecks.companyId,
      set: {
        ...state,
        findingId:
          r.state === "capped" || (r.state === "unresolved" && !findingId)
            ? sql`${companyChecks.findingId}`
            : findingId,
        checkedAt: sql`now()`,
      },
    });
}

/** Writes a news search: each event as a `news` finding, then where the search stands. */
export async function recordCompanyEvents(
  db: Queryable,
  companyId: number,
  r: EventsResult,
  runId: string | null = null,
): Promise<void> {
  for (const e of r.events) await keepFinding(db, eventFinding(companyId, e));
  const state = {
    state: r.state,
    events: r.events.length,
    tried: pgSafe(r.tried),
    retryAt: r.retryAt,
    runId,
  };
  await db
    .insert(companyEventChecks)
    .values({ companyId, ...state })
    .onConflictDoUpdate({
      target: companyEventChecks.companyId,
      set: { ...state, checkedAt: sql`now()` },
    });
}
