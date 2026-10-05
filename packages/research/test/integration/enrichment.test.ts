/**
 * Crawler and extraction pipeline against the migrated schema: documents, the
 * enrichment cache (one completion per document, forever), apply-to-people through
 * the shared importer, and testimonial tagging.
 */
import { people, sightings } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm, LlmError, LlmInputRejected } from "@wren/llm";
import { and, eq, ne, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCrawl } from "../../src/enrichment/crawler.js";
import {
  applyExtractions,
  DEFAULT_EXTRACTION_SPEC,
  runExtraction,
} from "../../src/enrichment/extraction.js";
import { Shard } from "../../src/enrichment/shard.js";
import { tagTestimonials } from "../../src/enrichment/testimonials.js";
import { documents, enrichments } from "../../src/schema.js";
import { crawlPages, EXTRACTION_JSON, FakeFetcher, makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["runs", "imports", "companies"]));
const db = () => pg.db;

const crawledCompany = async () => {
  const company = await makeCompany(db());
  await runCrawl(db(), new FakeFetcher(crawlPages()), { limit: 10 });
  return company;
};
const allEnrichments = () => db().select().from(enrichments);

describe("crawl", () => {
  it("stores homepage and people pages once", async () => {
    const company = await makeCompany(db());
    const stats = await runCrawl(db(), new FakeFetcher(crawlPages()), { limit: 10 });
    expect(stats.companies_crawled).toBe(1);
    const docs = await db().select().from(documents).where(eq(documents.companyId, company.id));
    expect(new Set(docs.map((d) => d.url))).toEqual(
      new Set(["https://verdano.example", "https://verdano.example/team"]),
    );
    expect(docs.every((d) => d.kind === "webpage")).toBe(true);
    expect(docs.find((d) => d.url.endsWith("/team"))?.text).toContain("jane@verdano.example");
    // Crawl-once: a second run selects nothing for this company.
    const again = await runCrawl(db(), new FakeFetcher(crawlPages()), { limit: 10 });
    expect(again.companies_crawled).toBe(0);
  });

  it("calls checkpoint once per company", async () => {
    await makeCompany(db(), { key: "crd:930020", domain: "alpha.example" });
    await makeCompany(db(), { key: "crd:930021", domain: "beta.example" });
    const fetcher = new FakeFetcher({
      ...crawlPages("alpha.example"),
      ...crawlPages("beta.example"),
    });
    const calls: number[] = [];
    const stats = await runCrawl(db(), fetcher, {
      limit: 10,
      checkpoint: (c) => void calls.push(c.id),
    });
    expect(stats.companies_crawled).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("unreachable site gets a tombstone not starvation", async () => {
    const company = await makeCompany(db(), { key: "crd:930099", domain: "dead.example" });
    const stats = await runCrawl(db(), new FakeFetcher({}), { limit: 10 });
    expect(stats.homepage_unreachable).toBe(1);
    const docs = await db().select().from(documents).where(eq(documents.companyId, company.id));
    expect(docs).toHaveLength(1);
    expect(docs[0]?.text).toBe("");
    // The refusal is kept, so a run of 403s and 429s reads as blocks, not dead sites.
    expect(docs[0]?.statusCode).toBe(404);
    const again = await runCrawl(db(), new FakeFetcher({}), { limit: 10 });
    expect(again.companies_crawled).toBe(0);
    expect(again.homepage_unreachable).toBe(0);
    // And extraction never buys a completion for a tombstone.
    expect((await runExtraction(db(), new FakeLlm())).selected).toBe(0);
  });

  it("strips NUL bytes in served html before storage", async () => {
    const company = await makeCompany(db(), {
      key: null,
      domain: "nul.example",
      name: "Nul Co",
      niche: "agencies",
    });
    const body =
      "<html><head><title>Nul\x00 Co</title></head><body><p>hi\x00 info@nul.example</p></body></html>";
    await runCrawl(db(), new FakeFetcher({ "https://nul.example": body }), { limit: 10 });
    const [doc] = await db()
      .select()
      .from(documents)
      .where(and(eq(documents.companyId, company.id), ne(documents.text, "")));
    expect(doc?.html).not.toContain("\x00");
    expect(doc?.text).not.toContain("\x00");
    expect(doc?.title).toBeTruthy();
    expect(doc?.title).not.toContain("\x00");
  });
});

describe("extraction", () => {
  it("is cached per document", async () => {
    await crawledCompany();
    const llm = new FakeLlm({ default: EXTRACTION_JSON });
    const stats = await runExtraction(db(), llm);
    expect(stats.selected).toBeGreaterThan(0);
    expect(stats.extracted).toBe(stats.selected);
    // The same (document, kind, model, prompt_version) is never re-bought.
    expect((await runExtraction(db(), llm)).selected).toBe(0);
  });

  it("parse failure is persisted not applied", async () => {
    await crawledCompany();
    await runExtraction(db(), new FakeLlm({ default: "no json here, sorry" }));
    const failed = await db()
      .select()
      .from(enrichments)
      .where(sql`${enrichments.output}->>'parse_error' IS NOT NULL`);
    expect(failed.length).toBeGreaterThan(0);
    expect((await applyExtractions(db())).enrichments_applied).toBe(0);
  });

  it("parse failure is retried next run and success then caches", async () => {
    await crawledCompany();
    const first = await runExtraction(
      db(),
      new FakeLlm({ default: '```json\n{"people": [{"full' }),
    );
    expect(first.selected).toBeGreaterThan(0);
    expect(first.parse_errors).toBe(first.selected);
    const second = await runExtraction(db(), new FakeLlm({ default: EXTRACTION_JSON }));
    expect(second.selected).toBe(first.selected);
    expect(second.extracted).toBe(second.selected);
    expect((await runExtraction(db(), new FakeLlm({ default: EXTRACTION_JSON }))).selected).toBe(0);
    const rows = await db().select().from(enrichments).where(eq(enrichments.model, "fake"));
    expect(rows).toHaveLength(first.selected);
    for (const row of rows) {
      const output = row.output as { parse_error: unknown; previous_attempts: unknown[] };
      expect(output.parse_error).toBeNull();
      expect(output.previous_attempts).toHaveLength(1);
    }
  });

  it("apply folds people through the importer", async () => {
    const company = await crawledCompany();
    await runExtraction(db(), new FakeLlm({ default: EXTRACTION_JSON }));
    const stats = await applyExtractions(db());
    expect(stats.enrichments_applied).toBeGreaterThan(0);
    const rows = await db().select().from(people).where(eq(people.companyId, company.id));
    expect(rows).toHaveLength(1); // same Jane from both pages merged by name match
    const jane = rows[0];
    expect(jane?.fullName).toBe("Jane Doe"); // smart-cased from the shouted JSON
    expect(jane?.origin).toBe("website");
    expect(jane?.title).toBe("Founder");
    // Grounding drops the email from the page that never printed it; the address
    // must still reach a sighting from the page that did.
    const seen = await db()
      .select({ raw: sightings.raw })
      .from(sightings)
      .where(eq(sightings.personId, jane?.id as number));
    const emails = seen.map((s) => (s.raw as { email?: string | null }).email).filter(Boolean);
    expect(emails).toEqual(["jane@verdano.example"]);
    // Idempotent: applied enrichments are stamped and never re-applied.
    expect((await applyExtractions(db())).enrichments_applied).toBe(0);
  });

  it("ungrounded email claims are dropped", async () => {
    await crawledCompany();
    const injected =
      '{"people": [{"full_name": "Jane Doe", "title": "Founder", "email": "fake@verdano.example"}], "generic_emails": ["ghost@verdano.example"]}';
    const stats = await runExtraction(db(), new FakeLlm({ default: injected }));
    expect(stats.ungrounded_emails).toBeGreaterThanOrEqual(2);
    for (const row of await allEnrichments()) {
      const output = row.output as {
        parsed: { people: { email: string | null }[]; generic_emails: string[] };
        ungrounded_emails: string[];
      };
      expect(output.parsed.people.every((p) => p.email === null)).toBe(true);
      expect(output.parsed.generic_emails).toEqual([]);
      expect(output.ungrounded_emails).toContain("fake@verdano.example");
    }
  });

  it("shards partition documents without overlap", async () => {
    await crawledCompany();
    const llm = new FakeLlm({ default: EXTRACTION_JSON });
    const total = await runExtraction(db(), llm, { shard: Shard.of(0, 1) });
    expect(total.selected).toBeGreaterThan(0);
    await truncate(db(), ["companies"]);
    await crawledCompany();
    let seen = 0;
    for (let i = 0; i < 2; i++)
      seen += (await runExtraction(db(), llm, { shard: Shard.of(i, 2) })).selected;
    expect(seen).toBe(total.selected);
    expect((await runExtraction(db(), llm)).selected).toBe(0);
  });

  it("input rejection is recorded and the run continues; provider failure aborts", async () => {
    await crawledCompany();
    let n = 0;
    const respond = async () => {
      n += 1;
      if (n === 1) throw new LlmInputRejected("HTTP 422: no valid response generated");
      return EXTRACTION_JSON;
    };
    const stats = await runExtraction(db(), new FakeLlm({ respond }));
    expect(stats.provider_rejected).toBe(1);
    expect(stats.extracted).toBe(stats.selected - 1);
    expect(stats.aborted).toBeNull();
    const rejected = await db()
      .select()
      .from(enrichments)
      .where(sql`${enrichments.output}->>'provider_rejected' IS NOT NULL`);
    expect(rejected).toHaveLength(1);
    expect((await runExtraction(db(), new FakeLlm({ default: EXTRACTION_JSON }))).selected).toBe(0);

    await truncate(db(), ["companies"]);
    await crawledCompany();
    const aborted = await runExtraction(
      db(),
      new FakeLlm({
        respond: async () => {
          throw new LlmError("provider down");
        },
      }),
    );
    expect(aborted.aborted).toBe("provider down");
    expect(aborted.extracted).toBe(0);
  });

  it("older prompt versions are skipped until reextract is asked for", async () => {
    await crawledCompany();
    const llm = new FakeLlm({ default: EXTRACTION_JSON });
    const bought = (await runExtraction(db(), llm)).selected;
    expect(bought).toBeGreaterThan(0);
    const spec = { ...DEFAULT_EXTRACTION_SPEC, promptVersion: "v99" };
    const skipped = await runExtraction(db(), llm, { spec });
    expect(skipped.selected).toBe(0);
    expect(skipped.skipped_older_version).toBe(bought);
    const optedIn = await runExtraction(db(), llm, { spec, reextract: true });
    expect(optedIn.selected).toBe(bought);
    expect(optedIn.skipped_older_version).toBe(0);
  });
});

const TESTIMONIAL_JSON =
  '{"people": [{"full_name": "Jane Doe", "title": "Founder", "bio_facts": ["CFA charterholder"]}, {"full_name": "Ada Vale", "title": "President, Cordelia Labs", "is_testimonial": true, "testimonial_org": "Cordelia Labs"}], "generic_emails": []}';

const personFactsRow = async (personId: number) => {
  const rows = await db().execute(
    sql`SELECT role_rank, is_testimonial, testimonial_org FROM person_facts WHERE person_id = ${personId}`,
  );
  return rows[0] as {
    role_rank: number | null;
    is_testimonial: boolean;
    testimonial_org: string | null;
  };
};

describe("testimonials", () => {
  it("flag flows into people and the view unranks them", async () => {
    await makeCompany(db(), { niche: "agencies" });
    await runCrawl(db(), new FakeFetcher(crawlPages()), { limit: 10 });
    await runExtraction(db(), new FakeLlm({ default: TESTIMONIAL_JSON }));
    await applyExtractions(db());
    const byName = new Map((await db().select().from(people)).map((p) => [p.fullName, p]));
    const ada = byName.get("Ada Vale");
    const jane = byName.get("Jane Doe");
    expect([ada?.isTestimonial, ada?.testimonialOrg]).toEqual([true, "Cordelia Labs"]);
    expect([jane?.isTestimonial, jane?.testimonialOrg]).toEqual([false, null]);
    const adaFacts = await personFactsRow(ada?.id as number);
    expect(adaFacts.role_rank).toBeNull();
    expect([adaFacts.is_testimonial, adaFacts.testimonial_org]).toEqual([true, "Cordelia Labs"]);
    expect((await personFactsRow(jane?.id as number)).role_rank).toBe(1);
    // A second sighting that is silent about the tag must not untag her.
    await runExtraction(db(), new FakeLlm({ default: EXTRACTION_JSON }));
    await applyExtractions(db());
    const [adaAgain] = await db()
      .select()
      .from(people)
      .where(eq(people.id, ada?.id as number));
    expect(adaAgain?.isTestimonial).toBe(true);
  });

  it("tagTestimonials backfills v1 rows without touching staff", async () => {
    const company = await makeCompany(db(), { niche: "agencies" });
    const websitePerson = async (fullName: string, title: string) => {
      const [row] = await db()
        .insert(people)
        .values({
          companyId: company.id,
          fullName,
          title,
          isCompliance: false,
          origin: "website",
          originRef: "enrichment:1 https://verdano.example/about/our-team/",
          raw: {},
        })
        .returning();
      return row as typeof people.$inferSelect;
    };
    const client = await websitePerson("Ada Vale", "President, Cordelia Labs");
    const founder = await websitePerson("Jane Doe", "Founder, CEO");

    const dry = await tagTestimonials(db(), { niche: "agencies", dryRun: true });
    expect([dry.scanned, dry.tagged]).toEqual([2, 1]);
    expect(dry.candidates?.map((c) => c.person_id)).toEqual([client.id]);
    const [untouched] = await db().select().from(people).where(eq(people.id, client.id));
    expect(untouched?.isTestimonial).toBe(false); // a dry run writes nothing

    const runId = crypto.randomUUID();
    const stats = await tagTestimonials(db(), { niche: "agencies", runId });
    expect([stats.scanned, stats.tagged, stats.skipped_already_tagged]).toEqual([2, 1, 0]);
    const [tagged] = await db().select().from(people).where(eq(people.id, client.id));
    expect([tagged?.isTestimonial, tagged?.testimonialOrg]).toEqual([true, "Cordelia Labs"]);
    expect((tagged?.raw as { testimonial_tag: unknown } | undefined)?.testimonial_tag).toEqual({
      method: "title_org_suffix",
      matched: "Cordelia Labs",
      run_id: runId,
    });
    const [staff] = await db().select().from(people).where(eq(people.id, founder.id));
    expect(staff?.isTestimonial).toBe(false);

    // Idempotent: the tagged row leaves the walk and is only counted.
    const again = await tagTestimonials(db(), { niche: "agencies" });
    expect([again.scanned, again.tagged, again.skipped_already_tagged]).toEqual([1, 0, 1]);
  });
});
