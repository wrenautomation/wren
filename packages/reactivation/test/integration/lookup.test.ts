/**
 * `crm lookup` against the migrated schema: who gets picked, what lands in
 * findings / documents / person_lookups, and that re-runs resume, not repeat.
 */
import { FakeVerifier, type LocalCheckerLike } from "@wren/channel-email";
import { people } from "@wren/core";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { findings, personLookups } from "@wren/research/schema";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CRM_FORMATS } from "../../src/crm/formats.js";
import { runCrmImport } from "../../src/crm/import.js";
import { CrmCsvSource } from "../../src/crm/source.js";
import { checkCrmEmails } from "../../src/crm/verify.js";
import { crmLookupSubjects, lookUpCrmPeople } from "../../src/lookup.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() =>
  truncate(pg.db, [
    "findings",
    "person_lookups",
    "documents",
    "runs",
    "verifications",
    "contact_candidates",
    "crm_contacts",
    "sightings",
    "import_errors",
    "people",
    "companies",
    "imports",
  ]),
);
const db = () => pg.db;

const CSV = [
  "ID,Name,Email,Company,Website",
  "1,Jane Doe,jane@acmestaffing.com,Acme Staffing,https://acmestaffing.com",
  "2,Bob Roe,bob@acmestaffing.com,Acme Staffing,https://acmestaffing.com",
  "3,Ann Poe,ann@gmail.com,Globex Search,https://globexsearch.com",
].join("\n");

const importCsv = async () => {
  const f = CRM_FORMATS.get("crm-generic");
  if (!f) throw new Error("crm-generic");
  await runCrmImport(db(), new CrmCsvSource(f, "export.csv", new TextEncoder().encode(CSV)));
};
const passAll: LocalCheckerLike = {
  async check(email) {
    return { email, failure: null, flags: [], mxHosts: ["mx"], mxPath: "mx", passed: true };
  },
};
const personId = async (fullName: string) =>
  (await db().select().from(people).where(eq(people.fullName, fullName)))[0]?.id ?? -1;

/** Search finds Jane at Globex; Bob and Ann come back empty; LinkedIn is capped (or failing). */
function sites(opts: { searchDown?: boolean; linkedinDown?: boolean } = {}) {
  const calls: string[] = [];
  const client: SiteClient = {
    async call(site, method, path, input = {}) {
      calls.push(`${site} ${path}`);
      if (opts.searchDown) throw new SiteCallError(site, method, path, 502, "backend down");
      if (site === "web") {
        const q = String((input as { q?: string }).q ?? "");
        const found = q.includes("Jane")
          ? [
              {
                name: "Jane Doe",
                url: "https://ca.linkedin.com/in/janedoe",
                roles: [
                  { title: "Account Manager", company: "Globex", current: true },
                  { title: "Recruiter", company: "Acme Staffing", current: false },
                ],
              },
            ]
          : [];
        return { query: q, people: found, via: "exa" } as never;
      }
      if (opts.linkedinDown) throw new SiteCallError(site, method, path, 502, "read failed");
      throw new SiteCallError(site, method, path, 429, "cap used; retry after 3600s");
    },
    async via() {
      return "api";
    },
  };
  return { client, calls };
}

describe("crm lookup", () => {
  beforeEach(async () => {
    await importCsv();
    await checkCrmEmails(db(), new FakeVerifier({ authoritative: true }), passAll);
  });

  it("picks each CRM person once, with firm and latest verdict", async () => {
    const subjects = await crmLookupSubjects(db());
    expect(subjects.map((s) => [s.firstName, s.firm.domain, s.email?.result])).toEqual([
      ["Jane", "acmestaffing.com", "valid"],
      ["Bob", "acmestaffing.com", "valid"],
      ["Ann", "globexsearch.com", "valid"],
    ]);
  });

  it("writes findings, the profile and where each lookup stands; a re-run picks nobody", async () => {
    const { client } = sites();
    const stats = await lookUpCrmPeople(db(), client, { linkedin: null, concurrency: 1 });
    expect(stats).toMatchObject({ selected: 3, matched: 1, unresolved: 2, capped: 0, errors: 0 });
    expect(stats.findings).toEqual({ still_there: 2, job_change: 1 });

    const jane = await personId("Jane Doe");
    const rows = await db()
      .select()
      .from(findings)
      .where(eq(findings.personId, jane))
      .orderBy(asc(findings.id));
    expect(rows.map((f) => [f.kind, f.via])).toEqual([
      ["still_there", "email"],
      ["job_change", "search"],
    ]);
    expect(rows[1]?.documentId).not.toBeNull();
    const [p] = await db().select().from(people).where(eq(people.id, jane));
    expect(p?.linkedinUrl).toBe("https://www.linkedin.com/in/janedoe/");

    const again = await lookUpCrmPeople(db(), client, { linkedin: null });
    expect(again.selected).toBe(0);
    const refresh = await lookUpCrmPeople(db(), client, { linkedin: null, again: true });
    expect(refresh.selected).toBe(3);
    // Seen again is the same fact, not a new row.
    expect((await db().select().from(findings)).length).toBe(3);
  });

  it("a LinkedIn cap parks people until it lifts, asking LinkedIn once", async () => {
    const { client, calls } = sites();
    const stats = await lookUpCrmPeople(db(), client, {
      linkedin: "linkedin@research",
      concurrency: 1,
    });
    // Jane is settled by search; Bob hits the cap; Ann parks without asking.
    expect(stats).toMatchObject({ matched: 1, capped: 2, aborted: null });
    expect(calls.filter((c) => c.startsWith("linkedin"))).toHaveLength(1);
    const parked = await db().select().from(personLookups).where(eq(personLookups.state, "capped"));
    expect(parked).toHaveLength(2);
    expect(await crmLookupSubjects(db())).toEqual([]);

    await db().execute(sql`update person_lookups set retry_at = now() - interval '1 minute'`);
    expect((await crmLookupSubjects(db())).map((s) => s.firstName)).toEqual(["Bob", "Ann"]);
  });

  it("a failed LinkedIn read stops the stage: one spent, no second", async () => {
    const { client, calls } = sites({ linkedinDown: true });
    const stats = await lookUpCrmPeople(db(), client, {
      linkedin: "linkedin@research",
      concurrency: 1,
    });
    expect(calls.filter((c) => c.startsWith("linkedin"))).toHaveLength(1);
    expect(stats.errors).toBe(1);
    expect(stats.aborted).toMatch(/LinkedIn failed a read/);
  });

  it("stops after a streak of errors and writes nothing for them", async () => {
    await runCrmImport(
      db(),
      new CrmCsvSource(
        CRM_FORMATS.get("crm-generic") ?? (null as never),
        "more.csv",
        new TextEncoder().encode(
          [
            "ID,Name,Email,Company",
            ...["Cy", "Di", "Ed", "Fi", "Gu"].map((n, i) => `${10 + i},${n} Test,,Hooli`),
          ].join("\n"),
        ),
      ),
    );
    const { client } = sites({ searchDown: true });
    const stats = await lookUpCrmPeople(db(), client, { linkedin: null, concurrency: 1 });
    expect(stats.errors).toBe(5);
    expect(stats.aborted).toMatch(/5 errors in a row/);
    expect((await db().select().from(personLookups)).length).toBe(0);
  });
});
