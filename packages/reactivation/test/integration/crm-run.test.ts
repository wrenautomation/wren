/**
 * `CrmRun` over a real Restate: `crm run` on the worker. Each call is one bounded round, its
 * model and sites made for the client it names (so its own keys apply), its ledger in the
 * client's database. Synthetic data only, no network.
 */
import * as ingress from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { FakeVerifier, type LocalCheckerLike } from "@wren/channel-email";
import { ingressOf } from "@wren/config";
import { clients } from "@wren/core/clients";
import type { SiteClient } from "@wren/core/content";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm, type LlmClient } from "@wren/llm";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CRM_FORMATS } from "../../src/crm/formats.js";
import { runCrmImport } from "../../src/crm/import.js";
import { CrmCsvSource } from "../../src/crm/source.js";
import { type CrmRunObject, makeCrmRun } from "../../src/crm-run.js";

const CSV = [
  "ID,Name,Email,Company,Website",
  "1,Jane Doe,jane@acmestaffing.example,Acme Staffing,https://acmestaffing.example",
  "2,Bob Roe,bob@acmestaffing.example,Acme Staffing,https://acmestaffing.example",
].join("\n");
const checker: LocalCheckerLike = {
  async check(email) {
    return { email, failure: null, flags: [], mxHosts: ["mx"], mxPath: "mx", passed: true };
  },
};

/** Who each factory was asked for, and the site calls made on the client's sites. */
const askedSites: string[] = [];
const askedLlm: string[] = [];
const calls: string[] = [];
const sitesFor = (client: string): SiteClient => {
  askedSites.push(client);
  return {
    async call(site, method, path, input = {}) {
      calls.push(`${client} ${site} ${method} ${path}`);
      return {
        query: String((input as { q?: string }).q),
        ...(path === "/people"
          ? { people: [], via: "exa" }
          : { hits: [], via: "ddg", tried: ["ddg"] }),
      } as never;
    },
    async via() {
      return "api";
    },
  };
};
const llm = new FakeLlm({ respond: () => JSON.stringify({ sentences: [] }) });

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [
      makeCrmRun({
        main: pg.db,
        open: () => pg.db,
        crm: {
          verifier: new FakeVerifier({ authoritative: true }),
          checker,
          fetcher: null,
          llm,
        },
        clientLlm: (client, base: LlmClient) => {
          askedLlm.push(client);
          return base;
        },
        clientSites: sitesFor,
      }),
    ],
    alwaysReplay: true,
  });
  await pg.db
    .insert(clients)
    .values({ id: "acme", name: "Acme Talent", database: "wren_client_acme", products: {} });
}, 120_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  askedSites.length = 0;
  askedLlm.length = 0;
  calls.length = 0;
  await truncate(pg.db, [
    "person_lookups",
    "findings",
    "runs",
    "verifications",
    "contact_candidates",
    "crm_contacts",
    "sightings",
    "import_errors",
    "people",
    "companies",
    "imports",
  ]);
  const f = CRM_FORMATS.get("crm-generic");
  if (!f) throw new Error("crm-generic");
  await runCrmImport(pg.db, new CrmCsvSource(f, "export.csv", new TextEncoder().encode(CSV)));
});

const connect = () => ingress.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
const crmRun = (key: string) => connect().objectClient<CrmRunObject>({ name: "CrmRun" }, key);

describe("CrmRun", () => {
  it("runs the asked stages on the client's own model and sites, one bounded round", async () => {
    const r = await crmRun("acme").run({ only: ["verify", "lookup"], limit: 1 });
    expect(r.client).toBe("acme");
    expect(r.stages.map((s) => s.stage)).toEqual(["verify", "lookup"]);
    // One unit a stage: one address checked, one person looked up.
    expect(r.stages[0]?.stats).toMatchObject({ selected: 1 });
    expect(r.stages[1]?.stats).toMatchObject({ selected: 1 });
    expect(new Set(askedSites)).toEqual(new Set(["acme"]));
    expect(new Set(askedLlm)).toEqual(new Set(["acme"]));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.startsWith("acme web "))).toBe(true);
    const [run] = await pg.db.execute(sql`select command from runs where id = ${r.run}`);
    expect(run).toEqual({ command: "crm run" });
  });

  it("refuses a client that isn't there, and a round past the cap", async () => {
    await expect(crmRun("nobody").run({ only: ["verify"] })).rejects.toThrow(/no such client/);
    await expect(crmRun("acme").run({ limit: 500 })).rejects.toThrow();
    expect(askedSites).toEqual([]);
  });
});
