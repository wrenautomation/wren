/**
 * Page archive against the migrated schema: HTML leaves Postgres for the store,
 * the row keeps its key and `tel:` targets, and the email scan still reads the
 * page back. Store failures leave the row as it was.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCrawl } from "../../src/enrichment/crawler.js";
import { runScan } from "../../src/enrichment/email-scan.js";
import { archivePages, htmlOf, memoryPageStore, pageCounts, pageKey } from "../../src/pages.js";
import { documents, enrichments } from "../../src/schema.js";
import { FakeFetcher, makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["runs", "imports", "companies"]));
const db = () => pg.db;

// The address is only in the link: the text alone has no email.
const HOME =
  '<html><body><a href="mailto:hello@verdano.example">Write to us</a> <a href="tel:+1 (212) 555-0187">Call</a></body></html>';
const LATER = new Date(Date.now() + 86_400_000);

async function crawled() {
  await makeCompany(db());
  await runCrawl(db(), new FakeFetcher({ "https://verdano.example": HOME }), { limit: 10 });
  const [doc] = await db().select().from(documents);
  if (!doc) throw new Error("crawl stored nothing");
  return doc;
}

describe("archivePages", () => {
  it("moves the HTML out, keeps key and tel targets, and the scan reads it back", async () => {
    const doc = await crawled();
    const store = memoryPageStore();
    const stats = await archivePages(db(), store, { before: LATER });
    expect(stats).toEqual({ moved: 1, chars: HOME.length, more: false });
    const [row] = await db().select().from(documents).where(eq(documents.id, doc.id));
    expect(row).toMatchObject({
      html: null,
      htmlKey: pageKey(doc.id),
      telHrefs: ["+1 (212) 555-0187"],
    });
    expect(store.keys()).toEqual([pageKey(doc.id)]);
    expect(await htmlOf(row as typeof doc, store)).toBe(HOME);
    expect(await pageCounts(db())).toEqual({ inline: 0, archived: 1 });

    await expect(runScan(db())).rejects.toThrow(/no page store/);
    const scan = await runScan(db(), { pages: store });
    expect(scan.signals).toBe(1);
    const [found] = await db().select().from(enrichments).where(eq(enrichments.documentId, doc.id));
    expect(JSON.stringify(found?.output)).toContain("hello@verdano.example");

    expect(await archivePages(db(), store, { before: LATER })).toEqual({
      moved: 0,
      chars: 0,
      more: false,
    });
  });

  it("leaves pages fetched after `before` inline", async () => {
    await crawled();
    expect((await archivePages(db(), memoryPageStore(), { before: new Date(0) })).moved).toBe(0);
    expect(await db().select().from(documents).where(isNotNull(documents.html))).toHaveLength(1);
  });

  it("a failed upload changes nothing", async () => {
    const doc = await crawled();
    const broken = {
      put: async () => {
        throw new Error("bucket down");
      },
      get: async () => "",
    };
    await expect(archivePages(db(), broken, { before: LATER })).rejects.toThrow("bucket down");
    const [row] = await db().select().from(documents).where(eq(documents.id, doc.id));
    expect(row).toMatchObject({ html: HOME, htmlKey: null, telHrefs: null });
  });

  it("stops at its limit and says more are waiting", async () => {
    await makeCompany(db());
    await runCrawl(
      db(),
      new FakeFetcher({
        "https://verdano.example": '<a href="/team">Team</a>',
        "https://verdano.example/team": "<p>Team</p>",
      }),
      { limit: 10 },
    );
    const store = memoryPageStore();
    expect(await archivePages(db(), store, { before: LATER, limit: 1 })).toMatchObject({
      moved: 1,
      more: true,
    });
    expect(await archivePages(db(), store, { before: LATER, limit: 1 })).toMatchObject({
      moved: 1,
    });
    expect(await pageCounts(db())).toEqual({ inline: 0, archived: 2 });
  });
});
