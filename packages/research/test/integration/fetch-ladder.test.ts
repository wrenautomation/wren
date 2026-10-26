/**
 * The fetch ladder against the migrated schema: the per-domain memory's rules over `fetch_tiers`,
 * the crawl's tombstones and skips, the render pass's selection and its capped ladder calls, and
 * what `sharedPages` serves from the ladder's tiers.
 */
import { companies } from "@wren/core";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import type { Fetcher, FetchResponse } from "@wrenautomation/scribe/fetch";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EMPTY_HASH, runCrawl } from "../../src/enrichment/crawler.js";
import {
  type BrowserRenderer,
  climbCompany,
  renderCompany,
  selectRenderTargets,
} from "../../src/enrichment/render.js";
import { sharedPages } from "../../src/enrichment/shared-pages.js";
import { FETCH_TIER_DAYS, type MemoryTier, tierMemory } from "../../src/fetch/tier-memory.js";
import { documents, fetchTiers } from "../../src/schema.js";
import { FakeFetcher, makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["fetch_tiers", "documents", "imports", "companies"]));
const db = () => pg.db;

const PAGE =
  "<html><head><title>Verdano</title></head><body><p>Verdano Advisors, a real page.</p></body></html>";
const HOME_WITH_TEAM = `<html><head><title>Verdano</title></head><body><p>Verdano Advisors.</p><a href="/team">Our Team</a></body></html>`;
const SHELL = `<html><head>${"<script src=a.js></script>".repeat(4)}</head><body><div id="root"></div>${" ".repeat(2000)}</body></html>`;
const refusing = (status: number): Fetcher => ({
  userAgent: "wren-test/0.1",
  async get(url): Promise<FetchResponse> {
    return { status, url, text: "no" };
  },
});

/** A fake `web GET /fetch`: records each call, answers by URL. */
function ladderSite(answer: (url: string, from: string) => Record<string, unknown> | Error) {
  const calls: { url: string; from: string }[] = [];
  const site: SiteClient = {
    async call(_site, _method, _path, input = {}) {
      const call = { url: String(input.url), from: String(input.from) };
      calls.push(call);
      const got = answer(call.url, call.from);
      if (got instanceof Error) throw got;
      return got as never;
    },
    async via() {
      return "api";
    },
  };
  return { site, calls };
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

  it("keeps learned_at on a repeat, moves it on a tier change, and ignores a stale row", async () => {
    await tierMemory(db(), () => T0).learn("a.example", "impersonate", "status-403");
    expect(await tierMemory(db(), () => at(1)).get("a.example")).toBe("impersonate");

    await tierMemory(db(), () => at(10)).learn("a.example", "impersonate", "status-403");
    expect((await row())?.learnedAt).toEqual(T0);

    await tierMemory(db(), () => at(11)).learn("a.example", "dead", "cloudflare");
    expect(await row()).toMatchObject({ tier: "dead", block: "cloudflare", learnedAt: at(11) });

    const old = at(11 + FETCH_TIER_DAYS + 1);
    expect(await tierMemory(db(), () => old).get("a.example")).toBeNull();
  });

  it("lists the domains that are dead and fresh", async () => {
    const memory = (day: number) => tierMemory(db(), () => at(day));
    await memory(0).learn("old.example", "dead", null);
    await memory(20).learn("new.example", "dead", null);
    await memory(20).learn("up.example", "render", null);
    expect(await memory(FETCH_TIER_DAYS + 1).dead()).toEqual(["new.example"]);
  });
});

describe("the crawl", () => {
  const stored = () => db().select().from(documents);

  it("fails a block once and records it on the tombstone", async () => {
    await makeCompany(db());
    const stats = await runCrawl(db(), refusing(403), { limit: 10 });
    expect(stats.homepage_unreachable).toBe(1);
    expect(await stored()).toMatchObject([
      { text: "", statusCode: 403, blockReason: "status-403", fetchTier: "httpx" },
    ]);
  });

  it("leaves block_reason empty when the refusal is not a block", async () => {
    await makeCompany(db());
    await runCrawl(db(), refusing(404), { limit: 10 });
    expect(await stored()).toMatchObject([{ statusCode: 404, blockReason: null }]);
  });

  it("skips a dead domain: no fetch, a tombstone, dead_skipped", async () => {
    await makeCompany(db(), { domain: "verdano.example" });
    await tierMemory(db()).learn("verdano.example", "dead", "cloudflare");
    const net = new FakeFetcher({ "https://verdano.example": PAGE });
    const stats = await runCrawl(db(), net, { limit: 10, memory: tierMemory(db()) });
    expect(stats).toMatchObject({
      dead_skipped: 1,
      remembered_skipped: 0,
      homepage_unreachable: 0,
    });
    expect(net.requested).toEqual([]);
    expect(await stored()).toMatchObject([
      { url: "https://verdano.example", text: "", contentHash: EMPTY_HASH, blockReason: "dead" },
    ]);
  });

  it.each(["impersonate", "render", "exit"] as MemoryTier[])(
    "skips a domain remembered at %s for the render pass",
    async (tier) => {
      await makeCompany(db(), { domain: "www.verdano.example" });
      await tierMemory(db()).learn("verdano.example", tier, "status-403");
      const net = new FakeFetcher({});
      const stats = await runCrawl(db(), net, { limit: 10, memory: tierMemory(db()) });
      expect(stats).toMatchObject({ remembered_skipped: 1, dead_skipped: 0 });
      expect(net.requested).toEqual([]);
      expect(await stored()).toMatchObject([{ blockReason: "remembered" }]);
    },
  );

  it("fetches a browser domain as today, so its shell goes to the box renderer", async () => {
    await makeCompany(db(), { domain: "verdano.example" });
    await tierMemory(db()).learn("verdano.example", "browser", "shell");
    const net = new FakeFetcher({});
    const stats = await runCrawl(db(), net, { limit: 10, memory: tierMemory(db()) });
    expect(stats).toMatchObject({ remembered_skipped: 0, dead_skipped: 0 });
    expect(net.requested.length).toBeGreaterThan(0);
  });

  it("fetches as today when the memory is stale or has nothing", async () => {
    await makeCompany(db());
    const T0 = new Date("2026-08-01T00:00:00Z");
    await tierMemory(db(), () => T0).learn("verdano.example", "dead", null);
    const net = new FakeFetcher({ "https://verdano.example": PAGE });
    const stats = await runCrawl(db(), net, { limit: 10, memory: tierMemory(db()) });
    expect(stats).toMatchObject({ companies_crawled: 1, dead_skipped: 0 });
  });
});

/** A crawl tombstone for a company, as the crawl leaves it. */
async function tombstone(co: { id: number; domain: string | null }, blockReason: string | null) {
  await db()
    .insert(documents)
    .values({
      companyId: co.id,
      url: `https://${co.domain}`,
      kind: "webpage",
      statusCode: 403,
      contentHash: EMPTY_HASH,
      text: "",
      blockReason,
    });
}
const shellDoc = (co: { id: number; domain: string | null }) =>
  db()
    .insert(documents)
    .values({
      companyId: co.id,
      url: `https://${co.domain}`,
      kind: "webpage",
      statusCode: 200,
      contentHash: "shell",
      text: "",
      html: SHELL,
      isShell: true,
    });
const firm = (n: number) =>
  makeCompany(db(), { key: `k:${n}`, domain: `firm${n}.example`, name: `Firm ${n}` });
const idsOf = (cs: { id: number }[]) => cs.map((c) => c.id);

describe("the render pass's selection", () => {
  it("takes blocked and remembered companies, not dead, rendered or other ones", async () => {
    const blocked = await firm(1);
    const remembered = await firm(2);
    const dead = await firm(3);
    const rendered = await firm(4);
    const plain = await firm(5);
    const skipped = await firm(6);
    await tombstone(blocked, "status-503");
    await tombstone(remembered, "remembered");
    await tombstone(dead, "dead");
    await tombstone(rendered, "status-403");
    await db().insert(documents).values({
      companyId: rendered.id,
      url: "https://firm4.example/page",
      kind: "webpage",
      statusCode: 200,
      contentHash: "h4",
      text: "page",
      fetchTier: "render",
    });
    await tombstone(plain, null);
    await tombstone(skipped, "status-403");
    // The memory keeps lowercase hostnames: the match ignores the case and a leading www.
    await db()
      .update(companies)
      .set({ domain: "WWW.Firm6.example" })
      .where(eq(companies.id, skipped.id));

    const got = await selectRenderTargets(db(), {
      limit: 10,
      blocked: true,
      shells: false,
      deadDomains: ["firm6.example"],
    });
    expect(idsOf(got.blocked)).toEqual([blocked.id, remembered.id]);
    expect(got.shells).toEqual([]);
  });

  it("takes blocked companies only when asked, and shells first under one limit", async () => {
    const shell = await firm(1);
    const first = await firm(2);
    const second = await firm(3);
    await shellDoc(shell);
    await tombstone(first, "status-403");
    await tombstone(second, "status-429");

    const shellsOnly = await selectRenderTargets(db(), { limit: 10 });
    expect(idsOf(shellsOnly.shells)).toEqual([shell.id]);
    expect(shellsOnly.blocked).toEqual([]);

    const both = await selectRenderTargets(db(), { limit: 2, blocked: true });
    expect(idsOf(both.shells)).toEqual([shell.id]);
    expect(idsOf(both.blocked)).toEqual([first.id]);
  });
});

describe("climbCompany", () => {
  const T0 = new Date("2026-10-18T00:00:00Z");
  const run = async (
    site: SiteClient,
    company: { id: number; domain: string | null },
    budget = { left: 40 },
  ) => {
    const stats = await climbCompany(
      db(),
      { sites: site, budget },
      new FakeFetcher({}),
      company,
      new Map(),
      { memory: tierMemory(db(), () => T0) },
    );
    return { stats, budget };
  };
  const pagesOf = (companyId: number) =>
    db().select().from(documents).where(eq(documents.companyId, companyId));

  it("stores the homepage and people pages at the rung that answered, and learns it", async () => {
    const co = await makeCompany(db());
    await tombstone(co, "status-403");
    const { site, calls } = ladderSite((url, from) =>
      fetched(url, {
        html: url.endsWith("/team") ? PAGE : HOME_WITH_TEAM,
        tier: from === "impersonate" ? "render" : from,
        tries: [
          { tier: "impersonate", status: 403, block: "cloudflare", ms: 1 },
          { tier: "render", status: 200, block: null, ms: 9 },
        ],
      }),
    );
    const { stats, budget } = await run(site, co);
    expect(calls).toEqual([
      { url: "https://verdano.example", from: "impersonate" },
      { url: "https://verdano.example/team", from: "render" },
    ]);
    expect(stats).toMatchObject({
      ladder_requests: 2,
      ladder_pages: 2,
      pages_stored: 2,
      companies_rendered: 1,
    });
    expect(budget.left).toBe(38);
    const rendered = (await pagesOf(co.id)).filter((d) => d.fetchTier === "render");
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toMatchObject({
      blockReason: "status-403",
      fetchSteps: [
        { tier: "impersonate", status: 403, block: "cloudflare", ms: 1 },
        { tier: "render", status: 200, block: null, ms: 9 },
      ],
    });
    expect(await tierMemory(db(), () => T0).get("verdano.example")).toBe("render");
    expect((await selectRenderTargets(db(), { blocked: true })).blocked).toEqual([]);
  });

  it("starts at the remembered rung", async () => {
    const co = await makeCompany(db());
    await tombstone(co, "remembered");
    await tierMemory(db(), () => T0).learn("verdano.example", "exit", "status-403");
    const { site, calls } = ladderSite((url) => fetched(url, { tier: "exit" }));
    await run(site, co);
    expect(calls[0]?.from).toBe("exit");
  });

  it("starts at impersonate when the memory is browser", async () => {
    const co = await makeCompany(db());
    await tombstone(co, "remembered");
    await tierMemory(db(), () => T0).learn("verdano.example", "browser", "shell");
    const { site, calls } = ladderSite((url) => fetched(url));
    await run(site, co);
    expect(calls[0]?.from).toBe("impersonate");
  });

  it("marks the domain dead and moves the tombstone when the ladder gets nothing", async () => {
    const co = await makeCompany(db());
    await tombstone(co, "status-403");
    const tries = [{ tier: "impersonate", status: 403, block: "cloudflare", ms: 1 }];
    const { site } = ladderSite((url) =>
      fetched(url, { status: 403, html: "no", block: "cloudflare", tier: "render", tries }),
    );
    const { stats } = await run(site, co);
    expect(stats).toMatchObject({ ladder_requests: 1, ladder_dead: 1, ladder_pages: 0 });
    expect(await pagesOf(co.id)).toMatchObject([
      { text: "", fetchTier: "render", blockReason: "cloudflare", fetchSteps: tries },
    ]);
    expect(await tierMemory(db(), () => T0).get("verdano.example")).toBe("dead");
    expect((await selectRenderTargets(db(), { blocked: true })).blocked).toEqual([]);
  });

  it("does nothing once the cap is spent", async () => {
    const co = await makeCompany(db());
    await tombstone(co, "status-403");
    const { site, calls } = ladderSite((url) => fetched(url));
    const { stats } = await run(site, co, { left: 0 });
    expect(calls).toEqual([]);
    expect(stats.ladder_requests).toBe(0);
    expect((await selectRenderTargets(db(), { blocked: true })).blocked).toHaveLength(1);
  });

  it("stops the people pages when the cap runs out mid-company", async () => {
    const co = await makeCompany(db());
    await tombstone(co, "status-403");
    const { site, calls } = ladderSite((url) => fetched(url, { html: HOME_WITH_TEAM }));
    const { stats, budget } = await run(site, co, { left: 1 });
    expect(calls).toHaveLength(1);
    expect(stats).toMatchObject({ ladder_requests: 1, ladder_pages: 1 });
    expect(budget.left).toBe(0);
  });

  it("leaves the company for the next run when the cap bucket answers 429", async () => {
    const co = await makeCompany(db());
    await tombstone(co, "status-403");
    const { site } = ladderSite(() => new SiteCallError("web", "GET", "/fetch", 429, "cap"));
    const { stats, budget } = await run(site, co);
    expect(stats).toMatchObject({ ladder_requests: 1, ladder_dead: 0, render_errors: 1 });
    expect(budget.left).toBe(0);
    expect(await tierMemory(db(), () => T0).get("verdano.example")).toBeNull();
    expect((await selectRenderTargets(db(), { blocked: true })).blocked).toHaveLength(1);
  });

  it("leaves the company for the next run when the call fails", async () => {
    const co = await makeCompany(db());
    await tombstone(co, "status-403");
    const { site } = ladderSite(() => new Error("Mac is off"));
    const { stats } = await run(site, co);
    expect(stats).toMatchObject({ ladder_requests: 1, ladder_dead: 0, render_errors: 1 });
    expect(await tierMemory(db(), () => T0).get("verdano.example")).toBeNull();
    expect((await selectRenderTargets(db(), { blocked: true })).blocked).toHaveLength(1);
  });
});

describe("the box renderer and the memory", () => {
  const shellCompany = async (domain: string, n: number) => {
    const co = await makeCompany(db(), { key: `s:${n}`, domain });
    await shellDoc(co);
    return co;
  };
  const render =
    (html: string): BrowserRenderer["render"] =>
    async (url) => ({
      html,
      finalUrl: url,
      statusCode: 200,
    });
  const learned = (domain: string) => tierMemory(db()).get(domain);

  it("learns browser when a render gives a page", async () => {
    const co = await shellCompany("spa.example", 1);
    await renderCompany(db(), render(PAGE), new FakeFetcher({}), co, new Map(), {
      jitter: [0, 0],
      memory: tierMemory(db()),
    });
    expect(await learned("spa.example")).toBe("browser");
  });

  it("learns dead when the render is still a shell", async () => {
    const co = await shellCompany("spa.example", 1);
    await renderCompany(db(), render(`${SHELL} `), new FakeFetcher({}), co, new Map(), {
      jitter: [0, 0],
      memory: tierMemory(db()),
    });
    expect(await learned("spa.example")).toBe("dead");
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
