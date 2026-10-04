/** The Resolution virtual object: build → queue → resolve on a stub verifier, journaled per domain. */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { type Company, companies, imports, leads, people, runs } from "@wren/core";
import { createDb } from "@wren/db";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { domainKnowledge } from "../../src/resolution/service.js";
import { makeResolution, RESOLUTION_KEY, type Resolution } from "../../src/restate/resolution.js";
import { contactCandidates, type VerificationResult, verifications } from "../../src/schema.js";
import type { LocalCheck, LocalCheckerLike } from "../../src/verification/local.js";
import type { EmailVerifier, Verdict } from "../../src/verification/verifier.js";

const DOMAIN = "veloqua.example";
class MapVerifier implements EmailVerifier {
  readonly name = "map";
  readonly authoritative = true;
  costsCredits = true;
  readonly calls: string[] = [];
  /** Most verify calls ever open at once. */
  peak = 0;
  /** Hold each call until this many have been open at once (2s cap): overlap no matter how slow the box. */
  expectOpen = 0;
  private open = 0;
  verdicts: Record<string, VerificationResult> = {};
  down = false;
  async verify(email: string): Promise<Verdict> {
    if (this.down) throw new Error("prober unreachable");
    this.calls.push(email);
    this.open += 1;
    this.peak = Math.max(this.peak, this.open);
    const deadline = Date.now() + 2_000;
    while (this.peak < this.expectOpen && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 20));
    this.open -= 1;
    return { result: this.verdicts[email] ?? "invalid", raw: { stub: true } };
  }
}
const passChecker: LocalCheckerLike = {
  async check(email): Promise<LocalCheck> {
    return { email, failure: null, flags: [], mxHosts: ["mx"], mxPath: "mx", passed: true };
  },
};

/** `resolve` refuses at ingress (paid credits), so the test reaches it as a service would. */
const inside = restate.service({
  name: "ResolveInside",
  handlers: {
    resolve: (ctx: restate.Context, input: { creditLimit?: number }) =>
      ctx.objectClient<Resolution>({ name: "Resolution" }, RESOLUTION_KEY).resolve(input),
  },
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
const verifier = new MapVerifier();
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await RestateTestEnvironment.start({
    services: [
      makeResolution({
        db: pg.db,
        verifier,
        checker: passChecker,
        openPool: (max) => createDb(pg.url, { max }),
      }),
      inside,
    ],
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
  verifier.costsCredits = true;
  verifier.peak = 0;
  verifier.expectOpen = 0;
});
const db = () => pg.db;
const client = () => {
  const ingress = clients.connect({ url: env.baseUrl() });
  const object = ingress.objectClient<Resolution>({ name: "Resolution" }, RESOLUTION_KEY);
  const via = ingress.serviceClient<typeof inside>({ name: "ResolveInside" });
  return {
    build: object.build,
    queue: object.queue,
    resolveNewDomains: object.resolveNewDomains,
    verifyLeads: object.verifyLeads,
    resolve: via.resolve,
    refused: object.resolve,
  };
};

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
    // Never by hand: the ingress refuses it.
    await expect(c.refused({})).rejects.toThrow();
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

  describe("resolveNewDomains", () => {
    const firms = async (n: number) => {
      for (let i = 0; i < n; i += 1) {
        const f = await makeFirm([["Jane", "Doe"]], `f${i}.veloqua.example`);
        await db().update(companies).set({ niche: "sec_ria" }).where(eq(companies.id, f.id));
      }
    };

    it("walks new domains many at once, promotes, and never walks a domain twice", async () => {
      verifier.costsCredits = false;
      verifier.expectOpen = 3;
      await firms(6);
      const other = await makeFirm([["Ann", "Lee"]], "agency.example");
      await db().update(companies).set({ niche: "agencies" }).where(eq(companies.id, other.id));
      for (let i = 0; i < 6; i += 1) verifier.verdicts[`jane.doe@f${i}.veloqua.example`] = "valid";
      const c = client();
      await c.build({});
      await c.queue({});
      const stats = await c.resolveNewDomains({
        niche: "sec_ria",
        limitDomains: 5,
        concurrency: 3,
      });
      expect(stats).toMatchObject({ domains_processed: 5, promoted: 5, aborted: null });
      expect(verifier.peak).toBe(3);
      expect(verifier.calls.some((e) => e.endsWith("@agency.example"))).toBe(false);
      const rest = await c.resolveNewDomains({ niche: "sec_ria", limitDomains: 5, concurrency: 3 });
      expect(rest.domains_processed).toBe(1);
      expect(
        (await c.resolveNewDomains({ niche: "sec_ria", limitDomains: 5 })).domains_processed,
      ).toBe(0);
      const promoted = await db().select().from(leads).where(eq(leads.status, "verified"));
      expect(promoted).toHaveLength(6);
    });

    it("someone added after a walk gets one probe on the proven pattern; an unproven domain stays out", async () => {
      verifier.costsCredits = false;
      await firms(2);
      verifier.verdicts["jane.doe@f0.veloqua.example"] = "valid"; // f1: every guess invalid
      const c = client();
      await c.build({});
      await c.queue({});
      await c.resolveNewDomains({ niche: "sec_ria", limitDomains: 5 });
      for (const domain of ["f0.veloqua.example", "f1.veloqua.example"]) {
        const [firm] = await db().select().from(companies).where(eq(companies.domain, domain));
        await db()
          .insert(people)
          .values({
            companyId: (firm as Company).id,
            fullName: "Bob Reyes",
            firstName: "Bob",
            lastName: "Reyes",
            title: "Recruiter",
            isCompliance: false,
            origin: "registry",
            originRef: "test",
            raw: {},
          });
      }
      verifier.verdicts["bob.reyes@f0.veloqua.example"] = "valid";
      await c.build({});
      await c.queue({});
      verifier.calls.length = 0;
      const later = await c.resolveNewDomains({ niche: "sec_ria", limitDomains: 5 });
      expect(later).toMatchObject({ domains_processed: 1, promoted: 1 });
      expect(verifier.calls).toEqual(["bob.reyes@f0.veloqua.example"]);
      expect(
        (await c.resolveNewDomains({ niche: "sec_ria", limitDomains: 5 })).domains_processed,
      ).toBe(0);
    });

    it("a risky verdict stops the walk, costs no budget, and is retried after two days", async () => {
      verifier.costsCredits = false;
      await firms(1);
      const c = client();
      await c.build({});
      await c.queue({});
      const [first] = await db()
        .select()
        .from(contactCandidates)
        .orderBy(contactCandidates.id)
        .limit(1);
      if (!first) throw new Error("no candidate built");
      verifier.verdicts[first.email] = "risky";
      const stats = await c.resolveNewDomains({ niche: "sec_ria", limitDomains: 5 });
      expect(stats).toMatchObject({ domains_processed: 1, deferred_domains: 1, promoted: 0 });
      expect(verifier.calls).toHaveLength(1);
      expect((await domainKnowledge(db(), "f0.veloqua.example")).creditsSpent).toBe(0);
      expect(
        (await c.resolveNewDomains({ niche: "sec_ria", limitDomains: 5 })).domains_processed,
      ).toBe(0);
      await db()
        .update(verifications)
        .set({ checkedAt: new Date(Date.now() - 3 * 86_400_000) });
      verifier.verdicts[first.email] = "valid";
      const retry = await c.resolveNewDomains({ niche: "sec_ria", limitDomains: 5 });
      expect(retry).toMatchObject({ domains_processed: 1, promoted: 1 });
    });

    it("skips a domain a lead's verdict already showed catch-all", async () => {
      verifier.costsCredits = false;
      await firms(2);
      const c = client();
      await c.build({});
      await c.queue({});
      const [f0] = await db()
        .select()
        .from(companies)
        .where(eq(companies.domain, "f0.veloqua.example"));
      const lead = await inboxLead(f0 as Company, "info@f0.veloqua.example");
      await db()
        .insert(verifications)
        .values({
          leadId: lead.id,
          verifier: "smtp",
          result: "catch_all",
          raw: { authoritative: true },
          email: "info@f0.veloqua.example",
        });
      const stats = await c.resolveNewDomains({ niche: "sec_ria", limitDomains: 5 });
      expect(stats.domains_processed).toBe(1);
      expect(verifier.calls.every((e) => e.endsWith("@f1.veloqua.example"))).toBe(true);
    });

    it("waits for a walk already running instead of walking beside it", async () => {
      verifier.costsCredits = false;
      await firms(2);
      await client().build({});
      await client().queue({});
      let release = () => {};
      let locked = () => {};
      const isLocked = new Promise<void>((r) => {
        locked = r;
      });
      const held = pg.db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext('resolution: new-domain walk'))`,
        );
        locked();
        await new Promise<void>((r) => {
          release = r;
        });
      });
      await isLocked;
      const walk = client().resolveNewDomains({ niche: "sec_ria", limitDomains: 5 });
      await new Promise((r) => setTimeout(r, 1_000));
      expect(verifier.calls).toHaveLength(0);
      release();
      await held;
      expect((await walk).domains_processed).toBe(2);
    });

    it("refuses a paid verifier: it would spend without a limit", async () => {
      await expect(client().resolveNewDomains({ limitDomains: 5 })).rejects.toThrow(
        /free verifiers/,
      );
    });

    it("a verifier that is down fails the pass", async () => {
      verifier.costsCredits = false;
      verifier.down = true;
      await firms(2);
      await client().build({});
      await client().queue({});
      await expect(client().resolveNewDomains({ limitDomains: 5, concurrency: 2 })).rejects.toThrow(
        /prober unreachable/,
      );
    });
  });

  describe("verifyLeads", () => {
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

    it("checks many leads at once with a free verifier, one at a time with a paid one", async () => {
      const firm = await makeFirm([]);
      for (const box of ["info", "sales", "hello", "team"])
        await inboxLead(firm, `${box}@${DOMAIN}`);
      await client().verifyLeads({ concurrency: 4 });
      expect(verifier.peak).toBe(1);
      verifier.costsCredits = false;
      await client().verifyLeads({ concurrency: 4 }); // invalid verdicts: nothing left
      for (const box of ["a", "b", "c", "d"]) await inboxLead(firm, `${box}@${DOMAIN}`);
      verifier.expectOpen = 4;
      const stats = await client().verifyLeads({ concurrency: 4 });
      expect(stats.invalid).toBe(4);
      expect(verifier.peak).toBe(4);
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
