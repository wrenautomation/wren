/**
 * The pool-feeder over stand-in Discovery/Enrichment objects: stage order, the
 * spend gate, progress → short delay, idle → next day, a refusing stage → retry.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { loadSettings } from "@wren/config";
import { runs } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LoopStatus, PassOutcome } from "../../src/restate/loop.js";
import { type FeedStats, makePoolScheduler } from "../../src/restate/pool-scheduler.js";
import { SendPolicy } from "../../src/send/policy.js";

const POLICY = SendPolicy.fromSettings(
  loadSettings({ WREN_DATABASE_URL: "postgresql://x", WREN_SEND_TIMEZONE: "UTC" }),
);

/** What each stand-in stage answers next; the test moves the pool by hand. */
const answers = {
  discover: { companies_scanned: 0 },
  crawl: { companies_crawled: 0, homepage_unreachable: 0, robots_blocked: 0 },
  pick: { picked: 0 },
  crawlRefuses: false,
};
const called: string[] = [];
const stage =
  (name: string, answer: () => object) =>
  async (_ctx: restate.ObjectContext, _input: unknown = {}) => {
    called.push(name);
    return answer();
  };
const fakeDiscovery = restate.object({
  name: "Discovery",
  handlers: {
    discover: stage("discover", () => answers.discover),
    verify: stage("verify", () => ({ companies_scanned: 0 })),
  },
});
const fakeEnrichment = restate.object({
  name: "Enrichment",
  handlers: {
    crawl: stage("crawl", () => {
      if (answers.crawlRefuses) throw new restate.TerminalError("WREN_FETCH_CONTACT is not set");
      return answers.crawl;
    }),
    render: stage("render", () => ({ companies_rendered: 0 })),
    scan: stage("scan", () => ({ scanned: 0 })),
    extract: stage("extract", () => ({ extracted: 0 })),
    pick: stage("pick", () => answers.pick),
    applyPicks: stage("applyPicks", () => ({ picks_applied: 0 })),
  },
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await RestateTestEnvironment.start({
    services: [
      fakeDiscovery,
      fakeEnrichment,
      makePoolScheduler({ db: pg.db, policy: POLICY, modelStages: "none", busyMs: 5_000 }),
    ],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, ["runs"]);
  called.length = 0;
  answers.discover = { companies_scanned: 0 };
  answers.crawl = { companies_crawled: 0, homepage_unreachable: 0, robots_blocked: 0 };
  answers.crawlRefuses = false;
});

type Pool = ReturnType<typeof makePoolScheduler>;
const client = (key = "sec_ria") =>
  clients.connect({ url: env.baseUrl() }).objectClient<Pool>({ name: "PoolScheduler" }, key);
const sync = (key?: string) => client(key).sync() as Promise<PassOutcome<FeedStats>>;

describe("PoolScheduler", () => {
  it("walks the free stages in order, skips model stages, and sleeps a day when idle", async () => {
    const out = await sync();
    expect(called).toEqual(["discover", "verify", "crawl", "render", "scan"]);
    expect(out.stats?.stages.map((s) => [s.stage, s.skipped])).toEqual([
      ["discover", false],
      ["verify", false],
      ["crawl", false],
      ["render", false],
      ["scan", false],
      ["extract", true],
      ["pick", true],
      ["applyPicks", true],
    ]);
    expect(out.stats?.progress).toBe(0);
    expect(out.delayMs).toBe(new Date("2026-09-21T00:00:00Z").getTime() - Date.parse(out.now));
    const ledger = await pg.db.select().from(runs);
    expect(ledger.map((r) => [r.command, r.niche, r.finishedAt !== null])).toEqual([
      ["pool feed", "sec_ria", true],
    ]);
  });

  it("comes back in a minute while a stage still finds work", async () => {
    answers.crawl = { companies_crawled: 7, homepage_unreachable: 3, robots_blocked: 0 };
    const out = await sync();
    expect(out.stats?.progress).toBe(10);
    expect(out.delayMs).toBe(5_000);
  });

  it("records a refusing stage, keeps walking, and retries later", async () => {
    answers.crawlRefuses = true;
    answers.discover = { companies_scanned: 25 };
    const out = await sync();
    const crawl = out.stats?.stages.find((s) => s.stage === "crawl");
    expect(crawl?.error).toMatch(/WREN_FETCH_CONTACT/);
    expect(called).toEqual(["discover", "verify", "crawl", "render", "scan"]);
    expect(out.stats).toMatchObject({ failed: 1, progress: 25 });
    expect(out.delayMs).toBe(60 * 60_000);
    const status = (await client().status()) as LoopStatus<FeedStats>;
    expect(status.last?.stats?.failed).toBe(1);
  });
});
