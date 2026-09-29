/**
 * CRM import, health and verify against the migrated schema: numbers end to end,
 * re-import idempotence, duplicate people, the verify funnel and the health gate.
 */
import {
  contactCandidates,
  type EmailVerifier,
  FakeVerifier,
  type LocalCheck,
  type LocalCheckerLike,
  type Verdict,
  verifications,
} from "@wren/channel-email";
import { companies, importErrors, people } from "@wren/core";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CRM_FORMATS } from "../../src/crm/formats.js";
import { crmHealth } from "../../src/crm/health.js";
import { runCrmImport } from "../../src/crm/import.js";
import { CrmCsvSource } from "../../src/crm/source.js";
import { checkCrmEmails } from "../../src/crm/verify.js";
import { crmContacts } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() =>
  truncate(pg.db, [
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

const TODAY = new Date("2026-09-29T12:00:00Z");

const source = (csv: string, name = "crm-generic", path = "export.csv") => {
  const f = CRM_FORMATS.get(name);
  if (!f) throw new Error(name);
  return new CrmCsvSource(f, path, new TextEncoder().encode(csv));
};
const importCsv = (csv: string, name = "crm-generic") => runCrmImport(db(), source(csv, name));
const count = async (table: string) =>
  (await db().execute<{ n: number }>(sql.raw(`select count(*)::int n from ${table}`)))[0]?.n ?? -1;

/** Passes every address except those on a domain named in `dead`, or throws for `boom`. */
class StubChecker implements LocalCheckerLike {
  calls: string[] = [];
  constructor(private readonly dead: string[] = ["nomx.example"]) {}
  async check(email: string): Promise<LocalCheck> {
    this.calls.push(email);
    const domain = email.split("@")[1] ?? "";
    const failed = this.dead.includes(domain);
    return {
      email,
      failure: failed ? "no mx" : null,
      flags: [],
      mxHosts: failed ? [] : [`mx.${domain}`],
      mxPath: failed ? null : "mx",
      passed: !failed,
    };
  }
}

/** FakeVerifier that records calls and throws on any address containing `boom`. */
class CountingVerifier implements EmailVerifier {
  readonly name: string = "fake";
  readonly costsCredits = false;
  readonly calls: string[] = [];
  private readonly inner: FakeVerifier;
  constructor(
    readonly authoritative = true,
    private readonly boom: string | null = null,
  ) {
    this.inner = new FakeVerifier({ authoritative });
  }
  async verify(email: string): Promise<Verdict> {
    this.calls.push(email);
    if (this.boom && email.includes(this.boom)) throw new Error("provider down");
    return this.inner.verify(email);
  }
}

const candidateState = async (email: string) =>
  (await db().select().from(contactCandidates).where(eq(contactCandidates.email, email))).map(
    (c) => c.state,
  );
const verificationsFor = (email: string) =>
  db()
    .select()
    .from(verifications)
    .where(eq(verifications.email, email))
    .orderBy(asc(verifications.id));

const MESSY = [
  "ID,Name,Email,Company,Website,Title,Owner,Last Contacted",
  "1,Jane Doe,jane@acme.com,Acme,,VP Talent,Sam,2026-08-01",
  "2,JANE DOE,jane@acme.com,Acme,,,Sam,2025-12-01",
  "3,Bob Roe,bob@gmail.com,Acme,,,Kim,2025-01-15",
  "4,Ann Poe,info@globex.io,Globex,,CEO,Kim,2020-01-01",
  "5,Lee Moe,,Initech,,,,",
  "6,Ray Zoe,not-an-email,Hooli,https://hooli.com,,,",
  "7,,x@y.com,Y,,,,",
  "8,Solo Person,solo@gmail.com,,,,,",
].join("\n");

describe("import then health", () => {
  it("counts a messy export end to end", async () => {
    const { stats } = await importCsv(MESSY);
    expect(stats).toMatchObject({
      rows: 8,
      errors: 2,
      people_created: 5,
      people_seen: 1,
      crm_contacts: 6,
      candidates_added: 3,
      emails_missing: 1,
      emails_bad: 1,
    });
    const h = await crmHealth(db(), TODAY);
    expect(h).toMatchObject({
      rows: 6,
      people: 5,
      duplicateRows: 1,
      companies: 4,
      emails: { missing: 1, badSyntax: 1, freemail: 1, role: 1, shared: 1 },
      noTitle: 3,
      lastContacted: { under6mo: 1, from6to12mo: 1, from1to2y: 1, over2y: 1, never: 2 },
      verification: { valid: 0, invalid: 0, risky: 0, catch_all: 0, unchecked: 3 },
      importErrors: 2,
    });
    expect(h.owners).toHaveLength(3);
    expect(h.owners).toEqual(
      expect.arrayContaining([
        { owner: "Sam", rows: 2 },
        { owner: "Kim", rows: 2 },
        { owner: "(none)", rows: 2 },
      ]),
    );
    expect(h.gate.ok).toBe(false);
    expect(h.gate.reason).toMatch(/not verified/);
  });

  it("writes origin crm and evidence crm through the CHECK constraints", async () => {
    await importCsv(MESSY);
    const origins = await db().execute<{ origin: string }>(sql`select distinct origin from people`);
    expect(origins.map((r) => r.origin)).toEqual(["crm"]);
    const ev = await db().execute<{ evidence: string; state: string }>(
      sql`select distinct evidence, state from contact_candidates`,
    );
    expect([...ev]).toEqual([{ evidence: "crm", state: "candidate" }]);
    // The constraints still refuse what is not on the list.
    const [p] = await db().select().from(people).limit(1);
    await expect(
      db().execute(sql`update people set origin = 'bogus' where id = ${p?.id}`),
    ).rejects.toThrow();
    await expect(
      db().execute(sql`update contact_candidates set evidence = 'bogus'`),
    ).rejects.toThrow();
  });

  it("stores a 129-char CRM id without overflowing crm_key", async () => {
    const long = "9".repeat(129);
    await importCsv(`ID,Name,Email,Company\n${long},Jane Doe,jane@acme.com,Acme\n`);
    const [row] = await db().select().from(crmContacts);
    expect(row?.crmKey).toMatch(/^h:/);
  });

  it("buckets last contact by calendar months at a month end", async () => {
    // 6 months before Aug 31 is Feb 28; Mar 2 is inside the last six months.
    await importCsv("Name,Email,Company,Last Contacted\nJane Doe,jane@acme.com,Acme,2026-03-02\n");
    const h = await crmHealth(db(), new Date("2026-08-31T12:00:00Z"));
    expect(h.lastContacted.under6mo).toBe(1);
  });
});

describe("re-import", () => {
  it("doubles nothing when the same file lands twice", async () => {
    await importCsv(MESSY);
    const before = await crmHealth(db(), TODAY);
    const tables = ["crm_contacts", "people", "companies", "contact_candidates"];
    const counts = await Promise.all(tables.map(count));
    const { stats } = await importCsv(MESSY);
    expect(stats.replay_of).toBeDefined();
    expect(await Promise.all(tables.map(count))).toEqual(counts);
    const after = await crmHealth(db(), TODAY);
    expect(after).toEqual(before);
    expect(after.importErrors).toBe(2);
  });

  it("updates a CRM row in place when a later export changes it", async () => {
    await importCsv("ID,Name,Email,Company,Owner\n1,Jane Doe,jane@acme.com,Acme,Sam\n");
    await importCsv("ID,Name,Email,Company,Owner\n1,Jane Doe,jane@acme.com,Acme,Kim\n");
    const rows = await db().select().from(crmContacts);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.owner).toBe("Kim");
    expect(await count("contact_candidates")).toBe(1);
  });

  it("counts a repeated CRM id once, and says it repeated", async () => {
    const { stats } = await importCsv(
      "ID,Name,Email,Company\n7,A One,a@acme.com,Acme\n7,B Two,b@acme.com,Acme\n",
    );
    expect(stats).toMatchObject({ crm_contacts: 1, crm_ids_repeated: 1 });
    expect(await count("crm_contacts")).toBe(1);
  });

  it("keeps id-less rows at the same keys on re-import", async () => {
    const csv =
      "Name,Email,Company\nA B,a@acme.com,Acme\nA B,a@acme.com,Acme\nC D,c@acme.com,Acme\n";
    await importCsv(csv);
    await importCsv(csv);
    expect(await count("crm_contacts")).toBe(3);
    expect(await count("people")).toBe(2);
  });
});

describe("duplicate people", () => {
  it("makes one person, two CRM rows, two candidates for one contact on two rows", async () => {
    await importCsv(
      "ID,Name,Email,Company\n1,Jane Doe,jane@acme.com,Acme\n2,JANE DOE,j.doe@acme.com,ACME\n",
    );
    expect(await count("people")).toBe(1);
    expect(await count("crm_contacts")).toBe(2);
    expect(await count("contact_candidates")).toBe(2);
    const h = await crmHealth(db(), TODAY);
    expect(h).toMatchObject({ rows: 2, people: 1, duplicateRows: 1, emails: { shared: 0 } });
  });

  it("meets 'Doe, Jane' and 'Jane Doe' at one company as one person", async () => {
    await importCsv(
      'ID,Name,Email,Company\n1,Jane Doe,jane@acme.com,Acme\n2,"Doe, Jane",jane@acme.com,Acme\n',
    );
    expect(await count("people")).toBe(1);
  });

  it("counts a freemail row at a colleague's firm under that firm", async () => {
    await importCsv(
      "Name,Email,Company\nJane Doe,jane@acme.com,Acme\nBob Roe,bob@gmail.com,ACME\n",
    );
    expect(await count("companies")).toBe(1);
  });
});

describe("verify", () => {
  const FUNNEL = [
    "Name,Email,Company",
    "Val Id,ok@acme.com,Acme",
    "Dee Dead,dead+invalid@acme.com,Acme",
    "Rita Risk,maybe+risky@acme.com,Acme",
    "Cat All,cat+catchall@acme.com,Acme",
    "Lou Local,lou@nomx.example,Nomx",
  ].join("\n");

  it("routes each verdict: valid verified, invalid rejected, risky/catch-all open, local failure final", async () => {
    await importCsv(FUNNEL);
    const verifier = new CountingVerifier(true);
    const checker = new StubChecker();
    const stats = await checkCrmEmails(db(), verifier, checker);
    expect(stats).toEqual({
      selected: 5,
      local_invalid: 1,
      local_errors: 0,
      valid: 1,
      invalid: 1,
      risky: 1,
      catch_all: 1,
      aborted: null,
    });
    expect(verifier.calls).not.toContain("lou@nomx.example");
    expect(verifier.calls).toHaveLength(4);
    expect(await candidateState("ok@acme.com")).toEqual(["verified"]);
    expect(await candidateState("dead+invalid@acme.com")).toEqual(["rejected"]);
    expect(await candidateState("maybe+risky@acme.com")).toEqual(["candidate"]);
    expect(await candidateState("cat+catchall@acme.com")).toEqual(["candidate"]);
    expect(await candidateState("lou@nomx.example")).toEqual(["rejected"]);
    const [local] = await verificationsFor("lou@nomx.example");
    expect(local).toMatchObject({ verifier: "local", result: "invalid" });
    expect(local?.contactCandidateId).not.toBeNull();

    const h = await crmHealth(db(), TODAY);
    expect(h.verification).toEqual({ valid: 1, invalid: 2, risky: 1, catch_all: 1, unchecked: 0 });
    expect(h.gate.ok).toBe(false);
    expect(h.gate.deadShare).toBeCloseTo(0.4);
    expect(h.gate.reason).toMatch(/clean first/);
  });

  it("does not re-check on a second run, risky and catch-all included", async () => {
    await importCsv(FUNNEL);
    await checkCrmEmails(db(), new CountingVerifier(true), new StubChecker());
    const verifier = new CountingVerifier(true);
    const checker = new StubChecker();
    const again = await checkCrmEmails(db(), verifier, checker);
    expect(again.selected).toBe(0);
    expect(verifier.calls).toEqual([]);
    expect(checker.calls).toEqual([]);
    expect(await count("verifications")).toBe(5);
  });

  it("leaves a non-authoritative valid as a candidate", async () => {
    await importCsv("Name,Email,Company\nVal Id,ok@acme.com,Acme\n");
    await checkCrmEmails(db(), new CountingVerifier(false), new StubChecker());
    expect(await candidateState("ok@acme.com")).toEqual(["candidate"]);
  });

  it("aborts on a verifier throw, keeps what it checked, and resumes the rest", async () => {
    await importCsv(
      [
        "Name,Email,Company",
        "A One,a1@acme.com,Acme",
        "B Two,b2@acme.com,Acme",
        "C Boom,boom@acme.com,Acme",
        "D Four,d4@acme.com,Acme",
      ].join("\n"),
    );
    const stats = await checkCrmEmails(db(), new CountingVerifier(true, "boom"), new StubChecker());
    expect(stats.aborted).toMatch(/provider down/);
    expect(stats.valid).toBe(2);
    expect(await count("verifications")).toBe(2);
    expect(await candidateState("boom@acme.com")).toEqual(["candidate"]);
    expect(await candidateState("d4@acme.com")).toEqual(["candidate"]);

    const verifier = new CountingVerifier(true);
    const rest = await checkCrmEmails(db(), verifier, new StubChecker());
    expect(rest.selected).toBe(2);
    expect(verifier.calls.sort()).toEqual(["boom@acme.com", "d4@acme.com"]);
    expect(rest.aborted).toBeNull();
  });

  it("checks an address shared by two people once", async () => {
    await importCsv(
      "Name,Email,Company\nJane Doe,team@acme.com,Acme\nBob Roe,team@acme.com,Acme\n",
    );
    expect(await count("contact_candidates")).toBe(2);
    const verifier = new CountingVerifier(true);
    await checkCrmEmails(db(), verifier, new StubChecker());
    expect(verifier.calls).toEqual(["team@acme.com"]);
    expect(await candidateState("team@acme.com")).toEqual(["verified", "verified"]);
    expect(await count("verifications")).toBe(2);
  });

  it("lets an authoritative verifier check what a weaker one already saw", async () => {
    await importCsv("Name,Email,Company\nVal Id,ok@acme.com,Acme\n");
    await checkCrmEmails(db(), new CountingVerifier(false), new StubChecker());
    const strong = new (class extends CountingVerifier {
      override readonly name = "strong";
    })(true);
    await checkCrmEmails(db(), strong, new StubChecker());
    expect(strong.calls).toEqual(["ok@acme.com"]);
    expect(await candidateState("ok@acme.com")).toEqual(["verified"]);
  });

  it("reads the latest verdict per address", async () => {
    await importCsv("Name,Email,Company\nVal Id,ok@acme.com,Acme\n");
    await checkCrmEmails(db(), new CountingVerifier(true), new StubChecker());
    const [cand] = await db().select().from(contactCandidates);
    await db()
      .insert(verifications)
      .values({
        contactCandidateId: cand?.id as number,
        email: "ok@acme.com",
        verifier: "fake",
        result: "invalid",
        raw: {},
        checkedAt: new Date(Date.now() + 60_000),
      });
    const h = await crmHealth(db(), TODAY);
    expect(h.verification).toMatchObject({ valid: 0, invalid: 1 });
  });
});

describe("health gate", () => {
  const list = (n: number, dead: number, offset = 0) =>
    Array.from({ length: n }, (_, i) => {
      const k = i + offset;
      return `Person N${k},p${k}${i < dead ? "+invalid" : ""}@acme.com,Acme`;
    });

  it("moves from not verified to ok at 10% dead, then to clean first above it", async () => {
    await importCsv(["Name,Email,Company", ...list(10, 1)].join("\n"));
    expect((await crmHealth(db(), TODAY)).gate).toMatchObject({ ok: false, deadShare: null });

    await checkCrmEmails(db(), new CountingVerifier(true), new StubChecker());
    const ok = (await crmHealth(db(), TODAY)).gate;
    expect(ok).toMatchObject({ ok: true });
    expect(ok.deadShare).toBeCloseTo(0.1);

    // A second export adds one more dead address: 2 of 11.
    await runCrmImport(
      db(),
      source(["Name,Email,Company", ...list(1, 1, 50)].join("\n"), "crm-generic", "more.csv"),
    );
    await checkCrmEmails(db(), new CountingVerifier(true), new StubChecker());
    const clean = (await crmHealth(db(), TODAY)).gate;
    expect(clean.ok).toBe(false);
    expect(clean.deadShare).toBeCloseTo(2 / 11);
    expect(clean.reason).toMatch(/clean first/);
  });

  it("stays shut while any address is unchecked", async () => {
    await importCsv(["Name,Email,Company", ...list(4, 0)].join("\n"));
    await checkCrmEmails(db(), new CountingVerifier(true), new StubChecker(), { limit: 3 });
    const gate = (await crmHealth(db(), TODAY)).gate;
    expect(gate).toMatchObject({ ok: false, deadShare: 0 });
    expect(gate.reason).toMatch(/1 unchecked/);
  });

  it("stays shut when the export has no emails", async () => {
    await importCsv("Name,Company,Website\nA One,Acme,acme.com\n");
    expect((await crmHealth(db(), TODAY)).gate.reason).toMatch(/no emails/);
  });

  it("counts bad syntax as dead", async () => {
    await importCsv(
      ["Name,Email,Company", ...list(9, 0), "Bad One,bad@@acme.com,Acme", "Bad Two,nope,Acme"].join(
        "\n",
      ),
    );
    await checkCrmEmails(db(), new CountingVerifier(true), new StubChecker());
    const gate = (await crmHealth(db(), TODAY)).gate;
    expect(gate.ok).toBe(false);
    expect(gate.deadShare).toBeCloseTo(2 / 11);
  });

  it("says clean first, not 'run verify', when every address is bad syntax and verify has run", async () => {
    await importCsv(
      "Name,Email,Company,Website\nA One,nope,Acme,acme.com\nB Two,also nope,Acme,acme.com\n",
    );
    await checkCrmEmails(db(), new CountingVerifier(true), new StubChecker());
    const gate = (await crmHealth(db(), TODAY)).gate;
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/clean first/);
  });

  it("counts import errors only from CRM imports", async () => {
    await importCsv(MESSY);
    await db().execute(
      sql`insert into imports (source_type, source_ref, stats) values ('csv', 'x', '{}')`,
    );
    const [other] = await db().execute<{ id: number }>(
      sql`select id from imports where source_type = 'csv'`,
    );
    await db()
      .insert(importErrors)
      .values({
        importId: other?.id as number,
        rowNumber: 1,
        kind: "rejected",
        reason: "x",
        raw: {},
      });
    expect((await crmHealth(db(), TODAY)).importErrors).toBe(2);
    expect(await count("companies")).toBe((await db().select().from(companies)).length);
  });

  it("counts errors from the latest import of each file only", async () => {
    await importCsv(MESSY);
    await importCsv(`${MESSY}\n9,,z@y.com,Y,,,,`);
    expect((await crmHealth(db(), TODAY)).importErrors).toBe(3);
  });
});
