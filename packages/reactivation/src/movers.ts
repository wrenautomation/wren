/**
 * `crm run` movers stage: a mover's address at the new firm. Their CRM address
 * is at the old firm, so a move is only worth a draft once an address at the
 * new one checks out. Free path only: the firm's site from its name (a CRM
 * company of that name first, else DNS and a page that speaks for the firm),
 * the pattern the domain is known to use or the three common ones, then the
 * local check and the verifier, best guess first, stopping at the first that
 * passes. A catch-all server proves nothing, so that stops with no address.
 * A found address puts the new firm in `companies` (by domain), so compose
 * counts the mover's thread at the firm they work at now. Each move is tried
 * once; a miss again after a month.
 */
import {
  COMMON_GUESS_RANKS,
  contactCandidates,
  domainKnowledge,
  type EmailVerifier,
  type LocalCheckerLike,
  SERVER_HOLD_REASONS,
  transitionCandidate,
  verifications,
  waitingDomains,
} from "@wren/channel-email";
import { applyPattern, PATTERNS } from "@wren/core";
import type { Queryable } from "@wren/db";
import { findHomepage, type HomepageFetcher, type Resolves } from "@wren/research/discovery";
import { and, eq, inArray, sql } from "drizzle-orm";
import { type MoverOutcome, moverAddresses } from "./schema.js";
import { LATEST_CRM_ROW, whereFinding } from "./score.js";

const RETRY_DAYS = 30;

export interface CrmMoverStats {
  selected: number;
  found: number;
  noDomain: number;
  catchAll: number;
  notFound: number;
  /** Its server blocked or greylisted us: tried again next run. */
  held: number;
  errors: number;
  aborted: string | null;
}

export interface MoverDeps {
  verifier: EmailVerifier;
  checker: LocalCheckerLike;
  fetchHomepage: HomepageFetcher;
  resolves?: Resolves;
}

interface Mover extends Record<string, unknown> {
  person_id: number;
  finding_id: number;
  new_firm: string;
  first_name: string | null;
  last_name: string | null;
}

/** Movers whose current move names a firm and has no address tried, or a miss over a month old. */
function moversSql(opts: { limit?: number; count?: boolean }) {
  return sql`
    with latest as (${LATEST_CRM_ROW}),
    moves as (
      select l.person_id, w.id finding_id, btrim(w.value->>'to') new_firm
      from latest l join findings w on w.id = ${whereFinding(sql`l.person_id`)}
      where w.kind = 'job_change' and nullif(btrim(w.value->>'to'), '') is not null)
    ${opts.count ? sql`select count(*)::int n` : sql`select m.*, pe.first_name, pe.last_name`}
    from moves m join people pe on pe.id = m.person_id
    where not exists (select 1 from mover_addresses ma where ma.finding_id = m.finding_id
      and (ma.outcome = 'found' or ma.tried_at > now() - make_interval(days => ${RETRY_DAYS})))
    ${opts.count ? sql`` : sql`order by m.person_id limit ${opts.limit ?? 1_000_000}`}`;
}

export async function moversDue(db: Queryable): Promise<number> {
  const [r] = await db.execute<{ n: number }>(moversSql({ count: true }));
  return r?.n ?? 0;
}

/** Why the stage can't run with this verifier, or null when it can. */
export function moverVerifierProblem(v: EmailVerifier): string | null {
  if (v.costsCredits) return `the ${v.name} verifier costs credits; movers stay on the free path`;
  if (!v.authoritative)
    return `the ${v.name} verifier's word doesn't count; run with --verifier smtp`;
  return null;
}

export async function findMoverAddresses(
  db: Queryable,
  deps: MoverDeps,
  opts: { limit?: number } = {},
): Promise<CrmMoverStats> {
  const stats: CrmMoverStats = {
    selected: 0,
    found: 0,
    noDomain: 0,
    catchAll: 0,
    notFound: 0,
    held: 0,
    errors: 0,
    aborted: moverVerifierProblem(deps.verifier),
  };
  if (stats.aborted) return stats;
  const movers = await db.execute<Mover>(moversSql(opts));
  stats.selected = movers.length;
  for (const m of movers) {
    let r: Tried;
    try {
      r = await tryMover(db, deps, m);
    } catch (err) {
      if (!(err instanceof VerifierDown)) throw err;
      stats.aborted = err.message;
      break;
    }
    if (r === "error") stats.errors += 1;
    else if (r === "held") stats.held += 1;
    else {
      await db
        .insert(moverAddresses)
        .values({ findingId: m.finding_id, personId: m.person_id, ...r })
        .onConflictDoUpdate({
          target: moverAddresses.findingId,
          set: {
            domain: r.domain,
            outcome: r.outcome,
            candidateId: r.candidateId,
            triedAt: sql`now()`,
          },
        });
      const key = {
        found: "found",
        no_domain: "noDomain",
        catch_all: "catchAll",
        not_found: "notFound",
      } as const;
      stats[key[r.outcome]] += 1;
    }
  }
  // Every found mover's new firm, earlier passes' too: compose files the mover under it.
  await db.execute(sql`
    insert into companies (domain, name)
    select distinct on (ma.domain) ma.domain, btrim(f.value->>'to')
    from mover_addresses ma join findings f on f.id = ma.finding_id
    where ma.outcome = 'found' and ma.domain is not null
    on conflict (domain) do nothing`);
  return stats;
}

class VerifierDown extends Error {}

type Tried =
  | { outcome: MoverOutcome; domain: string | null; candidateId: number | null }
  | "held"
  | "error";

async function tryMover(db: Queryable, deps: MoverDeps, m: Mover): Promise<Tried> {
  const domain = await newFirmDomain(db, deps, m.new_firm);
  if (!domain) return { outcome: "no_domain", domain: null, candidateId: null };
  const miss = (outcome: MoverOutcome) => ({ outcome, domain, candidateId: null });
  const known = await domainKnowledge(db, domain);
  if (known.catchAll) return miss("catch_all");
  const [waiting] = await db.execute(sql`select 1 where ${domain} in ${waitingDomains()}`);
  if (waiting) return "held";
  const patterns = known.provenPattern
    ? [known.provenPattern]
    : PATTERNS.slice(0, COMMON_GUESS_RANKS);
  const guesses = patterns.flatMap((pattern, rank) => {
    const local = applyPattern(pattern, m.first_name, m.last_name);
    return local ? [{ pattern, rank, email: `${local}@${domain}` }] : [];
  });
  if (!guesses.length) return miss("not_found");
  await db
    .insert(contactCandidates)
    .values(
      guesses.map((g) => ({
        personId: m.person_id,
        email: g.email,
        domain,
        evidence: known.provenPattern ? ("derived_pattern" as const) : ("guessed_pattern" as const),
        pattern: g.pattern,
        rank: g.rank,
        state: "candidate" as const,
        sourceRef: `move:f${m.finding_id}`,
      })),
    )
    .onConflictDoNothing();
  const candidates = await db
    .select()
    .from(contactCandidates)
    .where(
      and(
        eq(contactCandidates.personId, m.person_id),
        inArray(
          contactCandidates.email,
          guesses.map((g) => g.email),
        ),
      ),
    )
    .orderBy(contactCandidates.rank, contactCandidates.id);
  const settle = async (id: number, next: "verified" | "rejected") => {
    transitionCandidate(transitionCandidate("candidate", "queued"), next);
    await db.update(contactCandidates).set({ state: next }).where(eq(contactCandidates.id, id));
  };
  for (const c of candidates) {
    if (c.state === "verified") return { outcome: "found", domain, candidateId: c.id };
    if (c.state === "rejected") continue;
    let local: Awaited<ReturnType<LocalCheckerLike["check"]>>;
    try {
      local = await deps.checker.check(c.email);
    } catch {
      return "error";
    }
    const lookup = { mx_hosts: [...local.mxHosts], mx_path: local.mxPath };
    if (!local.passed) {
      await db.insert(verifications).values({
        contactCandidateId: c.id,
        email: c.email,
        verifier: "local",
        result: "invalid",
        raw: { failure: local.failure, flags: [...local.flags], ...lookup },
      });
      await settle(c.id, "rejected");
      continue;
    }
    let verdict: Awaited<ReturnType<EmailVerifier["verify"]>>;
    try {
      verdict = await deps.verifier.verify(c.email);
    } catch (err) {
      throw new VerifierDown(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    }
    await db.insert(verifications).values({
      contactCandidateId: c.id,
      email: c.email,
      verifier: deps.verifier.name,
      result: verdict.result,
      raw: { ...verdict.raw, authoritative: deps.verifier.authoritative, ...lookup },
    });
    if (verdict.result === "valid") {
      await settle(c.id, "verified");
      return { outcome: "found", domain, candidateId: c.id };
    }
    if (verdict.result === "invalid") await settle(c.id, "rejected");
    // Any address passes there, so none is proven: stop asking.
    else if (verdict.result === "catch_all") return miss("catch_all");
    else if (SERVER_HOLD_REASONS.has(String(verdict.raw.reason))) return "held";
  }
  return miss("not_found");
}

/** A CRM company of that name with a domain, else the site that speaks for the firm. */
async function newFirmDomain(db: Queryable, deps: MoverDeps, firm: string): Promise<string | null> {
  const [crm] = await db.execute<{ domain: string }>(sql`
    select domain from companies where lower(btrim(name)) = lower(${firm}) and domain is not null
    order by id limit 1`);
  if (crm) return crm.domain;
  const home = await findHomepage(firm, null, {
    fetchHomepage: deps.fetchHomepage,
    ...(deps.resolves ? { resolves: deps.resolves } : {}),
  });
  return home?.domain ?? null;
}
