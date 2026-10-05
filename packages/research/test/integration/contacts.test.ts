/**
 * The contacts stage against the migrated schema: one `contact_scan` per page,
 * one point per (firm, kind, value) counting the pages that carry it, a team
 * card's profile tied to its person, an archived page read from the store, and
 * two runs that picked the same page counting it once.
 */
import { people } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { asc } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  loadContactTarget,
  runContacts,
  scanContacts,
  selectContactTargets,
} from "../../src/enrichment/contacts.js";
import { archivePages, memoryPageStore } from "../../src/pages.js";
import { contactPoints, documents } from "../../src/schema.js";
import { makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["runs", "imports", "companies"]));
const db = () => pg.db;

const FOOTER =
  '<a href="tel:+12125550187">call</a> <a href="https://www.linkedin.com/company/verdano">in</a>';

async function page(companyId: number, path: string, html: string) {
  await db()
    .insert(documents)
    .values({
      companyId,
      url: `https://verdano.example/${path}`,
      kind: "webpage",
      contentHash: `h-${path}`,
      text: "words",
      html,
    });
}

describe("runContacts", () => {
  it("counts pages per point, ties a card's profile to its person, and reads each page once", async () => {
    const firm = await makeCompany(db());
    const [jane] = await db()
      .insert(people)
      .values({
        companyId: firm.id,
        fullName: "Jane Roe",
        firstName: "Jane",
        lastName: "Roe",
        isCompliance: false,
        origin: "website",
        originRef: "test",
        raw: {},
      })
      .returning({ id: people.id });
    await page(firm.id, "", FOOTER);
    await page(
      firm.id,
      "team",
      `${FOOTER}<h3>Jane Roe</h3><a href="https://linkedin.com/in/janeroe">in</a>` +
        '<a href="https://www.linkedin.com/company/partner-co">partner</a>',
    );
    expect(await runContacts(db())).toEqual({
      selected: 2,
      scanned: 2,
      points: 6,
      pages_with_points: 2,
    });
    const rows = await db()
      .select({
        kind: contactPoints.kind,
        value: contactPoints.value,
        pages: contactPoints.pages,
        personId: contactPoints.personId,
      })
      .from(contactPoints)
      .orderBy(asc(contactPoints.id));
    expect(rows).toEqual([
      { kind: "phone", value: "+12125550187", pages: 2, personId: null },
      {
        kind: "linkedin_company",
        value: "https://www.linkedin.com/company/verdano/",
        pages: 2,
        personId: null,
      },
      {
        kind: "linkedin_company",
        value: "https://www.linkedin.com/company/partner-co/",
        pages: 1,
        personId: null,
      },
      {
        kind: "linkedin_person",
        value: "https://www.linkedin.com/in/janeroe/",
        pages: 1,
        personId: jane?.id,
      },
    ]);
    expect((await runContacts(db())).selected).toBe(0);
  });

  it("a page two runs picked is read once: the second adds nothing", async () => {
    const firm = await makeCompany(db());
    await page(firm.id, "", FOOTER);
    const [id] = await selectContactTargets(db(), {});
    const target = id === undefined ? null : await loadContactTarget(db(), id);
    if (!target) throw new Error("no target");
    expect(await scanContacts(db(), target)).toHaveLength(2);
    expect(await scanContacts(db(), target)).toEqual([]);
    const pages = await db().select({ pages: contactPoints.pages }).from(contactPoints);
    expect(pages).toEqual([{ pages: 1 }, { pages: 1 }]);
  });

  it("reads an archived page back from the store", async () => {
    const firm = await makeCompany(db());
    await page(firm.id, "", FOOTER);
    const store = memoryPageStore();
    await archivePages(db(), store, { before: new Date(Date.now() + 86_400_000) });
    expect((await runContacts(db(), { pages: store })).points).toBe(2);
  });
});
