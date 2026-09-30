/**
 * The verification funnel over the DB: stage-1 local checks, then the configured
 * EmailVerifier, writing verifications and advancing lead status.
 *
 * Selection: leads with status=imported and (unless reverify) no verification rows
 * yet. With recheckOlderThan set, verified leads whose newest verification (ANY
 * result: spend control, not a freshness verdict) is older than that are selected too.
 * With retryRiskyOlderThan set, imported leads whose newest verdict is `risky` and
 * older than that are tried again (a greylist or an unreachable prober is not a
 * verdict on the address). With recheckReturning set, the proven addresses (verified,
 * or a newest valid/catch_all verdict) of companies that may come back for another
 * sequence (src/recontact.ts) are re-checked once their newest check is older than
 * that: a lead that rested 90 days is past the send horizon. `niche` narrows to leads
 * of that niche's companies.
 *
 * Status moves with the verdict: an authoritative VALID -> verified, a definitive
 * failure (local checks, or an authoritative INVALID) -> undeliverable. A
 * non-authoritative verdict still gets its row but never moves status. risky /
 * catch_all leave status untouched.
 *
 * A provider error aborts the remaining run but keeps everything already verified.
 * A failure in the LOCAL stage costs that one lead (local_errors) and the run continues.
 */
import { companies, type Lead, type LeadStatus, leads, transitionLead } from "@wren/core";
import type { Queryable } from "@wren/db";
import { and, asc, eq, lt, notExists, or, sql } from "drizzle-orm";
import { eachConcurrently } from "../concurrent.js";
import { audienceGate, type RecontactPolicy } from "../recontact.js";
import { type VerificationResult, verifications } from "../schema.js";
import type { LocalCheckerLike } from "./local.js";
import { defaultLocalChecker } from "./mailifier.js";
import type { EmailVerifier } from "./verifier.js";

/**
 * Correlated subquery: a lead's newest checked_at among result=VALID rows, or NULL.
 * The campaign-gate predicate: pair with status=verified and a horizon comparison.
 * Deliberately distinct from the recheck selection, which maxes over ANY result.
 */
export const latestValidCheckedAt = () =>
  sql<Date | null>`(select max(${verifications.checkedAt}) from ${verifications} where ${verifications.leadId} = ${leads.id} and ${verifications.result} = 'valid')`;

export interface VerificationOptions {
  /** Test seam: a stage-1 checker with a fake resolver. */
  checker?: LocalCheckerLike;
  importId?: number;
  limit?: number;
  reverify?: boolean;
  /** Milliseconds; verified leads whose newest verification is older are re-bought. */
  recheckOlderThanMs?: number;
  /** Milliseconds; imported leads whose newest verdict is `risky` and older are tried again. */
  retryRiskyOlderThanMs?: number;
  /** Proven addresses of companies that may come back, re-checked once older than this. */
  recheckReturning?: { policy: RecontactPolicy; olderThanMs: number };
  /** Only leads held by this niche's companies. */
  niche?: string;
  /** Leads checked at once (default 1). A paid verifier stays at 1. */
  concurrency?: number;
}

export interface VerificationStats {
  selected: number;
  local_invalid: number;
  local_errors: number;
  valid: number;
  invalid: number;
  risky: number;
  catch_all: number;
  flags: Record<string, number>;
  aborted: string | null;
}

export async function runVerification(
  db: Queryable,
  verifier: EmailVerifier,
  opts: VerificationOptions = {},
): Promise<VerificationStats> {
  const checker = opts.checker ?? defaultLocalChecker();
  const unchecked = opts.reverify
    ? eq(leads.status, "imported")
    : and(
        eq(leads.status, "imported"),
        notExists(
          db.select({ one: sql`1` }).from(verifications).where(eq(verifications.leadId, leads.id)),
        ),
      );
  const eligible = [unchecked];
  // Age is measured on the newest verification, on the DB clock.
  const lastChecked = sql`(select max(${verifications.checkedAt}) from ${verifications} where ${verifications.leadId} = ${leads.id})`;
  if (opts.recheckOlderThanMs !== undefined) {
    eligible.push(
      and(
        eq(leads.status, "verified"),
        lt(lastChecked, sql`now() - make_interval(secs => ${opts.recheckOlderThanMs / 1000})`),
      ),
    );
  }
  if (opts.retryRiskyOlderThanMs !== undefined) {
    const newestResult = sql`(select ${verifications.result} from ${verifications} where ${verifications.leadId} = ${leads.id} order by ${verifications.checkedAt} desc, ${verifications.id} desc limit 1)`;
    eligible.push(
      and(
        eq(leads.status, "imported"),
        eq(newestResult, "risky"),
        lt(lastChecked, sql`now() - make_interval(secs => ${opts.retryRiskyOlderThanMs / 1000})`),
      ),
    );
  }
  if (opts.recheckReturning !== undefined) {
    const { policy, olderThanMs } = opts.recheckReturning;
    const newestResult = sql`(select ${verifications.result} from ${verifications} where ${verifications.leadId} = ${leads.id} order by ${verifications.checkedAt} desc, ${verifications.id} desc limit 1)`;
    eligible.push(
      and(
        or(
          eq(leads.status, "verified"),
          and(eq(leads.status, "imported"), sql`${newestResult} in ('valid', 'catch_all')`),
        ),
        lt(lastChecked, sql`now() - make_interval(secs => ${olderThanMs / 1000})`),
        audienceGate(sql`${leads.companyId}`, "returning", policy),
      ),
    );
  }
  const narrowing = [or(...eligible)];
  if (opts.importId !== undefined) narrowing.push(eq(leads.importId, opts.importId));
  if (opts.niche !== undefined) {
    narrowing.push(
      sql`exists (select 1 from ${companies} where ${companies.id} = ${leads.companyId} and ${companies.niche} = ${opts.niche})`,
    );
  }
  const where = and(...narrowing);
  const q = db.select().from(leads).where(where).orderBy(asc(leads.id));
  const selected: Lead[] = opts.limit === undefined ? await q : await q.limit(opts.limit);

  const stats: VerificationStats = {
    selected: selected.length,
    local_invalid: 0,
    local_errors: 0,
    valid: 0,
    invalid: 0,
    risky: 0,
    catch_all: 0,
    flags: {},
    aborted: null,
  };
  const setStatus = async (lead: Lead, next: LeadStatus) => {
    const status = transitionLead(lead.status, next);
    await db.update(leads).set({ status }).where(eq(leads.id, lead.id));
    lead.status = status;
  };

  const checkOne = async (lead: Lead): Promise<void> => {
    let local: Awaited<ReturnType<LocalCheckerLike["check"]>>;
    try {
      local = await checker.check(lead.email);
    } catch {
      // A local-stage bug can only be wrong about this one lead: skip it, keep the paid verdicts.
      stats.local_errors += 1;
      return;
    }
    for (const flag of local.flags) stats.flags[flag] = (stats.flags[flag] ?? 0) + 1;

    if (!local.passed) {
      await db.insert(verifications).values({
        leadId: lead.id,
        email: lead.email, // the address actually checked: a later correction must not re-attribute this row
        verifier: "local",
        result: "invalid",
        raw: {
          failure: local.failure,
          flags: [...local.flags],
          mx_hosts: [...local.mxHosts],
          mx_path: local.mxPath,
        },
      });
      stats.local_invalid += 1;
      // Local-check INVALID is authoritative regardless of the configured verifier.
      await setStatus(lead, "undeliverable");
      return;
    }

    let verdict: Awaited<ReturnType<EmailVerifier["verify"]>>;
    try {
      verdict = await verifier.verify(lead.email);
    } catch (err) {
      // Provider/API failure: keep partial progress.
      stats.aborted ??= `${err instanceof Error ? err.name : "Error"}: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    const raw: Record<string, unknown> = { ...verdict.raw, authoritative: verifier.authoritative };
    if (local.flags.length) raw.local_flags = [...local.flags];
    raw.mx_hosts = [...local.mxHosts];
    raw.mx_path = local.mxPath;
    await db.insert(verifications).values({
      leadId: lead.id,
      email: lead.email,
      verifier: verifier.name,
      result: verdict.result,
      raw,
    });
    stats[verdict.result as VerificationResult] += 1;
    // A non-authoritative verdict gets its row for history and stats but never mints a status change.
    if (verifier.authoritative) {
      if (verdict.result === "valid") await setStatus(lead, "verified");
      else if (verdict.result === "invalid") await setStatus(lead, "undeliverable");
    }
  };
  await eachConcurrently(selected, opts.concurrency ?? 1, checkOne, () => stats.aborted !== null);
  return stats;
}
