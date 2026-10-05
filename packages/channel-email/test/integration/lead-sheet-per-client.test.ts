/**
 * O1, the lead sheet per client (designs/2026-10-04-outbound-per-client.md): the
 * pool-feeder keys a client's chain `<client>/all` with the client's block, its
 * ledger in the client's database; verdicts and pages are shared through main; the
 * Pipeline reads come from the client's database once the component is installed.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf, loadSettings } from "@wren/config";
import { runs } from "@wren/core";
import { addClient } from "@wren/core/clients";
import type { PassOutcome } from "@wren/core/restate";
import { startTestRestate } from "@wren/core/testing";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sharedPages } from "@wren/research/enrichment";
import type { Fetcher } from "@wren/research/fetch";
import { documents } from "@wren/research/schema";
import { isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emailConsoleApi } from "../../src/restate/console.js";
import { type FeedStats, makePoolScheduler } from "../../src/restate/pool-scheduler.js";
import { verifications } from "../../src/schema.js";
import { SendPolicy } from "../../src/send/policy.js";
import { sharedVerdicts } from "../../src/verification/shared.js";
import { FakeVerifier } from "../../src/verification/verifier.js";
import { makeCompany } from "./compose-fixtures.js";

const POLICY = SendPolicy.fromSettings(
  loadSettings({ WREN_DATABASE_URL: "postgresql://x", WREN_SEND_TIMEZONE: "UTC" }),
);

/** Every stand-in call: which object key, which handler, what input. */
const calls: { key: string; stage: string; input: Record<string, unknown> }[] = [];
const stage =
  (name: string, answer: object = {}) =>
  async (ctx: restate.ObjectContext, input: Record<string, unknown> = {}) => {
    calls.push({ key: ctx.key, stage: name, input });
    return answer;
  };
const fakes = [
  restate.object({
    name: "Discovery",
    handlers: { discover: stage("discover"), verify: stage("verify") },
  }),
  restate.object({
    name: "Enrichment",
    handlers: {
      crawl: stage("crawl"),
      render: stage("render"),
      scan: stage("scan"),
      extract: stage("extract"),
      pick: stage("pick"),
      applyPicks: stage("applyPicks"),
      profiles: stage("profiles"),
    },
  }),
  restate.object({
    name: "Resolution",
    handlers: { resolveNewDomains: stage("resolveNewDomains"), verifyLeads: stage("verifyLeads") },
  }),
];

let pg: TestPostgres;
let env: RestateTestEnvironment;
let acme: Db;
const open = (c: { database: string }) => cachedDb(clientDatabaseUrl(pg.url, c.database));

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, {
    id: "acme",
    name: "Acme",
    products: {
      "research.lead_sheet": {
        crawlHints: ["our-team"],
        perPass: { crawl: 3 },
        verificationsPerDay: 0,
      },
    },
  });
  await addClient(pg.db, pg.url, { id: "beta", name: "Beta", products: {} });
  acme = open({ database: "wren_client_acme" });
  env = await startTestRestate({
    services: [
      ...fakes,
      makePoolScheduler({
        db: pg.db,
        clientDb: (id) => open({ database: `wren_client_${id}` }),
        policy: POLICY,
        modelStages: "none",
        freeVerifier: true,
        profiles: { ahead: () => 2, horizonDays: 45 },
        busyMs: 5_000,
      }),
    ],
    alwaysReplay: true,
  });
}, 180_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

const sync = (key: string) =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .objectClient<ReturnType<typeof makePoolScheduler>>({ name: "PoolScheduler" }, key)
    .sync() as Promise<PassOutcome<FeedStats>>;

describe("PoolScheduler per client", () => {
  it("walks the client's chain on its own keys, with its block, and keeps its ledger", async () => {
    calls.length = 0;
    const out = await sync("acme/all");
    expect(out.stopped).toBeUndefined();
    // Cap 0: no mail-server checks today; no profiles for a client.
    expect(calls.map((c) => c.stage)).toEqual([
      "discover",
      "verify",
      "crawl",
      "render",
      "scan",
      "pick",
      "applyPicks",
    ]);
    expect(new Set(calls.map((c) => c.key))).toEqual(new Set(["acme/all"]));
    expect(calls.find((c) => c.stage === "crawl")?.input).toEqual({
      limit: 3,
      extraHints: ["our-team"],
    });
    expect(calls.find((c) => c.stage === "discover")?.input).toEqual({ limit: 10 });
    expect((await acme.select().from(runs)).map((r) => r.command)).toEqual(["pool feed"]);
    expect(await pg.db.select().from(runs)).toEqual([]);
  });

  it("stops for a client without the lead sheet, or none at all", async () => {
    for (const [key, why] of [
      ["beta/all", "the lead sheet is not installed"],
      ["ghost/all", "no such client"],
    ]) {
      calls.length = 0;
      const out = await sync(key as string);
      expect(out.stopped).toBe(why);
      expect(calls).toEqual([]);
    }
  });
});

describe("shared on main", () => {
  it("a verdict is asked once, then read from main by any client", async () => {
    const inner = new FakeVerifier();
    let asked = 0;
    const counting = {
      ...inner,
      verify: (e: string) => {
        asked += 1;
        return inner.verify(e);
      },
    };
    const shared = sharedVerdicts(pg.db, counting);
    expect((await shared.verify("pat@shared.example")).result).toBe("valid");
    const again = await shared.verify("pat@shared.example");
    expect(asked).toBe(1);
    expect(again.raw.shared).toBe(true);
    const kept = await pg.db.select().from(verifications);
    expect(kept.map((v) => [v.email, v.leadId, v.contactCandidateId])).toEqual([
      ["pat@shared.example", null, null],
    ]);
  });

  it("a page is fetched once, kept on main with no company; robots.txt always goes out", async () => {
    const got: string[] = [];
    const net: Fetcher = {
      userAgent: "test",
      get: async (url) => {
        got.push(url);
        return { status: 200, url, text: "<html><title>Team</title><p>Pat Lee</p></html>" };
      },
    };
    const f = sharedPages(pg.db, net);
    await f.get("https://firm.example/team");
    const second = await f.get("https://firm.example/team");
    await f.get("https://firm.example/robots.txt");
    await f.get("https://firm.example/robots.txt");
    expect(second.text).toContain("Pat Lee");
    expect(got).toEqual([
      "https://firm.example/team",
      "https://firm.example/robots.txt",
      "https://firm.example/robots.txt",
    ]);
    const kept = await pg.db.select().from(documents).where(isNull(documents.companyId));
    expect(kept.map((d) => d.url)).toEqual(["https://firm.example/team"]);
  });
});

describe("the Pipeline app on a client's sheet", () => {
  const operator = { viewer: { email: "op@example.test", operator: true } };
  const api = () =>
    emailConsoleApi({ db: pg.db, senders: [], policy: POLICY, clients: { main: pg.db, open } });

  it("reads the client's own firms once installed, and refuses where it isn't", async () => {
    await makeCompany(acme, { domain: "acme-lead.example", name: "Acme Lead" });
    await makeCompany(pg.db, { domain: "wren-lead.example", name: "Wren Lead" });
    const page = await api().recordsList({ ...operator, client: "acme", record: "email.firm" });
    expect(page.rows.map((r) => r.domain)).toEqual(["acme-lead.example"]);
    await expect(api().recordsTypes({ ...operator, client: "beta" })).rejects.toMatchObject({
      status: 404,
    });
    // A login of another client never reads acme's sheet.
    await expect(
      api().recordsList({
        viewer: { email: "amy@beta.test" },
        client: "acme",
        record: "email.firm",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
