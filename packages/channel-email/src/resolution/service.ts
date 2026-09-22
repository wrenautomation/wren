/**
 * Contact resolution (funnel L4): the only code allowed to spend verifier credits,
 * built so every rule in the credit policy is a visible branch.
 *
 * - buildCandidates mints contact_candidates from what is already known: scraped
 *   addresses (free pattern proof), the domain's proven pattern, or the guess
 *   ladder. Minting is free and never triggers verification.
 * - queueCandidates is the operator's explicit "these people are heading into a
 *   campaign" step: no speculative verification, ever.
 * - runResolution walks QUEUED candidates domain by domain:
 *     catch-all domain      → closed immediately, zero spend
 *     proven-pattern domain → one credit per person, best candidate only
 *     unknown-pattern domain→ the discovery budget: walk evidence order until
 *                             VALID (proves the pattern), catch_all, or
 *                             exhaustion → pattern_unknown, HITL, no re-spend
 *   A free local MX check runs before the first paid verdict per domain.
 * - Promotion goes through the ordinary lead importer; the verification row is
 *   then linked to BOTH candidate and lead so the lead-side funnel never re-buys.
 *
 * Domain knowledge (pattern proof, catch-all, spend) is computed from
 * verifications + candidates: a query, not a table, so it cannot drift.
 */
import {
  type Company,
  companies,
  emailDomain,
  emailSyntaxError,
  IDENTITY_KEY,
  type LeadSource,
  leads,
  normalizeEmail,
  type Person,
  people,
  type RawRow,
  runImport,
  sightings,
  transitionLead,
} from "@wren/core";
import type { Queryable } from "@wren/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { applyPattern, inferPattern, PATTERNS } from "../email-patterns.js";
import { activeSuppression } from "../guards.js";
import {
  type CandidateEvidence,
  type CandidateState,
  type ContactCandidate,
  contactCandidates,
  type Verification,
  verifications,
} from "../schema.js";
import { transitionCandidate } from "../state.js";
import type { LocalCheckerLike } from "../verification/local.js";
import { defaultLocalChecker } from "../verification/mailifier.js";
import type { EmailVerifier } from "../verification/verifier.js";

export const DEFAULT_DOMAIN_BUDGET = 5;

const EVIDENCE_ORDER: Record<CandidateEvidence, number> = {
  scraped: 0,
  derived_pattern: 1,
  guessed_pattern: 2,
};

const authoritativeRaw = sql`${verifications.raw}->>'authoritative' = 'true'`;

export interface DomainKnowledge {
  domain: string;
  provenPattern: string | null;
  catchAll: boolean;
  creditsSpent: number;
}

export const patternUnknown = (k: DomainKnowledge, budget: number): boolean =>
  k.provenPattern === null && !k.catchAll && k.creditsSpent >= budget;

/** What the ledger already knows about a domain: always derived, never a table. */
export async function domainKnowledge(db: Queryable, domain: string): Promise<DomainKnowledge> {
  const [proven] = await db
    .select({ pattern: contactCandidates.pattern })
    .from(contactCandidates)
    .where(
      and(
        eq(contactCandidates.domain, domain),
        isNotNull(contactCandidates.pattern),
        or(
          // A scraped address is free pattern proof unless the provider REJECTED it.
          and(eq(contactCandidates.evidence, "scraped"), ne(contactCandidates.state, "rejected")),
          eq(contactCandidates.state, "verified"),
        ),
      ),
    )
    // A paid VALID beats an unverified scrape when both exist.
    .orderBy(desc(sql`${contactCandidates.state} = 'verified'`), asc(contactCandidates.id))
    .limit(1);
  const [catchAll] = await db
    .select({ id: verifications.id })
    .from(verifications)
    .where(
      and(
        sql`split_part(${verifications.email}, '@', 2) = ${domain}`,
        eq(verifications.result, "catch_all"),
        // A stub's catch_all must not close a real domain.
        authoritativeRaw,
      ),
    )
    .limit(1);
  const [spent] = await db
    .select({ n: count() })
    .from(verifications)
    .innerJoin(contactCandidates, eq(verifications.contactCandidateId, contactCandidates.id))
    .where(
      and(
        eq(contactCandidates.domain, domain),
        // Scraped candidates verify at rule-2 pricing; only discovery spend counts.
        ne(contactCandidates.evidence, "scraped"),
        ne(verifications.verifier, "local"),
        // Only authoritative verdicts consume budget; a dry run must not.
        authoritativeRaw,
      ),
    );
  return {
    domain,
    provenPattern: proven?.pattern ?? null,
    catchAll: catchAll !== undefined,
    creditsSpent: spent?.n ?? 0,
  };
}

export interface BuildCandidatesStats extends Record<string, number> {
  people_seen: number;
  scraped: number;
  derived: number;
  guessed: number;
  no_usable_names: number;
}

/** Mint candidates for people at domained companies (free, idempotent: people with candidates are skipped). */
export async function buildCandidates(
  db: Queryable,
  opts: { limitPeople?: number } = {},
): Promise<BuildCandidatesStats> {
  const hasCandidates = db.select({ id: contactCandidates.personId }).from(contactCandidates);
  const q = db
    .select({ person: people, company: companies })
    .from(people)
    .innerJoin(companies, eq(people.companyId, companies.id))
    .where(and(isNotNull(companies.domain), notInArray(people.id, hasCandidates)))
    .orderBy(sql`${companies.domainVerifiedAt} DESC NULLS LAST`, asc(people.id));
  const rows = opts.limitPeople === undefined ? await q : await q.limit(opts.limitPeople);

  const counts: BuildCandidatesStats = {
    people_seen: 0,
    scraped: 0,
    derived: 0,
    guessed: 0,
    no_usable_names: 0,
  };
  const provenByDomain = new Map<string, string | null>();

  // Scraped evidence is append-only corroboration: a printed email may live in a
  // later encounter's sighting, so minting reads every encounter, not just person.raw.
  const sightingEmails = new Map<number, string[]>();
  const sighted = await db
    .select({ personId: sightings.personId, email: sql<string>`${sightings.raw}->>'email'` })
    .from(sightings)
    .where(and(isNotNull(sightings.personId), sql`${sightings.raw}->>'email' IS NOT NULL`));
  for (const s of sighted) {
    const list = sightingEmails.get(s.personId as number) ?? [];
    list.push(s.email);
    sightingEmails.set(s.personId as number, list);
  }

  for (const { person, company } of rows) {
    counts.people_seen += 1;
    const domain = company.domain as string;
    if (!provenByDomain.has(domain)) {
      provenByDomain.set(domain, (await domainKnowledge(db, domain)).provenPattern);
    }
    const proven = provenByDomain.get(domain) ?? null;
    const minted = new Map<string, typeof contactCandidates.$inferInsert>();
    const mint = (
      email: string,
      evidence: CandidateEvidence,
      pattern: string | null,
      rank: number,
      sourceRef: string,
    ) => {
      if (minted.has(email)) return;
      minted.set(email, {
        personId: person.id,
        email,
        domain: emailDomain(email),
        evidence,
        pattern,
        rank,
        state: "candidate",
        sourceRef,
      });
    };

    const raw = person.raw as Record<string, unknown> | null;
    const rawEmail = raw && typeof raw.email === "string" ? raw.email : null;
    const claimed = [...(rawEmail ? [rawEmail] : []), ...(sightingEmails.get(person.id) ?? [])];
    let scrapedAny = false;
    claimed.forEach((claim, scrapedRank) => {
      if (!claim.trim()) return;
      const email = normalizeEmail(claim);
      if (emailSyntaxError(email) !== null) return;
      const local = email.split("@")[0] ?? "";
      mint(
        email,
        "scraped",
        inferPattern(local, person.firstName, person.lastName),
        scrapedRank,
        person.originRef,
      );
      scrapedAny = true;
    });
    if (scrapedAny) counts.scraped += 1;

    if (proven) {
      const local = applyPattern(proven, person.firstName, person.lastName);
      if (local) {
        mint(`${local}@${domain}`, "derived_pattern", proven, 0, `pattern:${proven}`);
        counts.derived += 1;
      }
    } else {
      let guessedAny = false;
      PATTERNS.forEach((pattern, rank) => {
        const local = applyPattern(pattern, person.firstName, person.lastName);
        if (local === null) return;
        mint(`${local}@${domain}`, "guessed_pattern", pattern, rank, `pattern:${pattern}`);
        guessedAny = true;
      });
      if (guessedAny) counts.guessed += 1;
      else if (minted.size === 0) counts.no_usable_names += 1;
    }
    if (minted.size) await db.insert(contactCandidates).values([...minted.values()]);
  }
  return counts;
}

export interface QueueOptions {
  domain?: string | null;
  companySourceKey?: string | null;
  /** Keyless niches (agencies) address a firm by its website domain. */
  companyDomain?: string | null;
  /** One campaign's population: queueing authorizes spend, so it must never bleed across niches. */
  niche?: string | null;
  limitPeople?: number | null;
}

export interface QueueStats extends Record<string, number> {
  people_queued: number;
  candidates_queued: number;
  suppressed_skipped: number;
}

/**
 * Operator step: mark people's candidates as heading for a send. Selection order
 * follows the person_facts taxonomy: lowest rank first, avoid-list people last.
 */
export async function queueCandidates(db: Queryable, opts: QueueOptions = {}): Promise<QueueStats> {
  const filters = [sql`c.state = 'candidate'`];
  if (opts.domain) filters.push(sql`c.domain = ${opts.domain}`);
  if (opts.companySourceKey) filters.push(sql`pf.company_source_key = ${opts.companySourceKey}`);
  if (opts.companyDomain) filters.push(sql`pf.company_domain = ${opts.companyDomain}`);
  if (opts.niche) filters.push(sql`pf.company_niche = ${opts.niche}`);
  const limit = opts.limitPeople == null ? sql`` : sql`LIMIT ${opts.limitPeople}`;
  const selected = await db.execute(sql`
    SELECT DISTINCT pf.person_id, pf.role_rank, pf.avoid_emailing_first
    FROM person_facts pf
    JOIN contact_candidates c ON c.person_id = pf.person_id
    WHERE ${sql.join(filters, sql` AND `)}
    ORDER BY pf.avoid_emailing_first ASC, pf.role_rank ASC NULLS LAST, pf.person_id
    ${limit}
  `);
  const personIds = selected.map((r) => Number((r as { person_id: number }).person_id));
  const stats: QueueStats = {
    people_queued: personIds.length,
    candidates_queued: 0,
    suppressed_skipped: 0,
  };
  if (!personIds.length) return stats;
  const conditions = [
    inArray(contactCandidates.personId, personIds),
    eq(contactCandidates.state, "candidate"),
  ];
  // A person can hold candidates at OTHER domains too (a scraped freemail); queueing
  // those under a domain scope would spend credits the operator never authorized.
  if (opts.domain) conditions.push(eq(contactCandidates.domain, opts.domain));
  const candidates = await db
    .select()
    .from(contactCandidates)
    .where(and(...conditions));
  for (const candidate of candidates) {
    // Queueing authorizes paid spend and a suppressed address can never be sent to.
    if ((await activeSuppression(db, candidate.email)) !== null) {
      stats.suppressed_skipped += 1;
      continue;
    }
    await db
      .update(contactCandidates)
      .set({ state: transitionCandidate(candidate.state, "queued") })
      .where(eq(contactCandidates.id, candidate.id));
    stats.candidates_queued += 1;
  }
  return stats;
}

/** A VALID verdict waiting to become a lead: ids only, so it survives a journal boundary. */
export interface PromotionRef {
  candidateId: number;
  verificationId: number;
}

interface Promotion {
  candidate: ContactCandidate;
  person: Person;
  company: Company;
  verification: Verification;
}

async function loadPromotions(db: Queryable, refs: PromotionRef[]): Promise<Promotion[]> {
  if (!refs.length) return [];
  const rows = await db
    .select({
      candidate: contactCandidates,
      verification: verifications,
      person: people,
      company: companies,
    })
    .from(contactCandidates)
    .innerJoin(verifications, eq(verifications.contactCandidateId, contactCandidates.id))
    .innerJoin(people, eq(contactCandidates.personId, people.id))
    .innerJoin(companies, eq(people.companyId, companies.id))
    .where(
      inArray(
        verifications.id,
        refs.map((r) => r.verificationId),
      ),
    );
  const order = new Map(refs.map((r, i) => [r.verificationId, i]));
  return rows.sort(
    (a, b) => (order.get(a.verification.id) ?? 0) - (order.get(b.verification.id) ?? 0),
  );
}

/** VALID candidates as an import source: promotion is an ordinary lead import. */
class PromotedCandidateSource implements LeadSource {
  readonly sourceType = "candidate-promotion";
  readonly sourceRef: string;
  constructor(private readonly promotions: Promotion[]) {
    this.sourceRef = `candidates:${promotions.map((p) => p.candidate.id).join(",")}`;
  }
  *rows(): Iterable<RawRow> {
    for (const { candidate, person, company } of this.promotions) {
      yield {
        email: candidate.email,
        first_name: person.firstName ?? "",
        last_name: person.lastName ?? "",
        title: person.title ?? "",
        company_name: company.name ?? "",
        // Company keys come from our own registry chain, minted through the identity channel.
        [IDENTITY_KEY]: { source_key: company.sourceKey ?? "" },
        website: company.domain ?? "",
        country: company.country ?? "",
        source: "resolution",
        _candidate_id: candidate.id,
        _person_id: person.id,
        _evidence: candidate.evidence,
        _pattern: candidate.pattern,
      };
    }
  }
}

/**
 * Self-healing repair sweep: VERIFIED candidates with an authoritative VALID
 * verdict but no lead (a crash between a domain's checkpoint and the promotions
 * batch) ride the same promotion path as fresh VALIDs.
 */
export async function strandedPromotions(db: Queryable): Promise<PromotionRef[]> {
  const rows = await db
    .select({ candidateId: contactCandidates.id, verificationId: verifications.id })
    .from(contactCandidates)
    .innerJoin(verifications, eq(verifications.contactCandidateId, contactCandidates.id))
    .where(
      and(
        eq(contactCandidates.state, "verified"),
        isNull(contactCandidates.leadId),
        eq(verifications.result, "valid"),
        authoritativeRaw,
      ),
    )
    .orderBy(asc(contactCandidates.id));
  const seen = new Set<number>();
  const out: PromotionRef[] = [];
  for (const row of rows) {
    if (seen.has(row.candidateId)) continue;
    seen.add(row.candidateId);
    out.push(row);
  }
  return out;
}

export interface ResolutionStats {
  domains_processed: number;
  credits_spent: number;
  valid: number;
  invalid: number;
  risky: number;
  catch_all: number;
  promoted: number;
  patterns_proven: number;
  catch_all_domains: number;
  pattern_unknown_domains: number;
  dead_domains: number;
  people_unresolved: number;
  email_collisions: number;
  dead_pattern_candidates_pruned: number;
  stranded_repaired: number;
  suppressed_skipped: number;
  aborted: string | null;
}

export interface ResolutionOptions {
  domainBudget?: number;
  creditLimit?: number | null;
  /** Test seam, like runVerification's. */
  checker?: LocalCheckerLike;
  /** Called once per domain finished and once more after the promotions batch. */
  checkpoint?: (domain: string | null) => void | Promise<void>;
}

/** Mutable state of one domain's walk. */
interface RunContext {
  stats: ResolutionStats;
  promotions: PromotionRef[];
  spentThisRun: number;
  creditLimit: number | null;
}

const evidenceSort = (a: ContactCandidate, b: ContactCandidate): number =>
  EVIDENCE_ORDER[a.evidence] - EVIDENCE_ORDER[b.evidence] || a.rank - b.rank || a.id - b.id;

async function setState(
  db: Queryable,
  candidate: ContactCandidate,
  next: CandidateState,
): Promise<void> {
  const state = transitionCandidate(candidate.state, next);
  await db.update(contactCandidates).set({ state }).where(eq(contactCandidates.id, candidate.id));
  candidate.state = state;
}

async function resolveDomain(
  db: Queryable,
  verifier: EmailVerifier,
  domain: string,
  candidates: ContactCandidate[],
  ctx: RunContext,
  opts: { domainBudget: number; checker: LocalCheckerLike },
): Promise<void> {
  const { stats } = ctx;
  stats.domains_processed += 1;
  const knowledge = await domainKnowledge(db, domain);
  if (knowledge.catchAll) {
    // The provider structurally cannot say more. Candidates stay queued: sending
    // into catch-all domains is an open campaign-policy decision, not a rejection.
    stats.catch_all_domains += 1;
    return;
  }
  let exhausted = patternUnknown(knowledge, opts.domainBudget);
  if (exhausted) {
    // Discovery budget exhausted in an earlier run: HITL owns the domain. Scraped
    // candidates are still worth their rule-2 credit.
    stats.pattern_unknown_domains += 1;
    if (!candidates.some((c) => c.evidence === "scraped")) return;
  }

  // Free stage first: a domain with no working MX must cost 0 credits.
  const probe = candidates[0] as ContactCandidate;
  let local: Awaited<ReturnType<LocalCheckerLike["check"]>> | null;
  try {
    local = await opts.checker.check(probe.email);
  } catch {
    local = null; // resolver trouble is not evidence
  }
  if (local !== null && !local.passed) {
    await db.insert(verifications).values({
      contactCandidateId: probe.id,
      email: probe.email,
      verifier: "local",
      result: "invalid",
      raw: {
        failure: local.failure,
        flags: [...local.flags],
        mx_hosts: [...local.mxHosts],
        mx_path: local.mxPath,
      },
    });
    // The whole domain is dead; colleagues' rejection traces to this domain-mate's row.
    for (const candidate of candidates) await setState(db, candidate, "rejected");
    stats.dead_domains += 1;
    return;
  }

  let proven = knowledge.provenPattern;
  let budgetRemaining = opts.domainBudget - knowledge.creditsSpent;
  // Emails already resolved at this domain (any run): a second credit on the same
  // address for a different person would collapse two identities onto one lead.
  const taken = new Set(
    (
      await db
        .select({ email: contactCandidates.email })
        .from(contactCandidates)
        .where(and(eq(contactCandidates.domain, domain), eq(contactCandidates.state, "verified")))
    ).map((r) => r.email),
  );
  const byPerson = new Map<number, ContactCandidate[]>();
  for (const c of candidates) byPerson.set(c.personId, [...(byPerson.get(c.personId) ?? []), c]);

  /** One paid verdict; returns the row, or an abort reason. */
  const spend = async (candidate: ContactCandidate): Promise<Verification | string> => {
    if (ctx.creditLimit !== null && ctx.spentThisRun >= ctx.creditLimit)
      return "credit limit reached";
    let verdict: Awaited<ReturnType<EmailVerifier["verify"]>>;
    try {
      verdict = await verifier.verify(candidate.email);
    } catch (err) {
      // Provider failure: keep partial progress.
      return `${err instanceof Error ? err.name : "Error"}: ${err instanceof Error ? err.message : String(err)}`;
    }
    ctx.spentThisRun += 1;
    stats.credits_spent += 1;
    stats[verdict.result] += 1;
    const [row] = await db
      .insert(verifications)
      .values({
        contactCandidateId: candidate.id,
        email: candidate.email,
        verifier: verifier.name,
        result: verdict.result,
        // Only authoritative spend consumes a domain's budget.
        raw: { ...verdict.raw, authoritative: verifier.authoritative },
      })
      .returning();
    return row as Verification;
  };

  /** Apply a verdict to candidate state; VALID queues a promotion. */
  const settle = async (candidate: ContactCandidate, verification: Verification): Promise<void> => {
    // A stub must never mint a real fact: its row is recorded but moves no state.
    if (!verifier.authoritative) return;
    if (verification.result === "valid") {
      await setState(db, candidate, "verified");
      ctx.promotions.push({ candidateId: candidate.id, verificationId: verification.id });
      stats.promoted += 1;
    } else if (verification.result === "invalid") {
      await setState(db, candidate, "rejected");
      if (candidate.evidence === "scraped" && candidate.pattern) {
        // The pattern this scrape proved for free just died: colleagues' unqueued
        // DERIVED_PATTERN candidates minted from it are dead weight. Prune them.
        const dead = await db
          .delete(contactCandidates)
          .where(
            and(
              eq(contactCandidates.domain, candidate.domain),
              eq(contactCandidates.pattern, candidate.pattern),
              eq(contactCandidates.evidence, "derived_pattern"),
              eq(contactCandidates.state, "candidate"),
            ),
          )
          .returning({ id: contactCandidates.id });
        stats.dead_pattern_candidates_pruned += dead.length;
      }
    }
    // risky / catch_all: inconclusive. State untouched, verdict kept.
  };

  /** Rule 2: the single candidate worth one credit: a scraped address first, else the proven pattern's. */
  const bestForPerson = (
    personCandidates: ContactCandidate[],
    pattern: string | null,
  ): ContactCandidate | null => {
    const inPlay = personCandidates
      .filter((c) => c.state === "queued" && !taken.has(c.email))
      .sort(evidenceSort);
    for (const candidate of inPlay) {
      if (candidate.evidence === "scraped") return candidate;
      if (pattern && candidate.pattern === pattern) return candidate;
    }
    return null;
  };

  if (proven === null) {
    // Rule 3: the discovery budget, walked depth-first PER PERSON in evidence order.
    // Verdicts are per-mailbox: a pattern that fails for one person fails for
    // colleagues, so finishing one likely-existing person's ladder converges fastest.
    const personPriority = new Map<number, number>();
    for (const c of candidates)
      if (!personPriority.has(c.personId)) personPriority.set(c.personId, personPriority.size);
    const walk = candidates
      .filter((c) => c.state === "queued")
      .sort(
        (a, b) =>
          (personPriority.get(a.personId) ?? 0) - (personPriority.get(b.personId) ?? 0) ||
          evidenceSort(a, b),
      );
    const resolvedPeople = new Set<number>();
    for (const candidate of walk) {
      if (resolvedPeople.has(candidate.personId)) continue;
      if (taken.has(candidate.email)) {
        stats.email_collisions += 1;
        continue;
      }
      const scraped = candidate.evidence === "scraped";
      if (!scraped) {
        if (exhausted) continue; // discovery closed; later scraped may remain
        if (budgetRemaining <= 0) {
          exhausted = true;
          stats.pattern_unknown_domains += 1;
          continue; // keep walking for later people's scraped
        }
      }
      const outcome = await spend(candidate);
      if (typeof outcome === "string") {
        stats.aborted = outcome;
        return;
      }
      // Scraped evidence is person-specific proof at rule-2 pricing, never discovery spend.
      if (!scraped) budgetRemaining -= 1;
      await settle(candidate, outcome);
      if (outcome.result === "catch_all") {
        stats.catch_all_domains += 1;
        break;
      }
      if (outcome.result === "valid") {
        resolvedPeople.add(candidate.personId);
        taken.add(candidate.email);
        if (candidate.pattern) {
          proven = candidate.pattern;
          stats.patterns_proven += 1;
          break; // colleagues drop to rule-2 pricing below
        }
      }
    }
  }
  if (proven === null) return;

  // Rule 2: proven-pattern domain, one credit per person, best candidate only.
  for (const personCandidates of byPerson.values()) {
    if (personCandidates.some((c) => c.state === "verified")) continue; // resolved during discovery
    const chosen = bestForPerson(personCandidates, proven);
    if (chosen === null) {
      const queuedHere = personCandidates.filter((c) => c.state === "queued");
      // Same address already verified for a colleague: HITL decides whose mailbox it is.
      if (queuedHere.some((c) => taken.has(c.email))) stats.email_collisions += 1;
      else stats.people_unresolved += 1;
      continue;
    }
    const outcome = await spend(chosen);
    if (typeof outcome === "string") {
      stats.aborted = outcome;
      return;
    }
    await settle(chosen, outcome);
    if (outcome.result === "valid") taken.add(chosen.email);
    if (outcome.result === "catch_all") {
      stats.catch_all_domains += 1;
      return;
    }
  }
}

/** Mint leads for the run's VALIDs (fresh + repaired) through the ordinary importer and link the verdicts. */
export async function promoteCandidates(db: Queryable, refs: PromotionRef[]): Promise<void> {
  const promotions = await loadPromotions(db, refs);
  if (!promotions.length) return;
  await runImport(db, new PromotedCandidateSource(promotions), {
    defaults: { source: "resolution" },
  });
  const emails = promotions.map((p) => p.candidate.email);
  const leadRows = await db.select().from(leads).where(inArray(leads.email, emails));
  const byEmail = new Map(leadRows.map((l) => [l.email, l]));
  for (const { candidate, verification } of promotions) {
    const lead = byEmail.get(candidate.email);
    if (!lead) continue; // importer rejected the row; candidate keeps its verdict
    await db
      .update(contactCandidates)
      .set({ leadId: lead.id })
      .where(eq(contactCandidates.id, candidate.id));
    await db
      .update(verifications)
      .set({ leadId: lead.id })
      .where(eq(verifications.id, verification.id));
    // The VERDICT's own authoritative flag, not the current run's verifier: a stranded
    // repair's verdict may predate this run.
    const raw = verification.raw as Record<string, unknown>;
    if (raw.authoritative && lead.status === "imported") {
      await db
        .update(leads)
        .set({ status: transitionLead(lead.status, "verified") })
        .where(eq(leads.id, lead.id));
    }
  }
}

/** Queued candidates at one domain in walk order, suppressed addresses left queued and counted. */
export async function queuedAtDomain(
  db: Queryable,
  domain: string,
): Promise<{ candidates: ContactCandidate[]; suppressedSkipped: number }> {
  const queued = await db
    .select()
    .from(contactCandidates)
    .where(and(eq(contactCandidates.state, "queued"), eq(contactCandidates.domain, domain)))
    .orderBy(asc(contactCandidates.rank), asc(contactCandidates.id));
  const candidates: ContactCandidate[] = [];
  let suppressedSkipped = 0;
  for (const candidate of queued) {
    // A suppression recorded AFTER queueing must not spend a credit either.
    if ((await activeSuppression(db, candidate.email)) !== null) suppressedSkipped += 1;
    else candidates.push(candidate);
  }
  return { candidates, suppressedSkipped };
}

/** Domains with queued candidates, in walk order. */
export async function selectResolutionTargets(db: Queryable): Promise<string[]> {
  const rows = await db
    .selectDistinct({ domain: contactCandidates.domain })
    .from(contactCandidates)
    .where(eq(contactCandidates.state, "queued"))
    .orderBy(asc(contactCandidates.domain));
  return rows.map((r) => r.domain);
}

export interface DomainUnitOptions {
  domainBudget: number;
  checker: LocalCheckerLike;
  /** Credits already spent by this run, for the run-wide credit limit. */
  alreadySpent: number;
  creditLimit: number | null;
}

export interface DomainUnitResult {
  stats: ResolutionStats;
  promotions: PromotionRef[];
  spent: number;
}

/**
 * One domain's whole walk (the Restate unit): re-reads its queued candidates,
 * spends under the policy, returns the stats delta and the VALIDs to promote.
 */
export async function resolveDomainUnit(
  db: Queryable,
  verifier: EmailVerifier,
  domain: string,
  opts: DomainUnitOptions,
): Promise<DomainUnitResult> {
  const ctx: RunContext = {
    stats: emptyResolutionStats(),
    promotions: [],
    spentThisRun: opts.alreadySpent,
    creditLimit: opts.creditLimit,
  };
  const { candidates, suppressedSkipped } = await queuedAtDomain(db, domain);
  ctx.stats.suppressed_skipped = suppressedSkipped;
  if (candidates.length) {
    await resolveDomain(db, verifier, domain, candidates, ctx, {
      domainBudget: opts.domainBudget,
      checker: opts.checker,
    });
  }
  return {
    stats: ctx.stats,
    promotions: ctx.promotions,
    spent: ctx.spentThisRun - opts.alreadySpent,
  };
}

export function addResolutionStats(
  total: ResolutionStats,
  delta: ResolutionStats,
): ResolutionStats {
  const out = { ...total };
  for (const key of Object.keys(delta) as Array<keyof ResolutionStats>) {
    if (key === "aborted") continue;
    out[key] += delta[key];
  }
  out.aborted = delta.aborted ?? total.aborted;
  return out;
}

export function emptyResolutionStats(): ResolutionStats {
  return {
    domains_processed: 0,
    credits_spent: 0,
    valid: 0,
    invalid: 0,
    risky: 0,
    catch_all: 0,
    promoted: 0,
    patterns_proven: 0,
    catch_all_domains: 0,
    pattern_unknown_domains: 0,
    dead_domains: 0,
    people_unresolved: 0,
    email_collisions: 0,
    dead_pattern_candidates_pruned: 0,
    stranded_repaired: 0,
    suppressed_skipped: 0,
    aborted: null,
  };
}

/**
 * Spend credits on queued candidates under the credit policy. One transaction per
 * domain and one for the promotions batch, each followed by `checkpoint`: real
 * credits, so a crash loses at most one domain's spend. A repair sweep first heals
 * prior half-finished runs.
 */
export async function runResolution(
  db: Queryable,
  verifier: EmailVerifier,
  opts: ResolutionOptions = {},
): Promise<ResolutionStats> {
  const domainBudget = opts.domainBudget ?? DEFAULT_DOMAIN_BUDGET;
  const checker = opts.checker ?? defaultLocalChecker();
  const creditLimit = opts.creditLimit ?? null;
  let stats = emptyResolutionStats();
  const promotions = await strandedPromotions(db);
  stats.stranded_repaired = promotions.length;
  let spent = 0;
  for (const domain of await selectResolutionTargets(db)) {
    const unit = await db.transaction((tx) =>
      resolveDomainUnit(tx, verifier, domain, {
        domainBudget,
        checker,
        alreadySpent: spent,
        creditLimit,
      }),
    );
    stats = addResolutionStats(stats, unit.stats);
    promotions.push(...unit.promotions);
    spent += unit.spent;
    if (opts.checkpoint) await opts.checkpoint(domain);
    if (stats.aborted) break;
  }
  if (promotions.length) {
    await db.transaction((tx) => promoteCandidates(tx, promotions));
    if (opts.checkpoint) await opts.checkpoint(null);
  }
  return stats;
}

export interface Ledger {
  by_verifier: Array<[string, number]>;
  top_domains: Array<[string, number]>;
}

/** The visible spend ledger, straight from verifications. */
export async function ledger(db: Queryable): Promise<Ledger> {
  const byVerifier = await db
    .select({ verifier: verifications.verifier, n: count() })
    .from(verifications)
    .groupBy(verifications.verifier)
    .orderBy(desc(count()));
  const domainExpr = sql<string>`split_part(${verifications.email}, '@', 2)`;
  const byDomain = await db
    .select({ domain: domainExpr, n: count() })
    .from(verifications)
    .where(and(ne(verifications.verifier, "local"), isNotNull(verifications.email)))
    .groupBy(domainExpr)
    .orderBy(desc(count()))
    .limit(20);
  return {
    by_verifier: byVerifier.map((r) => [r.verifier, r.n]),
    top_domains: byDomain.map((r) => [r.domain, r.n]),
  };
}
