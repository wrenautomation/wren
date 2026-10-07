/**
 * Per-client runs, group A (designs/2026-10-07-per-client-runs.md): a client's pool reads
 * YouTube and Instagram with `research.social` and runs the signal collectors with
 * `research.signals`, on its own firms; its buckets count main's reads too; the firm page shows
 * the dossier from its own database with `research.dossier`. Synthetic firms only.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf, loadSettings } from "@wren/config";
import { addClient } from "@wren/core/clients";
import type { PassOutcome } from "@wren/core/restate";
import { startTestRestate } from "@wren/core/testing";
import { cachedDb, clientDatabaseUrl, type Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { youtubeRoom } from "@wren/research/enrichment";
import { findings } from "@wren/research/schema";
import {
  COLLECTORS,
  collectorRoom,
  queuedFirms,
  signalPlan,
  signalSettingsOf,
} from "@wren/research/signals";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emailConsoleApi } from "../../src/restate/console.js";
import { type FeedStats, makePoolScheduler } from "../../src/restate/pool-scheduler.js";
import { SendPolicy } from "../../src/send/policy.js";
import { makeCompany, makeRoleLead } from "./compose-fixtures.js";

const POLICY = SendPolicy.fromSettings(
  loadSettings({ WREN_DATABASE_URL: "postgresql://x", WREN_SEND_TIMEZONE: "UTC" }),
);

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
    handlers: Object.fromEntries(
      [
        "crawl",
        "render",
        "scan",
        "contacts",
        "extract",
        "pick",
        "applyPicks",
        "profiles",
        "youtube",
        "instagram",
        "signals",
      ].map((n) => [n, stage(n)]),
    ),
  }),
  restate.object({
    name: "Resolution",
    handlers: { resolveNewDomains: stage("resolveNewDomains"), verifyLeads: stage("verifyLeads") },
  }),
];

let pg: TestPostgres;
let env: RestateTestEnvironment;
let gamma: Db;
const open = (c: { database: string }) => cachedDb(clientDatabaseUrl(pg.url, c.database));
const SHEET = { "research.lead_sheet": { verificationsPerDay: 0 } };

beforeAll(async () => {
  pg = await startTestPostgres();
  await addClient(pg.db, pg.url, {
    id: "gamma",
    name: "Gamma",
    products: {
      ...SHEET,
      "research.social": { instagram: false },
      "research.signals": {},
      "research.dossier": {},
    },
  });
  await addClient(pg.db, pg.url, { id: "delta", name: "Delta", products: SHEET });
  gamma = open({ database: "wren_client_gamma" });
  env = await startTestRestate({
    services: [
      ...fakes,
      makePoolScheduler({
        db: pg.db,
        clientDb: (id) => open({ database: `wren_client_${id}` }),
        policy: POLICY,
        modelStages: "none",
        freeVerifier: true,
        youtube: true,
        instagram: true,
        signals: { ahead: () => 2, horizonDays: 45 },
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

describe("a client's pool with social reads and signals", () => {
  it("reads the networks its block has on and runs signals on its own firms", async () => {
    const firm = await makeCompany(gamma, { domain: "gamma-firm.example", name: "Gamma Firm" });
    await makeRoleLead(gamma, firm, "info@gamma-firm.example");
    await makeCompany(gamma, { domain: "no-lead.example", name: "No Lead" });
    calls.length = 0;
    const out = await sync("gamma/all");
    expect(out.stopped).toBeUndefined();
    const ran = calls.map((c) => c.stage);
    expect(ran).toContain("youtube");
    expect(ran).not.toContain("instagram");
    expect(new Set(calls.map((c) => c.key))).toEqual(new Set(["gamma/all"]));
    expect(calls.find((c) => c.stage === "signals")?.input).toMatchObject({
      personIds: [],
      companyIds: [firm.id],
    });
  });

  it("runs neither for a client without them installed", async () => {
    calls.length = 0;
    await sync("delta/all");
    const ran = calls.map((c) => c.stage);
    for (const s of ["youtube", "instagram", "signals"]) expect(ran).not.toContain(s);
  });
});

describe("shared buckets", () => {
  it("a client's room counts main's reads; main's own room doesn't count the client's", async () => {
    const now = new Date("2026-10-06T12:00:00Z");
    const bucket = { perDay: 24, burst: 3 };
    const firm = await makeCompany(pg.db, { domain: "main-firm.example" });
    for (const i of [1, 2])
      await pg.db.insert(findings).values({
        kind: "profile",
        companyId: firm.id,
        factKey: `c${firm.id}:youtube:${i}`,
        value: { raw: {} },
        confidence: 1,
        via: "youtube",
        observedAt: new Date(now.getTime() - i * 1000),
      });
    expect((await youtubeRoom(gamma, now, bucket)).room).toBe(3);
    expect((await youtubeRoom(gamma, now, bucket, pg.db)).room).toBe(1);
    const news = { name: "news", bucket };
    expect((await collectorRoom(gamma, news, now, pg.db)).room).toBe(3);
  });

  it("queues a client's firms with a lead, least recently checked first", async () => {
    const ids = await queuedFirms(gamma, 10);
    expect(ids.length).toBe(1);
  });

  it("keeps metered collectors (they spend) off a client's pass", async () => {
    const plan = await signalPlan(
      gamma,
      COLLECTORS,
      signalSettingsOf({}),
      { niche: null, personIds: [], companyIds: await queuedFirms(gamma, 10) },
      { now: new Date(), free: true, also: pg.db },
    );
    const metered = new Set(COLLECTORS.filter((c) => c.metered && c.built).map((c) => c.name));
    expect(metered.size).toBeGreaterThan(0);
    for (const p of plan)
      if (metered.has(p.name))
        expect(p).toMatchObject({ subjects: [], why: "metered: Wren's only" });
  });
});

describe("the dossier on a client's firm page", () => {
  const operator = { viewer: { email: "op@example.test", operator: true } };
  const api = () =>
    emailConsoleApi({ db: pg.db, senders: [], policy: POLICY, clients: { main: pg.db, open } });

  it("reads the client's own firm once installed, and refuses where it isn't", async () => {
    const firm = await makeCompany(gamma, { domain: "brief.example", name: "Brief Firm" });
    await gamma.insert(findings).values({
      kind: "profile",
      companyId: firm.id,
      factKey: `c${firm.id}:youtube:channel`,
      value: { raw: {}, channel: "Brief Firm TV" },
      confidence: 1,
      via: "youtube",
      sourceUrl: "https://video.example/brief",
    });
    const brief = await api().dossier({ ...operator, client: "gamma", id: firm.id });
    expect(brief.facts).toEqual([
      expect.objectContaining({
        what: "profile",
        via: "youtube",
        source: "https://video.example/brief",
      }),
    ]);
    await expect(
      api().dossier({ ...operator, client: "delta", id: firm.id }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      api().dossier({ viewer: { email: "amy@delta.test" }, client: "gamma", id: firm.id }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
