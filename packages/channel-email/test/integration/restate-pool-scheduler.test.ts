/**
 * The pool-feeder over stand-in Discovery/Enrichment objects: stage order, the
 * spend gate, progress → short delay, idle → next day, a refusing stage → retry,
 * and `profiles` reading compose's queue.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf, loadSettings } from "@wren/config";
import { runs } from "@wren/core";
import type { LoopStatus, PassOutcome } from "@wren/core/restate";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type FeedStats, makePoolScheduler } from "../../src/restate/pool-scheduler.js";
import { untilNextLocalDay } from "../../src/restate/postmaster-scheduler.js";
import { SendPolicy } from "../../src/send/policy.js";
import { makeCompany, makePerson, TABLES } from "./compose-fixtures.js";

const POLICY = SendPolicy.fromSettings(
  loadSettings({ WREN_DATABASE_URL: "postgresql://x", WREN_SEND_TIMEZONE: "UTC" }),
);

/** What each stand-in stage answers next; the test moves the pool by hand. */
const answers = {
  discover: { companies_scanned: 0 },
  crawl: { companies_crawled: 0, homepage_unreachable: 0, robots_blocked: 0 },
  pick: { picked: 0 },
  resolve: { domains_processed: 0, credits_spent: 0, dead_domains: 0 },
  verify: { selected: 0, local_invalid: 0, valid: 0, invalid: 0, risky: 0, catch_all: 0 },
  crawlRefuses: false,
};
const called: string[] = [];
/** What `profiles` was asked last. */
let profilesInput: unknown = null;
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
    pick: async (_ctx: restate.ObjectContext, input: { rules?: boolean }) => {
      called.push(input.rules ? "pick" : "pick by model");
      return answers.pick;
    },
    applyPicks: stage("applyPicks", () => ({ picks_applied: 0 })),
    profiles: async (_ctx: restate.ObjectContext, input: unknown) => {
      called.push("profiles");
      profilesInput = input;
      return { selected: 0, people_matched: 0, people_unresolved: 0 };
    },
  },
});

const fakeResolution = restate.object({
  name: "Resolution",
  handlers: {
    resolveNewDomains: stage("resolveNewDomains", () => answers.resolve),
    verifyLeads: stage("verifyLeads", () => answers.verify),
  },
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [
      fakeDiscovery,
      fakeEnrichment,
      fakeResolution,
      makePoolScheduler({
        db: pg.db,
        policy: POLICY,
        modelStages: "none",
        freeVerifier: true,
        profiles: { ahead: () => 2, horizonDays: 45 },
        busyMs: 5_000,
      }),
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
  profilesInput = null;
  answers.discover = { companies_scanned: 0 };
  answers.crawl = { companies_crawled: 0, homepage_unreachable: 0, robots_blocked: 0 };
  answers.resolve = { domains_processed: 0, credits_spent: 0, dead_domains: 0 };
  answers.verify = { selected: 0, local_invalid: 0, valid: 0, invalid: 0, risky: 0, catch_all: 0 };
  answers.crawlRefuses = false;
});

type Pool = ReturnType<typeof makePoolScheduler>;
const client = (key = "sec_ria") =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .objectClient<Pool>({ name: "PoolScheduler" }, key);
const sync = (key?: string) => client(key).sync() as Promise<PassOutcome<FeedStats>>;

describe("PoolScheduler", () => {
  it("walks the free stages in order (the pick by rules), skips extraction, and sleeps a day when idle", async () => {
    const out = await sync();
    expect(called).toEqual([
      "discover",
      "verify",
      "crawl",
      "render",
      "scan",
      "pick",
      "applyPicks",
      "resolveNewDomains",
      "verifyLeads",
      "profiles",
    ]);
    expect(out.stats?.stages.map((s) => [s.stage, s.skipped])).toEqual([
      ["discover", false],
      ["verify", false],
      ["crawl", false],
      ["render", false],
      ["scan", false],
      ["extract", true],
      ["pick", false],
      ["applyPicks", false],
      ["resolveMailboxes", false],
      ["verifyMailboxes", false],
      ["profiles", false],
    ]);
    expect(out.stats?.progress).toBe(0);
    // Sleeps to the policy's next local midnight after `now` (whatever day the test runs).
    expect(out.delayMs).toBe(untilNextLocalDay(POLICY, new Date(out.now)));
    const ledger = await pg.db.select().from(runs);
    expect(ledger.map((r) => [r.command, r.niche, r.finishedAt !== null])).toEqual([
      ["pool feed", "sec_ria", true],
    ]);
  });

  it("profiles reads compose's queue a week ahead (here 2 firms) and passes the stage's limit and zone", async () => {
    await truncate(pg.db, TABLES);
    const oak = await makeCompany(pg.db);
    const elm = await makeCompany(pg.db, { domain: "elmstreet.example", name: "Elm Advisors" });
    const fir = await makeCompany(pg.db, { domain: "firlane.example", name: "Fir Advisors" });
    const people = [
      await makePerson(pg.db, oak, { email: "jane@oakbridge.example" }),
      await makePerson(pg.db, elm, {
        full: "Ann Poe",
        first: "Ann",
        email: "ann@elmstreet.example",
      }),
      await makePerson(pg.db, fir, { full: "Ray Lee", first: "Ray", email: "ray@firlane.example" }),
    ];
    await sync();
    const input = profilesInput as { personIds: number[]; limit: number; timezone: string };
    expect(input).toMatchObject({ limit: 5, timezone: "UTC" });
    expect(input.personIds).toHaveLength(2);
    expect(people.map((p) => p.id)).toEqual(expect.arrayContaining(input.personIds));
  });

  it("comes back in a minute while a stage still finds work", async () => {
    answers.crawl = { companies_crawled: 7, homepage_unreachable: 3, robots_blocked: 0 };
    const out = await sync();
    expect(out.stats?.progress).toBe(10);
    expect(out.delayMs).toBe(5_000);
  });

  it("counts every verdict row as mailbox progress", async () => {
    answers.verify = {
      selected: 6,
      local_invalid: 1,
      valid: 2,
      invalid: 1,
      risky: 1,
      catch_all: 0,
    };
    const out = await sync();
    expect(out.stats?.stages.find((s) => s.stage === "verifyMailboxes")?.progress).toBe(5);
    expect(out.delayMs).toBe(5_000);
  });

  it("counts probes and dead domains as resolve progress, a domain walked twice never", async () => {
    answers.resolve = { domains_processed: 9, credits_spent: 12, dead_domains: 2 };
    const out = await sync();
    expect(out.stats?.stages.find((s) => s.stage === "resolveMailboxes")?.progress).toBe(14);
    expect(out.delayMs).toBe(5_000);
  });

  it("records a refusing stage, keeps walking, and retries with a backoff", async () => {
    answers.crawlRefuses = true;
    answers.discover = { companies_scanned: 25 };
    const out = await sync();
    const crawl = out.stats?.stages.find((s) => s.stage === "crawl");
    expect(crawl?.error).toMatch(/WREN_FETCH_CONTACT/);
    expect(called).toEqual([
      "discover",
      "verify",
      "crawl",
      "render",
      "scan",
      "pick",
      "applyPicks",
      "resolveNewDomains",
      "verifyLeads",
      "profiles",
    ]);
    expect(out.stats).toMatchObject({ failed: 1, progress: 25 });
    expect(out).toMatchObject({ failures: 1, delayMs: 15_000 });
    const status = (await client().status()) as LoopStatus<FeedStats>;
    expect(status.last?.stats?.failed).toBe(1);
    // Failures in a row double the wait; one clean pass resets it.
    expect(await sync()).toMatchObject({ failures: 2, delayMs: 30_000 });
    answers.crawlRefuses = false;
    expect(await sync()).toMatchObject({ failures: 0 });
  });

  it("narrows a niche's loop to the stages start was given, and {} widens it back", async () => {
    await client().start({ stages: ["resolveMailboxes", "verifyMailboxes"] });
    await client().stop(); // the pass the start queued runs first: one object, one queue
    const out = await sync();
    expect(new Set(called)).toEqual(new Set(["resolveNewDomains", "verifyLeads"]));
    expect(out.stats?.stages.filter((s) => !s.skipped).map((s) => s.stage)).toEqual([
      "resolveMailboxes",
      "verifyMailboxes",
    ]);
    expect(((await client().status()) as LoopStatus<FeedStats>).settings).toEqual({
      stages: ["resolveMailboxes", "verifyMailboxes"],
    });
    await client().start({});
    await client().stop();
    expect(((await client().status()) as LoopStatus<FeedStats>).settings).toBeNull();
    called.length = 0;
    await sync();
    expect(called).toContain("crawl");
  });
});
