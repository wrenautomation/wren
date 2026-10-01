/**
 * The Enrichment virtual object end to end on fakes: crawl → scan → extract →
 * apply → pick → apply, then the render tier. alwaysReplay re-runs the journal
 * after every step, so any non-determinism outside ctx.run fails loudly.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { leads, people, runs } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserRenderer } from "../../src/enrichment/render.js";
import { ALL_NICHES, type Enrichment, makeEnrichment } from "../../src/restate/enrichment.js";
import { documents, enrichments } from "../../src/schema.js";
import { FakeFetcher, makeCompany } from "./fixtures.js";

const ROECO_HOME = `<html><head><title>Roe & Co</title></head><body>
<p>Roe & Co builds storefronts.</p>
<a href="mailto:info@roeco.example">Email us</a>
<a href="/team">Our Team</a>
</body></html>`;
const ROECO_TEAM = `<html><body><h1>Team</h1>
<p>Jane A. Roe, Founder — jane@roeco.example</p></body></html>`;
const SOLO_HOME = `<html><head><title>Solo Studio</title></head><body>
<p>One-person Shopify studio.</p>
<a href="mailto:hello@solo.example">Say hi</a>
</body></html>`;
const SHELL_HOME = `<html><head><script src='/a.js'></script><script src='/b.js'></script><script src='/c.js'></script></head><body><div id="root"></div>${"<!-- pad -->".repeat(200)}</body></html>`;
const RENDERED_HOME = `<html><head><title>SPA Studio</title></head><body>
<p>We are a storefront studio.</p>
<a href="mailto:team@spa.example">Write to us</a>
</body></html>`;
const ROECO_EXTRACTION =
  '{"people": [{"full_name": "Jane A. Roe", "title": "Founder", "email": null}], "generic_emails": []}';
const ROECO_VERDICT =
  '{"emails": [{"email": "jane@roeco.example", "classification": "person", "person_name": "Jane A. Roe"}, {"email": "info@roeco.example", "classification": "role"}], "best_send_to": "jane@roeco.example"}';

let pg: TestPostgres;
let env: RestateTestEnvironment;
const fetcher = new FakeFetcher({
  "https://roeco.example": ROECO_HOME,
  "https://roeco.example/team": ROECO_TEAM,
  "https://solo.example": SOLO_HOME,
  "https://spa.example": SHELL_HOME,
});
const prompts: string[] = [];
const llm = new FakeLlm({
  respond: (p) => {
    prompts.push(p);
    // Extraction prompts carry the page; pick prompts carry the signal table.
    if (p.includes("best_send_to")) return ROECO_VERDICT;
    return p.includes("roeco") ? ROECO_EXTRACTION : '{"people": []}';
  },
});
let browsersOpened = 0;
let browsersClosed = 0;
const renderer = async (): Promise<BrowserRenderer> => {
  browsersOpened += 1;
  return {
    render: async (url) => ({ html: RENDERED_HOME, finalUrl: url, statusCode: 200 }),
    close: async () => {
      browsersClosed += 1;
    },
  };
};

beforeAll(async () => {
  pg = await startTestPostgres();
  env = await RestateTestEnvironment.start({
    services: [
      makeEnrichment({ db: pg.db, fetcher, llm, renderer, renderJitter: [0, 0], renderIdleMs: 50 }),
    ],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, ["runs", "imports", "companies"]);
  prompts.length = 0;
});
const db = () => pg.db;
const client = (key = ALL_NICHES) =>
  clients.connect({ url: env.baseUrl() }).objectClient<Enrichment>({ name: "Enrichment" }, key);
const finishedRuns = () => db().select().from(runs).orderBy(runs.startedAt);

describe("Enrichment virtual object", () => {
  it("crawl → scan → extract → apply → pick → apply, one ledger run per handler", async () => {
    const roeco = await makeCompany(db(), {
      key: null,
      domain: "roeco.example",
      name: "Roe & Co",
      niche: "agencies",
    });
    const solo = await makeCompany(db(), {
      key: null,
      domain: "solo.example",
      name: "Solo Studio",
      niche: "agencies",
    });
    const c = client("agencies");

    const crawl = await c.crawl({ limit: 10 });
    expect(crawl.companies_crawled).toBe(2);
    expect(crawl.pages_stored).toBe(3);

    const scan = await c.scan({});
    expect(scan.selected).toBe(3);
    expect(scan.signals).toBeGreaterThanOrEqual(3);

    const extract = await c.extract({});
    expect(extract.selected).toBe(3);
    expect(extract.extracted).toBe(3);
    expect(extract.aborted).toBeNull();
    // Cached: nothing re-selected under the same prompt version.
    expect((await c.extract({})).selected).toBe(0);

    const applied = await c.applyExtractions({});
    expect(applied.enrichments_applied).toBe(3);
    const [jane] = await db().select().from(people).where(eq(people.companyId, roeco.id));
    expect(jane?.fullName).toBe("Jane A. Roe");

    prompts.length = 0;
    const pick = await c.pick({});
    expect(pick.picked).toBe(2);
    expect(pick.auto_accepted).toBe(1);
    expect(pick.classified).toBe(1);
    expect(prompts).toHaveLength(1);

    const picks = await c.applyPicks({});
    expect(picks.picks_applied).toBe(2);
    expect(picks.person_emails).toBe(1);
    expect(picks.role_leads).toBe(2);
    const [lead] = await db().select().from(leads).where(eq(leads.email, "hello@solo.example"));
    expect(lead?.companyId).toBe(solo.id);

    const ledger = await finishedRuns();
    expect(ledger.map((r) => r.command)).toEqual([
      "enrich crawl",
      "enrich scan",
      "enrich extract",
      "enrich extract",
      "enrich apply-extractions",
      "enrich pick",
      "enrich apply-picks",
    ]);
    expect(ledger.every((r) => r.finishedAt !== null && r.stats !== null)).toBe(true);
    expect(ledger[0]?.niche).toBe("agencies");
    expect(ledger[2]?.model).toBe("fake");
    expect((ledger[5]?.stats as { picked: number } | undefined)?.picked).toBe(2);
  });

  it("the key scopes the population and 'all' spans niches", async () => {
    await makeCompany(db(), {
      key: null,
      domain: "roeco.example",
      name: "Roe & Co",
      niche: "agencies",
    });
    await makeCompany(db(), {
      key: null,
      domain: "solo.example",
      name: "Solo Studio",
      niche: "clinics",
    });
    expect((await client("agencies").crawl({ limit: 10 })).companies_crawled).toBe(1);
    expect((await client(ALL_NICHES).crawl({ limit: 10 })).companies_crawled).toBe(1);
  });

  it("a niche@i/n key crawls only its shard, so shard keys run side by side", async () => {
    const ids: number[] = [];
    for (const name of ["Ash", "Birch", "Cedar", "Dogwood"]) {
      const c = await makeCompany(db(), {
        key: null,
        domain: `${name.toLowerCase()}.example`,
        name,
        niche: "agencies",
      });
      ids.push(c.id);
    }
    // The fake web has none of these sites: each visit ends unreachable, which still counts.
    const visited = (s: { companies_crawled: number; homepage_unreachable: number }) =>
      s.companies_crawled + s.homepage_unreachable;
    const even = ids.filter((id) => id % 2 === 0).length;
    expect(visited(await client("agencies@0/2").crawl({ limit: 10 }))).toBe(even);
    expect(visited(await client("agencies@1/2").crawl({ limit: 10 }))).toBe(4 - even);
  });

  it("render shares one browser across units, closes it when idle, and hands the page to scan", async () => {
    const spa = await makeCompany(db(), {
      key: null,
      domain: "spa.example",
      name: "SPA Studio",
      niche: "agencies",
    });
    const c = client(ALL_NICHES);
    expect((await c.crawl({ limit: 10 })).shells_stored).toBe(1);
    expect((await c.scan({})).selected).toBe(0);

    const [opened, closed] = [browsersOpened, browsersClosed];
    const render = await c.render({ limit: 10 });
    expect(render.companies_rendered).toBe(1);
    expect(render.pages_stored).toBe(1);
    expect(browsersOpened - opened).toBe(1);
    await vi.waitFor(() => expect(browsersClosed - closed).toBe(1));
    const [browserDoc] = await db()
      .select()
      .from(documents)
      .where(and(eq(documents.companyId, spa.id), eq(documents.fetchTier, "browser")));
    expect(browserDoc?.html).toContain("team@spa.example");

    // No targets: no browser launched.
    expect((await c.render({ limit: 10 })).companies_rendered).toBe(0);
    expect(browsersOpened - opened).toBe(1);
    expect((await c.scan({})).signals).toBe(1);
  });

  it("a bad shard is a terminal error, not a retry loop", async () => {
    await expect(client().crawl({ shard: "9/3" })).rejects.toThrow(/shard/i);
    expect(await finishedRuns()).toEqual([]);
  });

  it("tagTestimonials needs a niche key", async () => {
    await expect(client(ALL_NICHES).tagTestimonials({})).rejects.toThrow(/niche/);
    expect((await client("agencies").tagTestimonials({})).scanned).toBe(0);
  });

  it("no-content picks are recorded and backfill is a no-op on fresh rows", async () => {
    await makeCompany(db(), {
      key: null,
      domain: "spa.example",
      name: "SPA Studio",
      niche: "agencies",
    });
    const c = client(ALL_NICHES);
    await c.crawl({ limit: 10 });
    const pick = await c.pick({});
    expect(pick.no_content).toBe(1);
    const [row] = await db().select().from(enrichments).where(eq(enrichments.kind, "email_pick"));
    expect((row?.output as { call: unknown } | undefined)?.call).toBeNull();
    expect((await c.backfillCallRecords({})).selected).toBe(0);
  });
});
