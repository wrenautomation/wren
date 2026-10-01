/**
 * Importer, keyed leads without a company domain (a freemail contact on a registry firm
 * with no site), and declined counts from the source. Tables are truncated between tests.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runImport } from "../../src/ingest/importer.js";
import { OverturePlacesSource } from "../../src/ingest/overture.js";
import { SbaSearchSource } from "../../src/ingest/sba.js";
import { IDENTITY_KEY, type RawRow } from "../../src/ingest/schema.js";
import type { LeadSource } from "../../src/ingest/sources.js";
import { companies, leads, sightings } from "../../src/schema.js";

let pg: TestPostgres;
const db = () => pg.db;
const root = mkdtempSync(join(tmpdir(), "wren-keyed-"));
let n = 0;

class MemorySource implements LeadSource {
  readonly sourceType = "fake_registry";
  readonly sourceRef = "memory";
  constructor(
    private readonly data: RawRow[],
    private readonly declines?: Record<string, number>,
  ) {}
  *rows() {
    yield* this.data;
  }
  declined(): Record<string, number> {
    return { ...this.declines };
  }
}
class NoDeclineSource implements LeadSource {
  readonly sourceType = "fake_plain";
  readonly sourceRef = "memory";
  constructor(private readonly data: RawRow[]) {}
  *rows() {
    yield* this.data;
  }
}
const keyed = (row: RawRow, key: string): RawRow => ({
  ...row,
  [IDENTITY_KEY]: { source_key: key },
});

function must<T>(v: T | undefined, what = "row"): T {
  if (v === undefined) throw new Error(`expected ${what}`);
  return v;
}
const leadByEmail = async (email: string) =>
  must((await db().select().from(leads).where(eq(leads.email, email)))[0], email);
const companyByKey = async (key: string) =>
  must((await db().select().from(companies).where(eq(companies.sourceKey, key)))[0], key);
const allCompanies = () => db().select().from(companies);

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["imports", "companies", "leads", "suppressions"]));

describe("keyed lead with no company domain", () => {
  it("a new freemail lead on a keyed firm gets the keyed company, domain null", async () => {
    const { stats } = await runImport(
      db(),
      new MemorySource([
        keyed({ email: "pat.owner@gmail.com", company_name: "Pat's Staffing" }, "sba:UEI000000001"),
      ]),
      { niche: "recruiting" },
    );
    expect(stats).toMatchObject({ leads_created: 1, companies_created: 1, errors: 0 });
    const company = await companyByKey("sba:UEI000000001");
    expect(company).toMatchObject({ domain: null, name: "Pat's Staffing", niche: "recruiting" });
    expect((await leadByEmail("pat.owner@gmail.com")).companyId).toBe(company.id);
  });

  it("an unkeyed freemail lead with no site still has no company", async () => {
    const { stats } = await runImport(
      db(),
      new MemorySource([{ email: "solo@gmail.com", company_name: "Solo Temps" }]),
    );
    expect(stats).toMatchObject({ leads_created: 1, companies_created: 0 });
    expect((await leadByEmail("solo@gmail.com")).companyId).toBeNull();
    expect(await allCompanies()).toHaveLength(0);
  });

  it("two freemail contacts of one keyed firm share its company", async () => {
    const { stats } = await runImport(
      db(),
      new MemorySource([
        keyed({ email: "a.owner@gmail.com", company_name: "Duo Staffing" }, "sba:UEI000000002"),
        keyed({ email: "b.owner@yahoo.com", company_name: "Duo Staffing" }, "sba:UEI000000002"),
      ]),
    );
    expect(stats).toMatchObject({ leads_created: 2, companies_created: 1, companies_seen: 1 });
    const company = await companyByKey("sba:UEI000000002");
    expect((await leadByEmail("a.owner@gmail.com")).companyId).toBe(company.id);
    expect((await leadByEmail("b.owner@yahoo.com")).companyId).toBe(company.id);
  });

  it("a companyless lead re-sighted with a key gains the keyed company", async () => {
    await runImport(db(), new MemorySource([{ email: "pat.owner@gmail.com" }]));
    expect((await leadByEmail("pat.owner@gmail.com")).companyId).toBeNull();

    const { batch, stats } = await runImport(
      db(),
      new MemorySource([
        keyed({ email: "pat.owner@gmail.com", company_name: "Pat's Staffing" }, "sba:UEI000000003"),
      ]),
    );
    expect(stats).toMatchObject({ duplicate_leads: 1, companies_created: 1, leads_created: 0 });
    const company = await companyByKey("sba:UEI000000003");
    expect(company.domain).toBeNull();
    const pat = await leadByEmail("pat.owner@gmail.com");
    expect(pat.companyId).toBe(company.id);
    const sighting = must(
      (await db().select().from(sightings).where(eq(sightings.leadId, pat.id)))[0],
    );
    expect(sighting.importId).toBe(batch.id);
  });

  it("a re-sighted lead already linked keeps its company", async () => {
    await runImport(
      db(),
      new MemorySource([keyed({ email: "pat.owner@gmail.com" }, "sba:UEI000000004")]),
    );
    const first = await companyByKey("sba:UEI000000004");
    await runImport(
      db(),
      new MemorySource([keyed({ email: "pat.owner@gmail.com" }, "sba:UEI000000005")]),
    );
    expect((await leadByEmail("pat.owner@gmail.com")).companyId).toBe(first.id);
  });

  it("re-sighted with the same key: the company is seen, not duplicated", async () => {
    const row = keyed({ email: "pat.owner@gmail.com", company_name: "Pat's" }, "sba:UEI000000006");
    await runImport(db(), new MemorySource([row]));
    const { stats } = await runImport(db(), new MemorySource([row]));
    expect(stats).toMatchObject({ duplicate_leads: 1, companies_created: 0, companies_seen: 1 });
    expect(await allCompanies()).toHaveLength(1);
  });
});

describe("declined counts", () => {
  it("stats.declined is the source's own count", async () => {
    const { batch, stats } = await runImport(
      db(),
      new MemorySource([{ email: "x@firm.example" }], { chain: 3, closed: 1 }),
    );
    expect(stats.declined).toEqual({ chain: 3, closed: 1 });
    expect(batch.stats).toMatchObject({ declined: { chain: 3, closed: 1 } });
  });

  it("no declines, or a source without declined(), leaves it out", async () => {
    const empty = await runImport(db(), new MemorySource([{ email: "x@firm.example" }], {}));
    expect(empty.stats.declined).toBeUndefined();
    const plain = await runImport(db(), new NoDeclineSource([{ email: "y@firm.example" }]));
    expect(plain.stats.declined).toBeUndefined();
  });
});

describe("registry sources end to end", () => {
  it("SBA directory: siteless firm keyed by UEI, freemail contact linked, off-code firm declined", async () => {
    const dir = join(root, `sba${n++}`);
    mkdirSync(dir);
    const firm = (over: Record<string, unknown>) => ({
      legal_business_name: "ACME STAFFING LLC",
      contact_person: "JANE DOE",
      current_principals: "JANE DOE - OWNER",
      city: "AUSTIN",
      state: "Texas",
      zipcode: "78701",
      naics_primary: "561320",
      ...over,
    });
    writeFileSync(
      join(dir, "naics-561320-2026-09-30.json"),
      JSON.stringify({
        results: [
          firm({ uei: "UEI000000010", email: "jane.doe@gmail.com", website: null }),
          firm({
            uei: "UEI000000011",
            legal_business_name: "BETA SEARCH INC",
            email: "info@betasearch.example",
            website: "https://www.betasearch.example",
          }),
          firm({ uei: "UEI000000012", naics_primary: "541511", email: "it@itshop.example" }),
        ],
      }),
    );
    const { stats } = await runImport(
      db(),
      new SbaSearchSource(dir, new Set(["561311", "561312", "561320"])),
      { niche: "recruiting" },
    );
    expect(stats).toMatchObject({ rows: 2, leads_created: 2, companies_created: 2, errors: 0 });
    expect(stats.declined).toEqual({ not_primary: 1 });
    const keyedFirm = await companyByKey("sba:UEI000000010");
    expect(keyedFirm).toMatchObject({
      domain: null,
      name: "ACME STAFFING LLC",
      niche: "recruiting",
    });
    expect((keyedFirm.raw as RawRow).postcode).toBe("78701");
    const jane = await leadByEmail("jane.doe@gmail.com");
    expect(jane).toMatchObject({
      companyId: keyedFirm.id,
      firstName: "Jane",
      lastName: "Doe",
      title: "Owner",
    });
    expect(jane.geo).toBe("Austin, TX");
    const beta = await leadByEmail("info@betasearch.example");
    const betaCo = must((await allCompanies()).find((c) => c.id === beta.companyId));
    expect(betaCo).toMatchObject({ domain: "betasearch.example", sourceKey: null });
  });

  it("Overture file: declines recorded, siteless place keyed by id", async () => {
    const path = join(root, `places${n++}.jsonl`);
    const place = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      names: { primary: `Firm ${id}` },
      websites: [`https://${id}.example`],
      addresses: [{ locality: "Austin", region: "TX", country: "US", postcode: "78701" }],
      ...over,
    });
    writeFileSync(
      path,
      [
        place("solo", { emails: ["info@solo.example"] }),
        place("c1", { websites: ["https://chain.example/1"] }),
        place("c2", { websites: ["https://chain.example/2"] }),
        place("c3", { websites: ["https://chain.example/3"] }),
        place("shut", { operating_status: "permanently_closed" }),
        place("nosite", { websites: [] }),
      ]
        .map((p) => JSON.stringify(p))
        .join("\n"),
    );
    const { stats } = await runImport(db(), new OverturePlacesSource(path), {
      niche: "recruiting",
    });
    expect(stats).toMatchObject({ rows: 2, companies_created: 2, errors: 0 });
    expect(stats.declined).toEqual({ chain: 3, closed: 1 });
    expect(await companyByKey("overture:nosite")).toMatchObject({
      domain: null,
      name: "Firm nosite",
    });
    const solo = must((await allCompanies()).find((c) => c.domain === "solo.example"));
    expect(solo.sourceKey).toBeNull();
    // A company made beside its lead takes the lead's country.
    expect(solo.country).toBe("US");
  });
});
