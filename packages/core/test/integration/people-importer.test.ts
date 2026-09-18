/**
 * People importer against the migrated schema: identity, dedupe across sources,
 * blank-fill, compliance flag upgrades, sightings, company minting, person_facts.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runPeopleImport } from "../../src/people/importer.js";
import {
  type PersonItem,
  type PersonRowInput,
  personRow,
  personRowError,
} from "../../src/people/schema.js";
import type { PersonSource } from "../../src/people/sources.js";
import { companies, importErrors, people, sightings } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["imports", "companies", "people"]));

function must<T>(v: T | undefined, what = "row"): T {
  if (v === undefined) throw new Error(`expected ${what}`);
  return v;
}
const db = () => pg.db;
const companyByKey = async (key: string) =>
  must((await db().select().from(companies).where(eq(companies.sourceKey, key)))[0], key);
const one = async <T>(rows: Promise<T[]>) => {
  const list = await rows;
  expect(list).toHaveLength(1);
  return must(list[0]);
};

/** The simplest possible PersonSource: rows handed in directly. */
class ListSource implements PersonSource {
  readonly sourceType = "test-people";
  readonly sourceRef = "inline";
  readonly contentHash?: string;
  constructor(
    private readonly items: PersonItem[],
    contentHash?: string,
  ) {
    if (contentHash !== undefined) this.contentHash = contentHash;
  }
  rows() {
    return this.items;
  }
}

const person = (overrides: Partial<PersonRowInput> = {}) =>
  personRow({
    companySourceKey: "crd:9001",
    companyName: "Acme Advisors",
    fullName: "Jane Q Doe",
    firstName: "Jane",
    lastName: "Doe",
    title: "Owner",
    origin: "registry",
    originRef: "test!file#1",
    asOf: "2026-07-01",
    raw: { src: "test" },
    ...overrides,
  });

describe("runPeopleImport", () => {
  it("creates person and mints unknown company", async () => {
    const { batch, stats } = await runPeopleImport(db(), new ListSource([person()]));
    expect(stats).toMatchObject({ people_created: 1, companies_created: 1 });
    const stored = await one(db().select().from(people).where(eq(people.importId, batch.id)));
    expect(stored.fullName).toBe("Jane Q Doe");
    const company = await companyByKey("crd:9001");
    expect(stored.companyId).toBe(company.id);
    expect(company.name).toBe("Acme Advisors");
    expect(stored.importId).toBe(batch.id);
  });

  it("attaches to existing company without minting", async () => {
    await db().insert(companies).values({ sourceKey: "crd:9001", name: null, raw: {} });
    const { stats } = await runPeopleImport(db(), new ListSource([person()]));
    expect(stats.companies_created).toBe(0);
    expect((await companyByKey("crd:9001")).name).toBe("Acme Advisors"); // blank-filled, not overwritten
  });

  it("name rematch blank-fills and sights", async () => {
    await runPeopleImport(db(), new ListSource([person({ title: null })]));
    // Same human via 1J: middle name absent, compliance duty asserted.
    const { batch, stats } = await runPeopleImport(
      db(),
      new ListSource([
        person({
          fullName: "Jane Doe",
          title: "Chief Compliance Officer",
          isCompliance: true,
          originRef: "test!cco#1",
        }),
      ]),
    );
    expect(stats).toMatchObject({ people_seen: 1, people_created: 0 });
    const stored = await one(db().select().from(people).where(eq(people.fullName, "Jane Q Doe")));
    expect(stored.title).toBe("Chief Compliance Officer"); // filled a blank
    expect(stored.isCompliance).toBe(true); // false -> true upgrade
    const sighting = await one(
      db().select().from(sightings).where(eq(sightings.personId, stored.id)),
    );
    expect(sighting.importId).toBe(batch.id);
  });

  it("source_key match wins and converges the keyless row", async () => {
    await runPeopleImport(db(), new ListSource([person()])); // keyless Jane
    let { stats } = await runPeopleImport(
      db(),
      new ListSource([person({ sourceKey: "crd-ind:777", originRef: "test!rep#1" })]),
    );
    expect(stats.people_seen).toBe(1);
    const stored = await one(db().select().from(people).where(eq(people.sourceKey, "crd-ind:777")));
    expect(stored.sourceKey).toBe("crd-ind:777"); // keyless identity converged

    // A third pass on the key alone matches without any name help.
    ({ stats } = await runPeopleImport(
      db(),
      new ListSource([
        person({ sourceKey: "crd-ind:777", fullName: "J. Doe", firstName: null, lastName: null }),
      ]),
    ));
    expect(stats.people_seen).toBe(1);
    const rematched = await one(
      db().select().from(people).where(eq(people.sourceKey, "crd-ind:777")),
    );
    expect(rematched.fullName).toBe("Jane Q Doe");
  });

  it("same name at different firms stays distinct", async () => {
    const { batch, stats } = await runPeopleImport(
      db(),
      new ListSource([
        person(),
        person({ companySourceKey: "crd:9002", companyName: "Other LLC" }),
      ]),
    );
    expect(stats.people_created).toBe(2);
    expect(await db().select().from(people).where(eq(people.importId, batch.id))).toHaveLength(2);
  });

  it("error rows land in import_errors", async () => {
    const { batch, stats } = await runPeopleImport(
      db(),
      new ListSource([personRowError("row without a FilingID", { FilingID: "" }), person()]),
    );
    expect(stats).toMatchObject({ errors: 1, people_created: 1 });
    const error = await one(
      db().select().from(importErrors).where(eq(importErrors.importId, batch.id)),
    );
    expect(error.rowNumber).toBe(1);
    expect(error.raw).toEqual({ FilingID: "" });
  });

  it("replay detection", async () => {
    const first = await runPeopleImport(db(), new ListSource([person()], "abc"));
    const replay = await runPeopleImport(db(), new ListSource([person()], "abc"));
    expect(replay.stats.replay_of).toBe(first.batch.id);
  });

  it("person_facts ranks and avoids", async () => {
    await runPeopleImport(
      db(),
      new ListSource([
        person(), // Owner -> rank 1
        person({
          fullName: "Vic President",
          firstName: "Vic",
          lastName: "President",
          title: "Vice President",
        }),
        person({
          fullName: "Carl Compliance",
          firstName: "Carl",
          lastName: "Compliance",
          title: "Chief Compliance Officer",
          isCompliance: true,
        }),
      ]),
    );
    const rows = await db().execute<{
      full_name: string;
      role_rank: number | null;
      avoid_emailing_first: boolean;
    }>(
      sql`SELECT full_name, role_rank, avoid_emailing_first FROM person_facts WHERE company_source_key = 'crd:9001'`,
    );
    const facts = Object.fromEntries(rows.map((r) => [r.full_name, r]));
    expect(facts["Jane Q Doe"]).toMatchObject({ role_rank: 1, avoid_emailing_first: false });
    // 'Vice President' must not ride the 'president' regex into rank 1.
    expect(facts["Vic President"]?.role_rank).toBe(3);
    expect(facts["Carl Compliance"]?.avoid_emailing_first).toBe(true);
  });

  it("person_facts role_rank branches on company niche", async () => {
    await runPeopleImport(
      db(),
      new ListSource([
        person({ title: "Partner" }),
        person({
          fullName: "Hank Ops",
          firstName: "Hank",
          lastName: "Ops",
          title: "Head of Operations",
        }),
      ]),
      { niche: "sec_ria" },
    );
    await runPeopleImport(
      db(),
      new ListSource([
        person({
          companySourceKey: "x:1",
          companyName: "Untagged Co",
          fullName: "Pat Partner",
          firstName: "Pat",
          lastName: "Partner",
          title: "Partner",
        }),
        person({
          companySourceKey: "x:1",
          companyName: "Untagged Co",
          fullName: "Hana Ops",
          firstName: "Hana",
          lastName: "Ops",
          title: "Head of Operations",
        }),
      ]),
    );
    await runPeopleImport(
      db(),
      new ListSource([
        person({
          companySourceKey: "clutch:studio",
          companyName: "Studio",
          fullName: "Mandy Director",
          firstName: "Mandy",
          lastName: "Director",
          title: "Managing Director",
        }),
        person({
          companySourceKey: "clutch:studio",
          companyName: "Studio",
          fullName: "Hope Ops",
          firstName: "Hope",
          lastName: "Ops",
          title: "Head of Operations",
        }),
      ]),
      { niche: "agencies" },
    );
    expect((await companyByKey("crd:9001")).niche).toBe("sec_ria"); // stamped from the source format at the edge
    expect((await companyByKey("x:1")).niche).toBeNull();

    const rows = await db().execute<{
      full_name: string;
      company_niche: string | null;
      role_rank: number | null;
    }>(
      sql`SELECT full_name, company_niche, role_rank FROM person_facts WHERE company_source_key IN ('crd:9001', 'x:1', 'clutch:studio')`,
    );
    const facts = Object.fromEntries(rows.map((r) => [r.full_name, r]));
    expect(facts["Jane Q Doe"]).toMatchObject({ company_niche: "sec_ria", role_rank: 2 }); // sec_ria: partner tier
    expect(facts["Hank Ops"]?.role_rank).toBeNull(); // 'head of' is not an RIA title
    expect(facts["Pat Partner"]).toMatchObject({ company_niche: null, role_rank: null }); // generic: bare 'partner' unranked
    expect(facts["Hana Ops"]?.role_rank).toBe(3); // generic: 'head of' -> director tier
    // agencies rank managing director as the owner tier and the ops lead above the directors.
    expect(facts["Mandy Director"]).toMatchObject({ company_niche: "agencies", role_rank: 1 });
    expect(facts["Hope Ops"]?.role_rank).toBe(2);
  });

  it("keyed row never merges through a shared domain", async () => {
    await db()
      .insert(companies)
      .values({ sourceKey: "crd:9050", domain: "sharedtamp.example", name: "First Firm", raw: {} });
    const { batch, stats } = await runPeopleImport(
      db(),
      new ListSource([
        person({
          companySourceKey: "crd:9051",
          companyName: "Second Firm",
          companyDomain: "sharedtamp.example",
        }),
      ]),
    );
    // The key ALONE decides: a new company is minted; the domain claim is recorded, not stolen.
    expect(stats).toMatchObject({ companies_created: 1, company_domain_conflicts: 1 });
    expect((await companyByKey("crd:9051")).domain).toBeNull();
    expect((await companyByKey("crd:9050")).domain).toBe("sharedtamp.example");
    const error = await one(
      db().select().from(importErrors).where(eq(importErrors.importId, batch.id)),
    );
    expect(error.kind).toBe("domain_conflict");
  });
});
