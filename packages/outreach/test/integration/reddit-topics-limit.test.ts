/**
 * RedditReads' topics model call under its limit (designs/2026-10-16-loop-watchdog.md), on a real
 * Restate and Postgres: a model that never answers is cut at `limits.http` a try, three tries,
 * then the pass goes on with no search, keeps the timeout in `last.timeouts`, and asks again next
 * pass. Synthetic audience, no desk data.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import type { SiteClient } from "@wren/core/content";
import { journaledSites } from "@wren/core/content/restate";
import type { PassOutcome } from "@wren/core/restate";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverySettingsSchema } from "../../src/discovery/places.js";
import { DEFAULT_POLICY } from "../../src/policy.js";
import { type DiscoveryStats, makeRedditReads } from "../../src/restate/discovery.js";
import { REACH_SEQUENCES } from "../../src/sequences.js";

const LIMIT_MS = 1_000;
/** While set, the topics prompt never answers. */
let hang = true;
let asks = 0;
const llm = new FakeLlm({
  respond: (prompt) => {
    if (!prompt.includes("Reddit search phrases")) return "{}";
    asks += 1;
    return hang ? new Promise<string>(() => {}) : JSON.stringify({ topics: ["front desk"] });
  },
});
/** The desk, faked: every listing empty. */
const paths: string[] = [];
const sites: SiteClient = {
  async call<T>(_site: string, _method: string, path: string) {
    paths.push(path);
    return { data: { children: [] } } as T;
  },
  via: async () => "api",
};

let pg: TestPostgres;
let env: RestateTestEnvironment;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [
      makeRedditReads({
        db: pg.db,
        policy: DEFAULT_POLICY,
        sequences: REACH_SEQUENCES,
        live: false,
        senderName: "Test",
        heldNiches: [],
        sitesFor: (ctx) => journaledSites(ctx, sites),
        discovery: {
          llm,
          voice: "",
          facts: async () => [],
          audience: async () =>
            discoverySettingsSchema.parse({
              about: "Clinics that run their own front desk",
              exaSearches: 0,
            }),
          limits: { http: LIMIT_MS },
        },
      }),
    ],
    alwaysReplay: true,
  });
}, 180_000);
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

const reads = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .objectClient<ReturnType<typeof makeRedditReads>>({ name: "RedditReads" }, "wren");
const pass = async (): Promise<PassOutcome<DiscoveryStats>> => {
  await reads().sync();
  return (await reads().status()).last as PassOutcome<DiscoveryStats>;
};

describe("RedditReads' topics call", () => {
  it("is cut at its limit, three tries; the pass goes on and the next one asks again", async () => {
    const first = await pass();
    // Nothing else read this pass, so the miss is the pass's error; the chain goes on.
    expect(first.error).toContain("topics gave no answer in 1 s");
    expect(first.stats?.errors).toEqual([expect.stringContaining("topics gave no answer in 1 s")]);
    expect(first.timeouts).toEqual([{ call: "topics", unit: null, ms: LIMIT_MS }]);
    expect(asks).toBeGreaterThanOrEqual(3);
    // No topic, no search: the desk was never asked for one.
    expect(paths.filter((p) => p === "/subreddits/search")).toEqual([]);

    // The month's search waited: the next pass asks the model again and searches.
    hang = false;
    const before = asks;
    const second = await pass();
    expect(asks).toBeGreaterThan(before);
    expect(second.error).toBeNull();
    expect(second.stats?.errors).toEqual([]);
    expect(second.timeouts).toBeUndefined();
    expect(paths).toContain("/subreddits/search");

    // Searched: the month's done, no third ask.
    const after = asks;
    await pass();
    expect(asks).toBe(after);
  });
});
