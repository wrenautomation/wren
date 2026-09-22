/**
 * The credit policy against the migrated schema: candidate minting, the per-domain
 * discovery budget, pattern proof and re-pricing, catch-all closure, dead domains,
 * and promotion through the lead importer (suppression still gates).
 */
import { type Company, companies, leads, type Person, people, suppressions } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildCandidates,
  domainKnowledge,
  queueCandidates,
  runResolution,
} from "../../src/resolution/service.js";
import {
  type ContactCandidate,
  contactCandidates,
  type VerificationResult,
  verifications,
} from "../../src/schema.js";
import type { LocalCheck, LocalCheckerLike } from "../../src/verification/local.js";
import { type EmailVerifier, FakeVerifier, type Verdict } from "../../src/verification/verifier.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["imports", "companies", "suppressions", "leads"]));
const db = () => pg.db;

const DOMAIN = "veloqua.example";

/** Provider stub: verdicts by exact address, default invalid. */
class MapVerifier implements EmailVerifier {
  readonly name = "map";
  readonly authoritative = true;
  readonly costsCredits = true;
  readonly calls: string[] = [];
  constructor(private readonly verdicts: Record<string, VerificationResult>) {}
  async verify(email: string): Promise<Verdict> {
    this.calls.push(email);
    return { result: this.verdicts[email] ?? "invalid", raw: { stub: true } };
  }
}
const passChecker: LocalCheckerLike = {
  async check(email): Promise<LocalCheck> {
    return {
      email,
      failure: null,
      flags: [],
      mxHosts: ["mx.veloqua.example"],
      mxPath: "mx",
      passed: true,
    };
  },
};
const failChecker: LocalCheckerLike = {
  async check(email): Promise<LocalCheck> {
    return {
      email,
      failure: "domain has no mail server",
      flags: [],
      mxHosts: [],
      mxPath: null,
      passed: false,
    };
  },
};

type PersonSpec = [first: string, last: string, raw: Record<string, unknown>];
async function makeFirm(
  specs: PersonSpec[],
  opts: { key?: string | null; domain?: string } = {},
): Promise<{ company: Company; people: Person[] }> {
  const [company] = await db()
    .insert(companies)
    .values({
      sourceKey: opts.key === undefined ? "crd:940001" : opts.key,
      domain: opts.domain ?? DOMAIN,
      name: "Veloqua Advisors",
      raw: {},
    })
    .returning();
  const made: Person[] = [];
  for (const [i, [first, last, raw]] of specs.entries()) {
    const [person] = await db()
      .insert(people)
      .values({
        companyId: (company as Company).id,
        fullName: `${first} ${last}`,
        firstName: first,
        lastName: last,
        title: i === 0 ? "Owner" : "Advisor",
        isCompliance: false,
        origin: "registry",
        originRef: "test",
        raw,
      })
      .returning();
    made.push(person as Person);
  }
  return { company: company as Company, people: made };
}
async function prepare(specs: PersonSpec[], opts: { key?: string | null; domain?: string } = {}) {
  const made = await makeFirm(specs, opts);
  await buildCandidates(db());
  await queueCandidates(db());
  return made;
}
const candidatesAt = (domain: string) =>
  db()
    .select()
    .from(contactCandidates)
    .where(eq(contactCandidates.domain, domain))
    .orderBy(asc(contactCandidates.id));
const statesAt = async (domain: string) =>
  new Set((await candidatesAt(domain)).map((c) => c.state));
const suppress = (kind: "email" | "domain", value: string) =>
  db().insert(suppressions).values({ kind, value, reason: "manual" });

describe("buildCandidates", () => {
  it("mints scraped and guessed candidates", async () => {
    await prepare([
      ["Jane", "Doe", { email: `jane.doe@${DOMAIN}` }],
      ["Bob", "Reyes", {}],
    ]);
    const candidates = await candidatesAt(DOMAIN);
    const scraped = candidates.filter((c) => c.evidence === "scraped");
    expect(scraped).toHaveLength(1);
    expect(scraped[0]?.pattern).toBe("{first}.{last}"); // inferred: free pattern proof
    expect(
      candidates.some(
        (c) => c.personId !== scraped[0]?.personId && c.evidence === "guessed_pattern",
      ),
    ).toBe(true);
    expect((await domainKnowledge(db(), DOMAIN)).provenPattern).toBe("{first}.{last}");
  });

  it("is idempotent", async () => {
    await prepare([["Jane", "Doe", {}]]);
    const newest = () =>
      db()
        .select({ id: contactCandidates.id })
        .from(contactCandidates)
        .orderBy(desc(contactCandidates.id))
        .limit(1);
    const [before] = await newest();
    await buildCandidates(db());
    const [after] = await newest();
    expect(before?.id).toBe(after?.id);
  });

  it("a rejected scraped address no longer proves the pattern", async () => {
    await prepare([["Jane", "Doe", { email: `jane.doe@${DOMAIN}` }]]);
    expect((await domainKnowledge(db(), DOMAIN)).provenPattern).toBe("{first}.{last}");
    await db()
      .update(contactCandidates)
      .set({ state: "rejected" })
      .where(and(eq(contactCandidates.domain, DOMAIN), eq(contactCandidates.evidence, "scraped")));
    expect((await domainKnowledge(db(), DOMAIN)).provenPattern).toBeNull();
  });

  it("queue scopes by company domain", async () => {
    // Keyless niches address a firm by its website domain.
    await makeFirm([["Ana", "Lee", {}]], { key: null, domain: "keyless.example" });
    await makeFirm([["Bob", "Reyes", {}]], { key: "crd:940002", domain: DOMAIN });
    await buildCandidates(db());
    const stats = await queueCandidates(db(), { companyDomain: "keyless.example" });
    expect(stats.people_queued).toBe(1);
    const queued = await db()
      .select()
      .from(contactCandidates)
      .where(
        and(
          eq(contactCandidates.state, "queued"),
          inArray(contactCandidates.domain, ["keyless.example", DOMAIN]),
        ),
      );
    expect(queued.length).toBeGreaterThan(0);
    expect(queued.every((c) => c.domain === "keyless.example")).toBe(true);
  });

  it("queueing skips suppressed addresses", async () => {
    await makeFirm([["Jane", "Doe", { email: `jane.doe@${DOMAIN}` }]]);
    await suppress("email", `jane.doe@${DOMAIN}`);
    await buildCandidates(db());
    const stats = await queueCandidates(db());
    expect(stats.suppressed_skipped).toBe(1);
    const queued = await db()
      .select()
      .from(contactCandidates)
      .where(eq(contactCandidates.state, "queued"));
    expect(queued.length).toBeGreaterThan(0);
    expect(queued.every((c) => c.email !== `jane.doe@${DOMAIN}`)).toBe(true);
  });
});

describe("discovery budget", () => {
  it("VALID proves the pattern and reprices colleagues", async () => {
    await prepare([
      ["Jane", "Doe", {}],
      ["Bob", "Reyes", {}],
    ]);
    const verifier = new MapVerifier({
      [`jane.doe@${DOMAIN}`]: "invalid",
      [`jdoe@${DOMAIN}`]: "valid",
      [`breyes@${DOMAIN}`]: "valid",
    });
    const stats = await runResolution(db(), verifier, { checker: passChecker });
    // Discovery: jane.doe (invalid), jdoe (VALID → proves {f}{last}); Bob costs one credit on breyes.
    expect(stats.patterns_proven).toBe(1);
    expect(stats.promoted).toBe(2);
    expect(stats.credits_spent).toBe(3);
    expect((await domainKnowledge(db(), DOMAIN)).provenPattern).toBe("{f}{last}");
    const rows = await db()
      .select()
      .from(leads)
      .where(inArray(leads.email, [`jdoe@${DOMAIN}`, `breyes@${DOMAIN}`]));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((l) => l.status))).toEqual(new Set(["verified"]));
    // The paid verdict is linked to BOTH candidate and lead (never re-buy).
    for (const lead of rows) {
      const linked = await db()
        .select()
        .from(verifications)
        .where(eq(verifications.leadId, lead.id));
      expect(linked).toHaveLength(1);
      expect(linked[0]?.contactCandidateId).not.toBeNull();
    }
  });

  it("budget exhaustion flags pattern_unknown and never respends", async () => {
    await prepare([
      ["Jane", "Doe", {}],
      ["Bob", "Reyes", {}],
    ]);
    const stats = await runResolution(db(), new MapVerifier({}), {
      domainBudget: 5,
      checker: passChecker,
    });
    expect(stats.credits_spent).toBe(5);
    expect(stats.pattern_unknown_domains).toBe(1);
    expect(stats.promoted).toBe(0);
    const again = await runResolution(db(), new MapVerifier({}), {
      domainBudget: 5,
      checker: passChecker,
    });
    expect(again.credits_spent).toBe(0);
    expect(again.pattern_unknown_domains).toBe(1);
  });

  it("catch-all closes the domain at first contact", async () => {
    await prepare([
      ["Jane", "Doe", {}],
      ["Bob", "Reyes", {}],
    ]);
    const stats = await runResolution(
      db(),
      new MapVerifier({ [`jane.doe@${DOMAIN}`]: "catch_all" }),
      {
        checker: passChecker,
      },
    );
    expect(stats.credits_spent).toBe(1);
    expect(stats.catch_all_domains).toBe(1);
    // Open policy: candidates stay queued, nothing rejected.
    expect((await statesAt(DOMAIN)).has("verified")).toBe(false);
    const again = await runResolution(db(), new MapVerifier({}), { checker: passChecker });
    expect(again.credits_spent).toBe(0);
    expect(again.catch_all_domains).toBe(1);
  });

  it("a dead domain costs zero credits", async () => {
    await prepare([["Jane", "Doe", {}]]);
    const verifier = new MapVerifier({});
    const stats = await runResolution(db(), verifier, { checker: failChecker });
    expect(stats.credits_spent).toBe(0);
    expect(stats.dead_domains).toBe(1);
    expect(verifier.calls).toEqual([]);
    expect(await statesAt(DOMAIN)).toEqual(new Set(["rejected"]));
  });

  it("the credit limit stops the run", async () => {
    await prepare([
      ["Jane", "Doe", {}],
      ["Bob", "Reyes", {}],
    ]);
    const stats = await runResolution(db(), new MapVerifier({}), {
      creditLimit: 2,
      checker: passChecker,
    });
    expect(stats.credits_spent).toBe(2);
    expect(stats.aborted).toBe("credit limit reached");
  });
});

describe("dry run", () => {
  it("a non-authoritative verifier moves nothing and eats no budget", async () => {
    await prepare([["Jane", "Doe", {}]]);
    const stats = await runResolution(db(), new FakeVerifier(), { checker: passChecker });
    expect(stats.credits_spent).toBeGreaterThan(0); // verdict rows are recorded
    expect(stats.promoted).toBe(0); // but no state moves, nothing promotes, no pattern proven
    expect(await statesAt(DOMAIN)).toEqual(new Set(["queued"]));
    const knowledge = await domainKnowledge(db(), DOMAIN);
    expect(knowledge.provenPattern).toBeNull();
    expect(knowledge.creditsSpent).toBe(0);
    // A real run afterwards still has its full budget.
    const real = await runResolution(db(), new MapVerifier({}), {
      domainBudget: 3,
      checker: passChecker,
    });
    expect(real.credits_spent).toBe(3);
  });
});

describe("promotion gates", () => {
  it("suppressed addresses never queue or spend", async () => {
    await suppress("domain", DOMAIN);
    await prepare([["Jane", "Doe", { email: `jane.doe@${DOMAIN}` }]]);
    const verifier = new MapVerifier({ [`jane.doe@${DOMAIN}`]: "valid" });
    const stats = await runResolution(db(), verifier, { checker: passChecker });
    expect(stats.credits_spent).toBe(0);
    expect(stats.promoted).toBe(0);
    expect(verifier.calls).toEqual([]);
    expect(
      await db()
        .select()
        .from(leads)
        .where(eq(leads.email, `jane.doe@${DOMAIN}`)),
    ).toEqual([]);
    const candidates = await candidatesAt(DOMAIN);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.state === "candidate")).toBe(true);
  });

  it("a suppression added after queueing still spends nothing", async () => {
    await prepare([["Jane", "Doe", { email: `jane.doe@${DOMAIN}` }]]);
    await suppress("domain", DOMAIN);
    const verifier = new MapVerifier({ [`jane.doe@${DOMAIN}`]: "valid" });
    const stats = await runResolution(db(), verifier, { checker: passChecker });
    expect(stats.credits_spent).toBe(0);
    expect(stats.suppressed_skipped).toBeGreaterThanOrEqual(1);
    expect(verifier.calls).toEqual([]);
  });
});

describe("collisions and the scraped exemption", () => {
  it("the same guessed email is never bought twice", async () => {
    // Two Smiths: the {last} pattern mints the identical smith@ guess.
    await prepare([
      ["Alice", "Smith", {}],
      ["Zed", "Smith", {}],
    ]);
    const verifier = new MapVerifier({ [`smith@${DOMAIN}`]: "valid" });
    const stats = await runResolution(db(), verifier, { domainBudget: 10, checker: passChecker });
    expect(stats.patterns_proven).toBe(1);
    expect(verifier.calls.filter((e) => e === `smith@${DOMAIN}`)).toHaveLength(1);
    expect(stats.email_collisions).toBeGreaterThanOrEqual(1);
    expect(stats.promoted).toBe(1);
  });

  it("scraped evidence spends even when the budget is exhausted", async () => {
    // jd123@ infers no pattern, so the domain stays unknown; with a zero budget the
    // domain is pattern_unknown from the start, but scraped evidence still gets its credit.
    await prepare([
      ["Jane", "Doe", { email: `jd123@${DOMAIN}` }],
      ["Bob", "Reyes", {}],
    ]);
    const verifier = new MapVerifier({ [`jd123@${DOMAIN}`]: "valid" });
    const stats = await runResolution(db(), verifier, { domainBudget: 0, checker: passChecker });
    expect(stats.pattern_unknown_domains).toBe(1);
    expect(verifier.calls).toEqual([`jd123@${DOMAIN}`]);
    expect(stats.credits_spent).toBe(1);
    expect(stats.promoted).toBe(1);
  });
});

describe("checkpoint durability", () => {
  it("checkpoint is called once per domain", async () => {
    await makeFirm([["Jane", "Doe", {}]], { key: "crd:940010", domain: "alpha.veloqua.example" });
    await makeFirm([["Bob", "Reyes", {}]], { key: "crd:940011", domain: "beta.veloqua.example" });
    await buildCandidates(db());
    await queueCandidates(db());
    const calls: Array<string | null> = [];
    const stats = await runResolution(db(), new MapVerifier({}), {
      checker: passChecker,
      checkpoint: (d) => void calls.push(d),
    });
    expect(stats.domains_processed).toBe(2);
    expect(stats.promoted).toBe(0);
    expect(calls).toEqual(["alpha.veloqua.example", "beta.veloqua.example"]);
  });
});

describe("stranded promotion repair", () => {
  it("a fresh run promotes a previously stranded verified candidate", async () => {
    const { people: made } = await makeFirm([["Jane", "Doe", {}]]);
    const jane = made[0] as Person;
    const strandedEmail = `jane.doe@${DOMAIN}`;
    const [candidate] = await db()
      .insert(contactCandidates)
      .values({
        personId: jane.id,
        email: strandedEmail,
        domain: DOMAIN,
        evidence: "guessed_pattern",
        pattern: "{first}.{last}",
        rank: 0,
        sourceRef: "pattern:{first}.{last}",
        state: "verified",
      })
      .returning();
    const candidateId = (candidate as ContactCandidate).id;
    await db()
      .insert(verifications)
      .values({
        contactCandidateId: candidateId,
        email: strandedEmail,
        verifier: "millionverifier",
        result: "valid",
        raw: { authoritative: true },
      });

    const stats = await runResolution(db(), new MapVerifier({}), { checker: passChecker });
    expect(stats.stranded_repaired).toBe(1);
    const [after] = await db()
      .select()
      .from(contactCandidates)
      .where(eq(contactCandidates.id, candidateId));
    expect(after?.leadId).not.toBeNull();
    const [lead] = await db()
      .select()
      .from(leads)
      .where(eq(leads.id, after?.leadId as number));
    expect(lead?.email).toBe(strandedEmail);
    expect(lead?.status).toBe("verified");
    const [row] = await db()
      .select()
      .from(verifications)
      .where(eq(verifications.contactCandidateId, candidateId));
    expect(row?.leadId).toBe(lead?.id);
    // Idempotent: a second fresh run finds nothing left to repair.
    expect(
      (await runResolution(db(), new MapVerifier({}), { checker: passChecker })).stranded_repaired,
    ).toBe(0);
  });
});
