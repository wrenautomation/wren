/** sizeFromPpp against the migrated schema: which companies are sized, how, and only once per release. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { companies } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PPP_MODEL, sizeFromPpp } from "../../src/companies/ppp-size.js";
import { enrichments } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["runs", "imports", "companies"]));
const db = () => pg.db;

const HEADER =
  "LoanNumber,BorrowerName,BorrowerState,BorrowerZip,InitialApprovalAmount,CurrentApprovalAmount,JobsReported,FranchiseName";
function loanDir(files: Record<string, string[]>): string {
  const dir = mkdtempSync(join(tmpdir(), "ppp-size-"));
  for (const [name, rows] of Object.entries(files))
    writeFileSync(join(dir, name), `${[HEADER, ...rows].join("\n")}\n`);
  return dir;
}

let k = 0;
async function addCompany(
  name: string,
  raw: Record<string, unknown>,
  niche: string | null = "recruiting",
): Promise<number> {
  const [row] = await db()
    .insert(companies)
    .values({ sourceKey: `test:${k++}`, name, niche, raw })
    .returning({ id: companies.id });
  return (row as { id: number }).id;
}

describe("sizeFromPpp", () => {
  it("sizes by name + ZIP, name + state, and legal name; only the niche; once per release", async () => {
    const dir = loanDir({
      "public_150k_plus_240930.csv": [
        "1,ACME STAFFING LLC,TX,78701-1234,200000,250000,30,",
        "2,BOLT TALENT INC,CO,80202,60000,60000,8,Bolt Franchise",
        "3,SPLIT SEARCH,FL,33101,10000,10000,2,",
        "4,SPLIT SEARCH,FL,32801,10000,10000,2,",
        "5,OTHER NICHE CO,TX,78701,10000,10000,2,",
      ],
      "public_150k_plus_230930.csv": ["9,QUIET TEMPS LLC,TX,78701,10000,10000,1,"],
    });
    const acme = await addCompany("Acme Staffing", { postcode: "78701-1234", geo: "Austin, TX" });
    const bolt = await addCompany("Bolt Talent", { geo: "Denver, CO" });
    const legal = await addCompany("Crown Recruiters", {
      legal_name: "ACME STAFFING LLC",
      postcode: "78701",
    });
    await addCompany("Split Search", { geo: "Miami, FL" }); // two borrowers in FL: left unsized
    await addCompany("Quiet Temps", { postcode: "78701" }); // only in the older release
    await addCompany("Other Niche", { postcode: "78701" }, "agencies");

    const stats = await sizeFromPpp(db(), { dir, niche: "recruiting" });
    expect(stats).toEqual({
      release: "240930",
      loans: 5,
      companies: 5,
      matched_zip: 2,
      matched_state: 1,
      franchises: 1,
    });

    const rows = await db().select().from(enrichments);
    expect(rows.map((r) => r.companyId).sort()).toEqual([acme, bolt, legal].sort());
    for (const r of rows) {
      expect(r).toMatchObject({ kind: "firmographics", model: PPP_MODEL, promptVersion: "240930" });
      expect(r.documentId).toBeNull();
    }
    const acmeOut = rows.find((r) => r.companyId === acme)?.output as Record<string, unknown>;
    expect(acmeOut).toMatchObject({
      source: "ppp_foia",
      release: "240930",
      match: "name_zip",
      jobs_reported: 30,
      payroll_yearly_estimate: 1_200_000,
      franchise: null,
    });
    expect((acmeOut.loans as Record<string, string>[]).map((l) => l.LoanNumber)).toEqual(["1"]);
    const boltOut = rows.find((r) => r.companyId === bolt)?.output as Record<string, unknown>;
    expect(boltOut).toMatchObject({
      match: "name_state",
      franchise: "Bolt Franchise",
      jobs_reported: 8,
    });

    // A second run skips what this release already sized; unmatched ones are looked at again.
    const again = await sizeFromPpp(db(), { dir, niche: "recruiting" });
    expect(again).toMatchObject({ companies: 2, matched_zip: 0, matched_state: 0 });
    expect(await db().select().from(enrichments)).toHaveLength(3);
  });

  it("a new release sizes the same companies again under its own version", async () => {
    const first = loanDir({ "public_x_240930.csv": ["1,ACME STAFFING,TX,78701,10000,10000,1,"] });
    const id = await addCompany("Acme Staffing", { postcode: "78701" });
    await sizeFromPpp(db(), { dir: first, niche: "recruiting" });
    const second = loanDir({ "public_x_250331.csv": ["1,ACME STAFFING,TX,78701,20000,20000,2,"] });
    const stats = await sizeFromPpp(db(), { dir: second, niche: "recruiting" });
    expect(stats).toMatchObject({ release: "250331", companies: 1, matched_zip: 1 });
    const versions = (await db().select().from(enrichments))
      .filter((r) => r.companyId === id)
      .map((r) => r.promptVersion)
      .sort();
    expect(versions).toEqual(["240930", "250331"]);
  });

  it("a geo without ', ST' and a postcode without five digits give no match", async () => {
    const dir = loanDir({ "public_x_240930.csv": ["1,ACME STAFFING,TX,78701,10000,10000,1,"] });
    await addCompany("Acme Staffing", { geo: "Texas", postcode: "7870" });
    const stats = await sizeFromPpp(db(), { dir, niche: "recruiting" });
    expect(stats).toMatchObject({ companies: 1, matched_zip: 0, matched_state: 0 });
  });
});
