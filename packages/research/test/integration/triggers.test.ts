/**
 * The triggers stage on a real Postgres: news headlines become firms with their reason, a firm we
 * hold gets the news as a finding, a headline is read once, and a word waits its week. Synthetic
 * data only.
 */
import { companies } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  TRIGGERS_SOURCE,
  triggerHits,
  triggerKey,
  triggerQuery,
  triggersDue,
  triggerUnit,
} from "../../src/enrichment/news-triggers.js";
import type { Fetcher } from "../../src/fetch/fetcher.js";
import { makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() =>
  truncate(pg.db, ["companies", "sightings", "imports", "import_errors", "findings", "documents"]),
);
const db = () => pg.db;
const NOW = new Date("2026-10-10T12:00:00Z");

const item = (title: string, link: string, day: string) =>
  `<item><title>${title}</title><link>${link}</link><pubDate>${day}</pubDate><description>${title}</description></item>`;
const FEED = `<rss><channel>
${item("Bolt Staffing acquires Cove Talent", "https://news.example/bolt", "Thu, 08 Oct 2026 10:00:00 GMT")}
${item("Verdano Staffing opens new office in Austin", "https://news.example/verdano", "Wed, 07 Oct 2026 10:00:00 GMT")}
${item("Megacorp raises prices", "https://news.example/mega", "Wed, 07 Oct 2026 10:00:00 GMT")}
${item("Old Staffing acquires Older Co", "https://news.example/old", "Mon, 01 Jun 2026 10:00:00 GMT")}
</channel></rss>`;

const fetching = (text: string): Fetcher & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    userAgent: "test",
    get: async (url: string) => {
      asked.push(url);
      return { status: 200, url, text };
    },
  } as unknown as Fetcher & { asked: string[] };
};
/** Names the firm in each headline the way a model would: the first two words, Megacorp none. */
const naming = () => {
  const prompts: string[] = [];
  const llm = new FakeLlm({
    respond: (p) => {
      prompts.push(p);
      const lines = p.split("\n").filter((l) => /^\d+\. /.test(l));
      const items = lines.map((l) => {
        const [i, rest] = l.split(". ", 2) as [string, string];
        const firm = rest.startsWith("Megacorp") ? null : rest.split(" ").slice(0, 2).join(" ");
        return { i: Number(i), firm };
      });
      return JSON.stringify({ items });
    },
  });
  return { llm, prompts };
};

describe("pure parts", () => {
  it("asks for the word as a phrase, the kinds' words and two weeks", () => {
    const q = triggerQuery("staffing agency", ["acquisition", "funding"]);
    expect(q).toBe('"staffing agency" (acquired OR acquisition OR funding OR raises) when:14d');
  });
  it("keys a firm by its bare name", () => {
    expect(triggerKey("The Acme Staffing Group, Inc.")).toBe("nt:acme-staffing-group");
    expect(triggerKey("A")).toBeNull();
  });
  it("keeps dated hits of a trigger kind in the window", () => {
    const hits = triggerHits(
      [
        { title: "Bolt Staffing acquires Cove", url: "u1", date: "2026-10-08T00:00:00Z" },
        { title: "Bolt Staffing wins award", url: "u2", date: "2026-10-08T00:00:00Z" },
        { title: "Bolt Staffing raises seed round", url: "u3", date: "2026-08-01T00:00:00Z" },
        { title: "No date acquires", url: "u4" },
      ],
      NOW,
    );
    expect(hits.map((h) => [h.url, h.kind])).toEqual([["u1", "acquisition"]]);
  });
});

describe("triggerUnit", () => {
  it("imports new firms with the news, puts news on a firm we hold, reads a link once", async () => {
    const held = await makeCompany(db(), {
      key: null,
      domain: "verdano.example",
      name: "Verdano Staffing LLC",
      niche: "recruiting",
    });
    const { llm, prompts } = naming();
    const f = fetching(FEED);
    const u = await triggerUnit(
      db(),
      { fetcher: f, llm },
      { word: "staffing agency", niche: "recruiting", now: NOW },
    );
    expect(f.asked[0]).toContain("news.google.com/rss/search");
    expect(u).toMatchObject({
      outcome: "read",
      hits: 3,
      named: 2,
      matched: 1,
      created: 1,
      kept: 2,
    });
    const made = await db()
      .select({ name: companies.name, key: companies.sourceKey, niche: companies.niche })
      .from(companies)
      .where(sql`${companies.sourceKey} like 'nt:%'`);
    expect(made).toEqual([{ name: "Bolt Staffing", key: "nt:bolt-staffing", niche: "recruiting" }]);
    const news = await db().execute<{ company_id: number; url: string }>(
      sql`select company_id, url from research_signals order by url`,
    );
    expect(news.map((n) => n.url)).toEqual([
      "https://news.example/bolt",
      "https://news.example/verdano",
    ]);
    expect(news.find((n) => n.url.endsWith("verdano"))?.company_id).toBe(held.id);

    // The same feed again: every link is known, so the model isn't asked and nothing changes.
    const again = await triggerUnit(
      db(),
      { fetcher: fetching(FEED), llm },
      { word: "staffing agency", niche: "recruiting", now: NOW },
    );
    expect(again).toMatchObject({ outcome: "read", hits: 0, named: 0, created: 0, kept: 0 });
    expect(prompts).toHaveLength(1);
  });

  it("counts a read word for a week, and says a page that is no feed", async () => {
    const { llm } = naming();
    await triggerUnit(
      db(),
      { fetcher: fetching("<rss></rss>"), llm },
      { word: "staffing agency", niche: "recruiting", now: NOW },
    );
    const [imp] = await db().execute<{ n: number }>(
      sql`select count(*)::int n from imports where source_type = ${TRIGGERS_SOURCE}`,
    );
    expect(imp?.n).toBe(1);
    expect(
      await triggersDue(db(), ["staffing agency", "recruiting firm"], { now: NOW, limit: 5 }),
    ).toEqual(["recruiting firm"]);
    const later = new Date(NOW.getTime() + 8 * 86_400_000);
    expect(await triggersDue(db(), ["staffing agency"], { now: later, limit: 5 })).toEqual([
      "staffing agency",
    ]);

    const bad = await triggerUnit(
      db(),
      { fetcher: fetching("<html>consent</html>"), llm },
      { word: "staffing firm", niche: "recruiting", now: NOW },
    );
    expect(bad).toMatchObject({ outcome: "error", error: "not a feed" });
  });
});
