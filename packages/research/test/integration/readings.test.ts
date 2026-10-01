/**
 * Outside readings: export cuts a firm's pages to leadership lines; load keeps only
 * names (and emails) printed on the page, and folds them into people.
 */
import { people } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCrawl } from "../../src/enrichment/crawler.js";
import { exportReadings, leadershipExcerpt, loadReadings } from "../../src/enrichment/readings.js";
import { enrichments } from "../../src/schema.js";
import { crawlPages, FakeFetcher, makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["runs", "imports", "companies"]));
const db = () => pg.db;
const READER = "test-reader";

describe("leadershipExcerpt", () => {
  it("keeps lines near leadership words and marks the gaps", () => {
    const text = [
      "Welcome",
      "x",
      "y",
      "z",
      "w",
      "Jane Doe",
      "Founder",
      "a",
      "b",
      "c",
      "d",
      "Contact",
    ].join("\n");
    expect(leadershipExcerpt(text, 1)).toBe("Jane Doe\nFounder\na");
    expect(leadershipExcerpt("Nothing here\nat all")).toBe("");
  });
});

describe("outside readings", () => {
  it("exports unnamed firms, loads only printed names, and does not export them again", async () => {
    const company = await makeCompany(db(), { niche: "agencies" });
    await runCrawl(db(), new FakeFetcher(crawlPages()), { limit: 10 });
    const exported = await exportReadings(db(), { niche: "agencies", reader: READER });
    expect(exported.map((f) => f.company_id)).toEqual([company.id]);
    const page = exported[0]?.pages.find((p) => p.url.endsWith("/team"));
    expect(page?.excerpt).toContain("Jane Doe, Founder");

    const docId = page?.document_id as number;
    const stats = await loadReadings(db(), {
      reader: READER,
      promptVersion: "v2",
      exported,
      results: [
        {
          company_id: company.id,
          people: [
            {
              full_name: "Jane Doe",
              title: "Founder",
              email: "jane@verdano.example",
              document_id: docId,
              linkedin_url: null,
              bio_facts: [],
              is_testimonial: false,
              testimonial_org: null,
            },
            {
              full_name: "Invented Person",
              title: "CEO",
              email: "ceo@verdano.example",
              document_id: docId,
              linkedin_url: null,
              bio_facts: [],
              is_testimonial: false,
              testimonial_org: null,
            },
          ],
        },
      ],
    });
    expect(stats.ungrounded_names).toBe(1);
    expect(stats.documents_read).toBe(exported[0]?.pages.length);
    const named = await db().select().from(people).where(eq(people.companyId, company.id));
    expect(named.map((p) => [p.fullName, p.title, p.origin])).toEqual([
      ["Jane Doe", "Founder", "website"],
    ]);
    const rows = await db().select().from(enrichments).where(eq(enrichments.model, READER));
    expect(rows.every((r) => r.appliedAt !== null)).toBe(true);
    expect(await exportReadings(db(), { niche: "agencies", reader: READER })).toEqual([]);
  });
});
