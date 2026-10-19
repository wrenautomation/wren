/**
 * The fetch ladder against the migrated schema: the per-domain memory's rules over `fetch_tiers`,
 * what a crawl stores when the ladder answers or fails, and what `sharedPages` serves from it.
 */
import type { SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCrawl } from "../../src/enrichment/crawler.js";
import { sharedPages } from "../../src/enrichment/shared-pages.js";
import type { Fetcher, FetchResponse } from "../../src/fetch/fetcher.js";
import { LadderFetcher } from "../../src/fetch/ladder.js";
import { FETCH_TIER_DAYS, tierMemory } from "../../src/fetch/tier-memory.js";
import { documents, fetchTiers } from "../../src/schema.js";
import { makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["fetch_tiers", "documents", "imports", "companies"]));
const db = () => pg.db;

const PAGE =
  "<html><head><title>Verdano</title></head><body><p>Verdano Advisors, a real page.</p></body></html>";
const SHELL = `<html><head>${"<script src=a.js></script>".repeat(4)}</head><body><div id="root"></div>${" ".repeat(2000)}</body></html>`;

/** A site that refuses every plain fetch with a 403. */
const refusing: Fetcher = {
  userAgent: "wren-test/0.1",
  async get(url): Promise<FetchResponse> {
    return { status: 403, url, text: "no" };
  },
};

function ladderSite(answer: (url: string) => Record<string, unknown>): SiteClient {
  return {
    async call(_site, _method, _path, input = {}) {
      return answer(String(input.url)) as never;
    },
    async via() {
      return "api";
    },
  };
}
const fetched = (url: string, over: Record<string, unknown> = {}) => ({
  url,
  finalUrl: url,
  status: 200,
  type: "text/html",
  html: PAGE,
  cut: 0,
  tier: "impersonate",
  block: null,
  tries: [{ tier: "impersonate", status: 200, block: null, ms: 4 }],
  ...over,
});

describe("tierMemory", () => {
  const T0 = new Date("2026-10-01T00:00:00Z");
  const at = (days: number) => new Date(T0.getTime() + days * 86_400_000);
  const row = async () =>
    (await db().select().from(fetchTiers).where(eq(fetchTiers.domain, "a.example")))[0];

  it("writes nothing for plain with no row", async () => {
    await tierMemory(db(), () => T0).learn("a.example", "plain", null);
    expect(await row()).toBeUndefined();
  });

  it("keeps learned_at on a repeat, moves up on a higher rung, and ignores a stale row", async () => {
    await tierMemory(db(), () => T0).learn("a.example", "impersonate", "status-403");
    expect(await tierMemory(db(), () => at(1)).startFor("a.example")).toBe("impersonate");

    await tierMemory(db(), () => at(10)).learn("a.example", "impersonate", "status-403");
    expect((await row())?.learnedAt).toEqual(T0);

    await tierMemory(db(), () => at(11)).learn("a.example", "render", "shell");
    expect(await row()).toMatchObject({ tier: "render", block: "shell", learnedAt: at(11) });

    const old = at(11 + FETCH_TIER_DAYS + 1);
    expect(await tierMemory(db(), () => old).startFor("a.example")).toBeNull();
  });

  it("leaves a fresh row when plain works, deletes a stale one", async () => {
    await tierMemory(db(), () => T0).learn("a.example", "render", "shell");
    await tierMemory(db(), () => at(2)).learn("a.example", "plain", null);
    expect((await row())?.tier).toBe("render");
    await tierMemory(db(), () => at(FETCH_TIER_DAYS + 1)).learn("a.example", "plain", null);
    expect(await row()).toBeUndefined();
  });
});

describe("a crawl through the ladder", () => {
  it("stores the ladder's tier, the block and the steps, and remembers the rung", async () => {
    await makeCompany(db());
    const site = ladderSite((url) => fetched(url));
    const ladder = new LadderFetcher(refusing, site, tierMemory(db()));
    const stats = await runCrawl(db(), ladder, { limit: 10 });
    expect(stats.companies_crawled).toBe(1);
    const [doc] = await db().select().from(documents);
    expect(doc).toMatchObject({
      fetchTier: "impersonate",
      blockReason: "status-403",
      fetchSteps: [
        { tier: "plain", status: 403, block: "status-403" },
        { tier: "impersonate", status: 200, block: null },
      ],
    });
    const [learned] = await db().select().from(fetchTiers);
    expect(learned).toMatchObject({
      domain: "verdano.example",
      tier: "impersonate",
      block: "status-403",
    });
  });

  it("keeps the status and adds the block and steps on the tombstone", async () => {
    await makeCompany(db());
    const blocked = ladderSite((url) =>
      fetched(url, {
        status: 403,
        html: "no",
        block: "cloudflare",
        tries: [
          { tier: "impersonate", status: 403, block: "cloudflare", ms: 1 },
          { tier: "exit", status: 403, block: "cloudflare", ms: 1 },
        ],
        tier: "exit",
      }),
    );
    const stats = await runCrawl(db(), new LadderFetcher(refusing, blocked, tierMemory(db())), {
      limit: 10,
    });
    expect(stats.homepage_unreachable).toBe(1);
    const [doc] = await db().select().from(documents);
    expect(doc).toMatchObject({ text: "", statusCode: 403, blockReason: "cloudflare" });
    expect(doc?.fetchSteps).toEqual([
      { tier: "plain", status: 403, block: "status-403" },
      { tier: "impersonate", status: 403, block: "cloudflare" },
      { tier: "exit", status: 403, block: "cloudflare" },
    ]);
    expect(await db().select().from(fetchTiers)).toEqual([]);
  });
});

describe("sharedPages and the ladder's tiers", () => {
  const net = (text: string, tier: string): { fetcher: Fetcher; got: string[] } => {
    const got: string[] = [];
    return {
      got,
      fetcher: {
        userAgent: "wren-test/0.1",
        async get(url) {
          got.push(url);
          return { status: 200, url, text, tier };
        },
      },
    };
  };

  it("serves a kept render page, with its tier, without the network", async () => {
    const n = net(PAGE, "render");
    const shared = sharedPages(db(), n.fetcher);
    await shared.get("https://firm.example/team");
    const again = await shared.get("https://firm.example/team");
    expect(n.got).toHaveLength(1);
    expect(again).toMatchObject({ status: 200, tier: "render" });
    const [kept] = await db().select().from(documents);
    expect(kept).toMatchObject({ companyId: null, fetchTier: "render" });
  });

  it("does not serve a kept page that is still a shell", async () => {
    const n = net(SHELL, "render");
    const shared = sharedPages(db(), n.fetcher);
    await shared.get("https://firm.example/team");
    await shared.get("https://firm.example/team");
    expect(n.got).toHaveLength(2);
  });
});
