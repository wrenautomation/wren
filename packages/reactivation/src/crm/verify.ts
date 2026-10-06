/**
 * Check the addresses the CRM gave us. They are known addresses, not guesses, so
 * this is a straight check, not the resolution walker's pattern search: local
 * check first (an INVALID there is final), then the verifier. Each address is
 * checked once per run, whoever shares it; a risky or catch-all verdict leaves the
 * candidate open. A candidate counts as checked when a local, same-verifier or
 * authoritative verdict exists: a weaker verifier's word does not block a
 * stronger one.
 */
import {
  type CandidateState,
  contactCandidates,
  type EmailVerifier,
  eachConcurrently,
  type LocalCheckerLike,
  SERVER_HOLD_REASONS,
  transitionCandidate,
  verifications,
  waitingDomains,
} from "@wren/channel-email";
import { retryDue } from "@wren/core/checks";
import type { Queryable } from "@wren/db";
import { and, eq, inArray, notExists, or, sql } from "drizzle-orm";
import { WHERE_STAGE } from "../score.js";

export interface CrmVerifyStats {
  /** Candidates picked; the verdict counts below are per address. */
  selected: number;
  local_invalid: number;
  local_errors: number;
  valid: number;
  invalid: number;
  risky: number;
  catch_all: number;
  /** Skipped: its server blocked or greylisted another address earlier in this run. */
  held: number;
  aborted: string | null;
}

export async function checkCrmEmails(
  db: Queryable,
  verifier: EmailVerifier,
  checker: LocalCheckerLike,
  opts: { limit?: number; concurrency?: number } = {},
): Promise<CrmVerifyStats> {
  const selected = await db
    .select()
    .from(contactCandidates)
    .where(
      and(
        eq(contactCandidates.evidence, "crm"),
        // A server that blocked or greylisted any address waits out that verdict first.
        sql`${contactCandidates.domain} not in ${waitingDomains()}`,
        or(
          and(
            eq(contactCandidates.state, "candidate"),
            notExists(
              db
                .select({ one: sql`1` })
                .from(verifications)
                .where(
                  and(
                    eq(verifications.contactCandidateId, contactCandidates.id),
                    or(
                      inArray(verifications.verifier, ["local", verifier.name]),
                      sql`(${verifications.raw}->>'authoritative')::boolean`,
                    ),
                  ),
                ),
            ),
          ),
          // Its sources disagreed and the hold ran out: the mailbox is asked once more.
          sql`${retryDue(WHERE_STAGE, sql`'person:' || ${contactCandidates.personId}`)}
            and not exists (select 1 from verifications v join unit_holds h
              on h.stage = ${WHERE_STAGE} and h.subject = 'person:' || ${contactCandidates.personId}
              where v.contact_candidate_id = ${contactCandidates.id} and v.checked_at > h.until)`,
        ),
      ),
    )
    .orderBy(contactCandidates.id)
    .limit(opts.limit ?? 1_000_000);
  // One check per address; its verdict lands on every candidate that shares it.
  const byEmail = new Map<string, number[]>();
  for (const c of selected) byEmail.set(c.email, [...(byEmail.get(c.email) ?? []), c.id]);
  const stats: CrmVerifyStats = {
    selected: selected.length,
    local_invalid: 0,
    local_errors: 0,
    valid: 0,
    invalid: 0,
    risky: 0,
    catch_all: 0,
    held: 0,
    aborted: null,
  };
  // Domains whose server turned us away during this run: the rest of their addresses wait.
  const holding = new Set<string>();
  const settle = async (id: number, next: CandidateState) => {
    transitionCandidate(transitionCandidate("candidate", "queued"), next);
    await db.update(contactCandidates).set({ state: next }).where(eq(contactCandidates.id, id));
  };

  await eachConcurrently(
    [...byEmail],
    opts.concurrency ?? 1,
    async ([email, ids]) => {
      let local: Awaited<ReturnType<LocalCheckerLike["check"]>>;
      try {
        local = await checker.check(email);
      } catch {
        stats.local_errors += 1;
        return;
      }
      const lookup = { mx_hosts: [...local.mxHosts], mx_path: local.mxPath };
      if (!local.passed) {
        await db.insert(verifications).values(
          ids.map((id) => ({
            contactCandidateId: id,
            email,
            verifier: "local",
            result: "invalid" as const,
            raw: { failure: local.failure, flags: [...local.flags], ...lookup },
          })),
        );
        stats.local_invalid += 1;
        for (const id of ids) await settle(id, "rejected");
        return;
      }
      const domain = email.split("@")[1] ?? "";
      if (holding.has(domain)) {
        stats.held += 1;
        return;
      }
      let verdict: Awaited<ReturnType<EmailVerifier["verify"]>>;
      try {
        verdict = await verifier.verify(email);
      } catch (err) {
        stats.aborted ??= err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        return;
      }
      const raw = {
        ...verdict.raw,
        authoritative: verifier.authoritative,
        ...(local.flags.length ? { local_flags: [...local.flags] } : {}),
        ...lookup,
      };
      await db.insert(verifications).values(
        ids.map((id) => ({
          contactCandidateId: id,
          email,
          verifier: verifier.name,
          result: verdict.result,
          raw,
        })),
      );
      stats[verdict.result] += 1;
      if (verdict.result === "risky" && SERVER_HOLD_REASONS.has(String(verdict.raw.reason)))
        holding.add(domain);
      if (!verifier.authoritative) return;
      const next =
        verdict.result === "valid" ? "verified" : verdict.result === "invalid" ? "rejected" : null;
      if (next) for (const id of ids) await settle(id, next);
    },
    () => stats.aborted !== null,
  );
  return stats;
}
