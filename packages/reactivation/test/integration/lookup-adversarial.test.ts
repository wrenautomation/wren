/**
 * Adversarial tests for `crm lookup` against a throwaway Postgres: who gets
 * picked, with which address verdict, and how the runner behaves when a store
 * write or a pace refusal goes wrong. Tests state what SHOULD happen.
 */
import { people } from "@wren/core";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { documents, findings, personLookups } from "@wren/research/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CRM_FORMATS } from "../../src/crm/formats.js";
import { runCrmImport } from "../../src/crm/import.js";
import { CrmCsvSource } from "../../src/crm/source.js";
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

const importCsv = async (rows: string[], name = "export.csv") => {
  const f = CRM_FORMATS.get("crm-generic");
  if (!f) throw new Error("crm-generic");
  await runCrmImport(
    db(),
    new CrmCsvSource(
      f,
      name,
      new TextEncoder().encode(["ID,Name,Email,Company,Website", ...rows].join("\n")),
    ),
  );
};

/** A verdict on a CRM address, at a given time. */
const verdict = async (email: string, result: string, verifier: string, at: string) => {
  await db().execute(sql`
    insert into verifications (contact_candidate_id, email, verifier, result, raw, checked_at)
    select id, email, ${verifier}, ${result}, '{}'::jsonb, ${at}::timestamptz
    from contact_candidates where email = ${email}`);
};

const personId = async (fullName: string) =>
  (await db().select().from(people).where(eq(people.fullName, fullName)))[0]?.id ?? -1;

type Web = (q: string, call: number) => unknown;
/** web answers from `web`; linkedin always 404s unless given. */
function sites(web: Web) {
  let n = 0;
  const calls: string[] = [];
  const client: SiteClient = {
    async call(site, method, path, input = {}) {
      calls.push(`${site} ${path}`);
      if (site === "web") return web(String((input as { q?: string }).q ?? ""), n++) as never;
      throw new SiteCallError(site, method, path, 404, "no route");
    },
    async via() {
      return "api";
    },
  };
  return { client, calls };
}
const noHits = () => ({ query: "q", hits: [], via: "ddg", tried: ["ddg"] });

describe("crmLookupSubjects: which verdict rides with the person", () => {
  it("prefers the verdict on the firm's own address over a later freemail verdict", async () => {
    await importCsv([
      "1,Jane Doe,jane@acmestaffing.com,Acme Staffing,https://acmestaffing.com",
      "2,Jane Doe,jane.doe@gmail.com,Acme Staffing,https://acmestaffing.com",
    ]);
    await verdict("jane@acmestaffing.com", "invalid", "smtp", "2026-09-01T00:00:00Z");
    await verdict("jane.doe@gmail.com", "valid", "smtp", "2026-09-02T00:00:00Z");
    const subjects = await crmLookupSubjects(db());
    expect(subjects).toHaveLength(1); // one person, two CRM addresses
    // The work mailbox rejecting mail is the signal R7 step 1 wants; the gmail verdict says nothing.
    expect(subjects[0]?.email?.address).toBe("jane@acmestaffing.com");
  });

  it("a live mailbox at another firm's domain is not stored as 'still there' at this firm", async () => {
    await importCsv(["1,Jane Doe,jane@globex.com,Acme Staffing,https://acmestaffing.com"]);
    await verdict("jane@globex.com", "valid", "smtp", "2026-09-01T00:00:00Z");
    const { client } = sites(noHits);
    await lookUpCrmPeople(db(), client, { linkedin: null, concurrency: 1 });
    const rows = await db().select().from(findings);
    expect(rows.filter((f) => f.kind === "still_there")).toEqual([]);
  });

  it("holds: capped with no retry_at is due; capped and due later is not; again picks all", async () => {
    await importCsv([
      "1,Jane Doe,jane@acmestaffing.com,Acme Staffing,https://acmestaffing.com",
      "2,Bob Roe,bob@acmestaffing.com,Acme Staffing,https://acmestaffing.com",
      "3,Ann Poe,ann@globex.com,Globex,https://globex.com",
    ]);
    const [jane, bob, ann] = [
      await personId("Jane Doe"),
      await personId("Bob Roe"),
      await personId("Ann Poe"),
    ];
    await db()
      .insert(personLookups)
      .values([
        { personId: jane, state: "capped", tried: [], retryAt: null },
        { personId: bob, state: "capped", tried: [], retryAt: new Date(Date.now() + 3_600_000) },
        { personId: ann, state: "unresolved", tried: [] },
      ]);
    expect((await crmLookupSubjects(db())).map((s) => s.personId)).toEqual([jane]);
    expect((await crmLookupSubjects(db(), { again: true })).map((s) => s.personId)).toEqual([
      jane,
      bob,
      ann,
    ]);
    expect(await crmLookupSubjects(db(), { again: true, limit: 1 })).toHaveLength(1);
  });

  it("holds: the latest CRM row's firm, and no verdict means no email", async () => {
    await importCsv(["1,Jane Doe,,Acme Staffing,https://acmestaffing.com"]);
    const [s] = await crmLookupSubjects(db());
    expect(s).toMatchObject({
      firstName: "Jane",
      lastName: "Doe",
      firm: { name: "Acme Staffing", domain: "acmestaffing.com" },
      email: null,
    });
  });
});

describe("lookUpCrmPeople: runner edges", () => {
  it("a NUL byte in a result is dropped, not a failed write", async () => {
    await importCsv([
      "1,Jane Doe,,Acme Staffing,https://acmestaffing.com",
      "2,Bob Roe,,Acme Staffing,https://acmestaffing.com",
    ]);
    // A NUL byte in a result: Postgres text/jsonb refuse it.
    const { client } = sites((q) =>
      q.includes("Jane")
        ? {
            query: q,
            hits: [
              {
                title: "Jane Doe - Account Manager - Globex | LinkedIn",
                url: "https://www.linkedin.com/in/janedoe/",
                snippet: "Experience: Globex\u0000 · Past: Acme Staffing",
              },
            ],
            via: "ddg",
            tried: ["ddg"],
          }
        : noHits(),
    );
    const stats = await lookUpCrmPeople(db(), client, { linkedin: null, concurrency: 1 });
    expect(stats).toMatchObject({ errors: 0, matched: 1, unresolved: 1 });
    const [doc] = await db().select().from(documents);
    expect(doc?.text).not.toContain("\u0000");
  });

  it("a seconds-long pace refusal from search does not abort the whole run", async () => {
    await importCsv([
      "1,Jane Doe,,Acme Staffing,https://acmestaffing.com",
      "2,Bob Roe,,Acme Staffing,https://acmestaffing.com",
      "3,Ann Poe,,Globex,https://globex.com",
    ]);
    const { client } = sites((_q, call) => {
      if (call === 0)
        throw new SiteCallError(
          "web",
          "GET",
          "/search",
          429,
          "web pace for the default account: too many calls queued; retry after 1s",
        );
      return noHits();
    });
    const stats = await lookUpCrmPeople(db(), client, { linkedin: null, concurrency: 1 });
    // Waited out and asked again: nobody is lost to pacing.
    expect(stats).toMatchObject({ aborted: null, unresolved: 3, errors: 0 });
  });

  it("holds: a search cap stores the capped person with retry_at and stops the run", async () => {
    await importCsv([
      "1,Jane Doe,,Acme Staffing,https://acmestaffing.com",
      "2,Bob Roe,,Acme Staffing,https://acmestaffing.com",
    ]);
    const { client, calls } = sites(() => {
      throw new SiteCallError("web", "GET", "/search", 429, "search cap used; retry after 7200s");
    });
    const stats = await lookUpCrmPeople(db(), client, { linkedin: null, concurrency: 1 });
    expect(stats).toMatchObject({ capped: 1, aborted: expect.stringMatching(/web capped/) });
    expect(calls).toHaveLength(1);
    const rows = await db().select().from(personLookups);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("capped");
    expect(rows[0]?.retryAt).not.toBeNull();
  });

  it("holds: a re-run with again keeps one document and one finding per fact", async () => {
    await importCsv(["1,Jane Doe,,Acme Staffing,https://acmestaffing.com"]);
    const { client } = sites((q) => ({
      query: q,
      hits: [
        {
          title: "Jane Doe - Account Manager - Globex | LinkedIn",
          url: "https://ca.linkedin.com/in/JaneDoe?trk=x",
          snippet: "Experience: Globex · Past: Acme Staffing",
        },
      ],
      via: "ddg",
      tried: ["ddg"],
    }));
    await lookUpCrmPeople(db(), client, { linkedin: null, concurrency: 1 });
    await lookUpCrmPeople(db(), client, { linkedin: null, concurrency: 1, again: true });
    expect(await db().select().from(documents)).toHaveLength(1);
    expect(await db().select().from(findings)).toHaveLength(1);
    const [p] = await db().select().from(people);
    expect(p?.linkedinUrl).toBe("https://www.linkedin.com/in/janedoe/");
  });

  it("holds: five errors in a row abort even at concurrency 2, and nothing is written for them", async () => {
    await importCsv(
      ["Cy", "Di", "Ed", "Fi", "Gu", "Hu", "Io"].map(
        (n, i) => `${10 + i},${n} Test,,Hooli,https://hooli.com`,
      ),
    );
    const { client } = sites(() => {
      throw new SiteCallError("web", "GET", "/search", 502, "down");
    });
    const stats = await lookUpCrmPeople(db(), client, { linkedin: null, concurrency: 2 });
    expect(stats.aborted).toMatch(/5 errors in a row/);
    expect(stats.errors).toBeGreaterThanOrEqual(5);
    expect(stats.errors).toBeLessThan(7);
    expect(await db().select().from(personLookups)).toHaveLength(0);
  });
});
