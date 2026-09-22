/** The Resolution virtual object: build → queue → resolve on a stub verifier, journaled per domain. */
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { type Company, companies, imports, leads, people, runs } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { domainKnowledge } from "../../src/resolution/service.js";
import { makeResolution, RESOLUTION_KEY, type Resolution } from "../../src/restate/resolution.js";
import { contactCandidates, type VerificationResult } from "../../src/schema.js";
import type { LocalCheck, LocalCheckerLike } from "../../src/verification/local.js";
import type { EmailVerifier, Verdict } from "../../src/verification/verifier.js";

const DOMAIN = "veloqua.example";
class MapVerifier implements EmailVerifier {
  readonly name = "map";
  readonly authoritative = true;
  readonly costsCredits = true;
  readonly calls: string[] = [];
  verdicts: Record<string, VerificationResult> = {};
  down = false;
  async verify(email: string): Promise<Verdict> {
    if (this.down) throw new Error("prober unreachable");
    this.calls.push(email);
    return { result: this.verdicts[email] ?? "invalid", raw: { stub: true } };
  }
}
const passChecker: LocalCheckerLike = {
  async check(email): Promise<LocalCheck> {
    return { email, failure: null, flags: [], mxHosts: ["mx"], mxPath: "mx", passed: true };
  },
};

let pg: TestPostgres;
let env: RestateTestEnvironment;
const verifier = new MapVerifier();
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await RestateTestEnvironment.start({
    services: [makeResolution({ db: pg.db, verifier, checker: passChecker })],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, ["runs", "imports", "companies", "suppressions", "leads"]);
  verifier.calls.length = 0;
  verifier.verdicts = {};
  verifier.down = false;
});
const db = () => pg.db;
const client = () =>
  clients
    .connect({ url: env.baseUrl() })
    .objectClient<Resolution>({ name: "Resolution" }, RESOLUTION_KEY);

async function makeFirm(names: [string, string][], domain = DOMAIN): Promise<Company> {
  const [company] = await db()
    .insert(companies)
    .values({ sourceKey: `crd:${domain}`, domain, name: "Veloqua Advisors", raw: {} })
    .returning();
  for (const [i, [first, last]] of names.entries()) {
    await db()
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
        raw: {},
      });
  }
  return company as Company;
}

describe("Resolution virtual object", () => {
  it("build → queue → resolve proves the pattern and promotes leads", async () => {
    await makeFirm([
      ["Jane", "Doe"],
      ["Bob", "Reyes"],
    ]);
    verifier.verdicts = {
      [`jane.doe@${DOMAIN}`]: "invalid",
      [`jdoe@${DOMAIN}`]: "valid",
      [`breyes@${DOMAIN}`]: "valid",
    };
    const c = client();
    expect((await c.build({})).people_seen).toBe(2);
    expect((await c.queue({})).people_queued).toBe(2);
    const stats = await c.resolve({});
    expect(stats.patterns_proven).toBe(1);
    expect(stats.promoted).toBe(2);
    expect(stats.credits_spent).toBe(3);
    expect(stats.aborted).toBeNull();
    expect((await domainKnowledge(db(), DOMAIN)).provenPattern).toBe("{f}{last}");
    const rows = await db()
      .select()
      .from(leads)
      .where(inArray(leads.email, [`jdoe@${DOMAIN}`, `breyes@${DOMAIN}`]));
    expect(rows.map((l) => l.status)).toEqual(["verified", "verified"]);

    const ledger = await db().select().from(runs).orderBy(runs.startedAt);
    expect(ledger.map((r) => [r.command, r.model])).toEqual([
      ["resolve build", "map"],
      ["resolve queue", "map"],
      ["resolve run", "map"],
    ]);
    expect((ledger[2]?.stats as { promoted: number } | undefined)?.promoted).toBe(2);

    // Nothing left to buy.
    expect((await c.resolve({})).credits_spent).toBe(0);
  });

  it("creditLimit caps spend across domains and records the abort", async () => {
    await makeFirm([["Jane", "Doe"]], "alpha.veloqua.example");
    await makeFirm([["Ann", "Lee"]], "beta.veloqua.example");
    const c = client();
    await c.build({});
    await c.queue({});
    const stats = await c.resolve({ creditLimit: 1 });
    expect(stats.credits_spent).toBe(1);
    expect(stats.aborted).toMatch(/credit/i);
    const queued = await db()
      .select({ domain: contactCandidates.domain })
      .from(contactCandidates)
      .where(eq(contactCandidates.state, "queued"));
    expect(queued.length).toBeGreaterThan(0);
  });

  describe("verifyLeads", () => {
    async function inboxLead(company: Company, email: string) {
      const [batch] = await db()
        .insert(imports)
        .values({ sourceType: "pick", sourceRef: "test", stats: {} })
        .returning();
      const [lead] = await db()
        .insert(leads)
        .values({
          email,
          raw: {},
          importId: (batch as { id: number }).id,
          status: "imported",
          companyId: company.id,
        })
        .returning();
      return lead as { id: number };
    }

    it("verifies a niche's imported leads and moves their status", async () => {
      const firm = await makeFirm([]);
      await db().update(companies).set({ niche: "agencies" }).where(eq(companies.id, firm.id));
      const ok = await inboxLead(firm, `info@${DOMAIN}`);
      const bad = await inboxLead(firm, `sales@${DOMAIN}`);
      verifier.verdicts = { [`info@${DOMAIN}`]: "catch_all", [`sales@${DOMAIN}`]: "invalid" };
      const stats = await client().verifyLeads({ niche: "agencies", limit: 10 });
      expect(stats).toMatchObject({ selected: 2, catch_all: 1, invalid: 1, aborted: null });
      const status = async (id: number) =>
        (await db().select().from(leads).where(eq(leads.id, id)))[0]?.status;
      expect(await status(ok.id)).toBe("imported");
      expect(await status(bad.id)).toBe("undeliverable");
      expect((await client().verifyLeads({ niche: "agencies" })).selected).toBe(0);
      expect((await client().verifyLeads({ niche: "sec_ria" })).selected).toBe(0);
      const ledger = await db().select().from(runs);
      expect(ledger.map((r) => r.command)).toEqual([
        "verify leads",
        "verify leads",
        "verify leads",
      ]);
    });

    it("a verifier that is down fails the pass instead of passing quietly", async () => {
      const firm = await makeFirm([]);
      await inboxLead(firm, `info@${DOMAIN}`);
      verifier.down = true;
      await expect(client().verifyLeads({})).rejects.toThrow(/prober unreachable/);
      const [run] = await db().select().from(runs);
      expect(run?.finishedAt).not.toBeNull();
    });
  });
});
