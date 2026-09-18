/** Discovery service: attach + evidence sighting + verified stamp, claim protection, firm_facts guarantee. */
import { companies, sightings } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type HomepageFetcher,
  runDomainDiscovery,
  runDomainVerification,
} from "../../src/discovery/service.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["imports", "companies"]));
const db = () => pg.db;

const GENERIC = new Set(["wealth", "advisors"]);
const stubFetch =
  (pages: Record<string, [title: string, text: string]>): HomepageFetcher =>
  async (domain) => {
    const page = pages[domain];
    return page ? { url: `https://${domain}`, title: page[0], text: page[1] } : null;
  };
const companyById = async (id: number) =>
  (await db().select().from(companies).where(eq(companies.id, id)))[0];

describe("discovery", () => {
  it("attaches a gated domain with evidence", async () => {
    const [company] = await db()
      .insert(companies)
      .values({ sourceKey: "crd:915001", name: "Zorbel Wealth LLC", raw: {} })
      .returning();
    const id = company?.id as number;
    const { stats } = await runDomainDiscovery(db(), {
      genericWords: GENERIC,
      resolves: async (d) => d === "zorbelwealth.com",
      fetchHomepage: stubFetch({
        "zorbelwealth.com": ["Zorbel Wealth", "Zorbel Wealth LLC — fiduciary advice"],
      }),
    });
    expect(stats.domains_attached).toBe(1);
    const after = await companyById(id);
    expect(after?.domain).toBe("zorbelwealth.com");
    expect(after?.domainVerifiedAt).not.toBeNull();
    const [sighting] = await db().select().from(sightings).where(eq(sightings.companyId, id));
    const raw = sighting?.raw as {
      discovered_domain: string;
      evidence: { matched_tokens: string[] };
    };
    expect(raw.discovered_domain).toBe("zorbelwealth.com");
    expect(raw.evidence.matched_tokens).toContain("zorbel");
  });

  it("never steals a claimed domain", async () => {
    await db()
      .insert(companies)
      .values({ domain: "zorbelwealth.com", name: "Original Owner", raw: {} });
    const [orphan] = await db()
      .insert(companies)
      .values({ sourceKey: "crd:915002", name: "Zorbel Wealth LLC", raw: {} })
      .returning();
    const { stats } = await runDomainDiscovery(db(), {
      genericWords: GENERIC,
      resolves: async () => true,
      fetchHomepage: stubFetch({}),
    });
    expect((await companyById(orphan?.id as number))?.domain).toBeNull();
    expect(stats.already_claimed).toBeGreaterThanOrEqual(1);
  });

  it("gate rejection leaves the company untouched", async () => {
    const [company] = await db()
      .insert(companies)
      .values({ sourceKey: "crd:915003", name: "Zorbel Wealth LLC", raw: {} })
      .returning();
    const { stats } = await runDomainDiscovery(db(), {
      genericWords: GENERIC,
      resolves: async () => true,
      fetchHomepage: stubFetch({ "zorbelwealth.com": ["Parked", "Buy this domain today"] }),
    });
    expect((await companyById(company?.id as number))?.domain).toBeNull();
    expect(stats.gate_rejections).toBeGreaterThanOrEqual(1);
  });

  it("verification stamps an asserted domain", async () => {
    const [company] = await db()
      .insert(companies)
      .values({
        sourceKey: "crd:915004",
        domain: "zorbelriver.com",
        name: "Zorbel River Advisors",
        raw: {},
      })
      .returning();
    const { stats } = await runDomainVerification(db(), {
      genericWords: GENERIC,
      fetchHomepage: stubFetch({
        "zorbelriver.com": ["Zorbel River Advisors", "Zorbel River Advisors, CRD 915004"],
      }),
    });
    expect(stats.domains_verified).toBe(1);
    expect((await companyById(company?.id as number))?.domainVerifiedAt).not.toBeNull();
  });

  it("verification lists the unverified", async () => {
    await db()
      .insert(companies)
      .values({ sourceKey: "crd:915006", domain: "zorbelgone.com", name: "Zorbel Gone", raw: {} });
    const { stats } = await runDomainVerification(db(), {
      genericWords: GENERIC,
      fetchHomepage: stubFetch({}),
    });
    expect(stats).toMatchObject({
      fetch_misses: 1,
      unverified_preview: ["zorbelgone.com: unreachable"],
    });
  });

  it("discovery sighting never shadows firm_facts", async () => {
    // A company with roster-style facts in raw appears in firm_facts...
    await db()
      .insert(companies)
      .values({
        sourceKey: "crd:915005",
        name: "Zorbel Peak Wealth",
        raw: { "5F(2)(c)": "500000000", "5D(a)(1)": "10" },
      });
    const facts = async () =>
      (
        await db().execute<{ aum_usd: string | number; segment: string }>(
          sql`SELECT aum_usd, segment FROM firm_facts WHERE source_key = 'crd:915005'`,
        )
      )[0];
    expect(Number((await facts())?.aum_usd)).toBe(500000000);
    await runDomainDiscovery(db(), {
      genericWords: GENERIC,
      resolves: async (d) => d === "zorbelpeakwealth.com",
      fetchHomepage: stubFetch({
        "zorbelpeakwealth.com": ["Zorbel Peak Wealth", "Zorbel Peak Wealth home"],
      }),
    });
    // The discovery evidence sighting is newest but carries no facts; the view must keep reading the fact-bearing raw.
    const after = await facts();
    expect(Number(after?.aum_usd)).toBe(500000000);
    expect(after?.segment).toBe("individual");
  });
});
