/**
 * Dossiers against the migrated schema: every table's facts land on the right
 * company or person, an older prompt's output is not a fact, the model call's
 * trail is left out, and lookups page by id.
 */
import { people } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  dossiers,
  dossierText,
  findCompanyIds,
  nicheCompanyIds,
  withFacts,
} from "../../src/dossier.js";
import { companyChecks, enrichments, findings, personLookups } from "../../src/schema.js";
import { makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["companies", "people", "findings", "enrichments", "runs"]));
const db = () => pg.db;

const day = (d: number) => new Date(Date.UTC(2026, 8, d));

async function seed() {
  const firm = await makeCompany(db(), { key: "a", domain: "firm.example", niche: "recruiting" });
  const other = await makeCompany(db(), {
    key: "b",
    domain: "other.example",
    name: "100% Staffing",
    niche: "recruiting",
  });
  const [jane] = await db()
    .insert(people)
    .values({
      companyId: firm.id,
      fullName: "Jane Doe",
      title: "Founder",
      isCompliance: false,
      origin: "website",
      originRef: "https://firm.example/team",
      raw: {},
    })
    .returning();
  if (!jane) throw new Error("no person");
  await db()
    .insert(findings)
    .values([
      {
        kind: "hiring",
        companyId: firm.id,
        factKey: "c:hiring",
        value: { roles: ["Recruiter"] },
        confidence: 0.9,
        via: "crawl",
        sourceUrl: "https://firm.example/careers",
        observedAt: day(3),
      },
      {
        kind: "post",
        personId: jane.id,
        factKey: "p:post",
        value: { text: "We placed 12 nurses" },
        confidence: 0.8,
        via: "linkedin@research",
        sourceUrl: "https://linkedin.example/p/1",
        observedAt: day(5),
      },
    ]);
  const call = { api: { model: "m" }, call: { usage: 1 }, raw_text: "{}", parsed: {} };
  await db()
    .insert(enrichments)
    .values([
      {
        companyId: firm.id,
        kind: "opener",
        model: "m",
        promptVersion: "v1",
        output: { ...call, opener: { line: "old" } },
        createdAt: day(1),
      },
      {
        companyId: firm.id,
        kind: "opener",
        model: "m",
        promptVersion: "v2",
        output: { ...call, opener: { line: "new" } },
        createdAt: day(2),
      },
    ]);
  await db()
    .insert(companyChecks)
    .values({ companyId: firm.id, state: "no_openings", tried: [], checkedAt: day(4) });
  await db()
    .insert(personLookups)
    .values({ personId: jane.id, state: "unresolved", tried: [], lookedUpAt: day(6) });
  return { firm, other, jane };
}

describe("dossiers", () => {
  it("puts each table's facts on its company or person, newest first", async () => {
    const { firm, other, jane } = await seed();
    const list = await dossiers(db(), [other.id, firm.id, 999_999, firm.id]);
    expect(list.map((d) => d.company.id)).toEqual([other.id, firm.id]);
    const d = list[1];
    if (!d) throw new Error("no dossier");
    expect(d.facts.map((f) => [f.what, f.via])).toEqual([
      ["hiring_check", "check"],
      ["hiring", "crawl"],
      ["opener", "m"],
    ]);
    expect(d.facts[2]?.value).toEqual({ opener: { line: "new" } });
    expect(d.facts[1]).toMatchObject({
      confidence: 0.9,
      source: "https://firm.example/careers",
    });
    expect(d.people).toHaveLength(1);
    expect(d.people[0]).toMatchObject({ id: jane.id, name: "Jane Doe", origin: "website" });
    expect(d.people[0]?.facts.map((f) => f.what)).toEqual(["profile_lookup", "post"]);
    expect(list[0]?.facts).toEqual([]);
    expect(dossierText(d)).toContain("Jane Doe, Founder [website]");
  });

  it("merges another layer's facts in date order", async () => {
    const { firm, jane } = await seed();
    const email = (d: number) => ({
      what: "email",
      value: { address: "jane@firm.example" },
      confidence: null,
      source: null,
      via: "mailifier",
      seenAt: day(d),
    });
    const [d] = withFacts(await dossiers(db(), [firm.id]), {
      byCompany: new Map([[firm.id, [email(10)]]]),
      byPerson: new Map([[jane.id, [email(4)]]]),
    });
    expect(d?.facts[0]?.what).toBe("email");
    expect(d?.people[0]?.facts.map((f) => f.what)).toEqual(["profile_lookup", "post", "email"]);
  });

  it("finds firms by id, domain or name, and pages a niche by id", async () => {
    const { firm, other } = await seed();
    expect(await findCompanyIds(db(), String(firm.id))).toEqual([firm.id]);
    expect(await findCompanyIds(db(), "FIRM.example")).toEqual([firm.id]);
    expect(await findCompanyIds(db(), "100%")).toEqual([other.id]);
    expect(await findCompanyIds(db(), "  ")).toEqual([]);
    expect(await nicheCompanyIds(db(), "recruiting", 1)).toEqual([firm.id]);
    expect(await nicheCompanyIds(db(), "recruiting", 5, firm.id)).toEqual([other.id]);
    expect(await nicheCompanyIds(db(), "agencies", 5)).toEqual([]);
  });
});
