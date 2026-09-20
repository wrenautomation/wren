/** The Discovery virtual object on fakes: a domainless company gets its proven domain, once. */
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { companies, runs } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Discovery, makeDiscovery } from "../../src/restate/discovery.js";
import { FakeFetcher } from "./fixtures.js";

let pg: TestPostgres;
let env: RestateTestEnvironment;
const fetcher = new FakeFetcher({
  "https://zorbelwealth.com":
    "<html><head><title>Zorbel Wealth</title></head><body><p>Zorbel Wealth LLC — fiduciary advice</p></body></html>",
});

beforeAll(async () => {
  pg = await startTestPostgres();
  env = await RestateTestEnvironment.start({
    services: [
      makeDiscovery({
        db: pg.db,
        fetcher,
        genericWordsFor: () => new Set(["wealth", "advisors"]),
        resolves: async (d) => d === "zorbelwealth.com",
      }),
    ],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(() => truncate(pg.db, ["discovery_attempts", "imports", "companies", "runs"]));

const client = () =>
  clients.connect({ url: env.baseUrl() }).objectClient<Discovery>({ name: "Discovery" }, "sec_ria");

describe("Discovery", () => {
  it("attaches a gated domain, records the run, and finds nothing left on the next pass", async () => {
    const [company] = await pg.db
      .insert(companies)
      .values({ sourceKey: "crd:915001", name: "Zorbel Wealth LLC", niche: "sec_ria", raw: {} })
      .returning();
    const first = await client().discover({ limit: 10 });
    expect(first).toMatchObject({ companies_scanned: 1, domains_attached: 1 });
    const [after] = await pg.db
      .select()
      .from(companies)
      .where(eq(companies.id, company?.id as number));
    expect(after?.domain).toBe("zorbelwealth.com");
    const second = await client().discover({ limit: 10 });
    expect(second.companies_scanned).toBe(0);
    const ledger = await pg.db.select().from(runs);
    expect(ledger.map((r) => [r.command, r.niche, r.finishedAt !== null])).toEqual([
      ["discover run", "sec_ria", true],
      ["discover run", "sec_ria", true],
    ]);
  });

  it("verify stamps an asserted domain whose homepage names the company", async () => {
    await pg.db
      .insert(companies)
      .values({ domain: "zorbelwealth.com", name: "Zorbel Wealth LLC", niche: "sec_ria", raw: {} });
    const stats = await client().verify({});
    expect(stats).toMatchObject({ companies_scanned: 1, domains_verified: 1 });
  });
});
