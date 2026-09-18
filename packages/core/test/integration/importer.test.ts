/**
 * Importer against the migrated schema: classification, dedupe, suppression,
 * company provenance, sightings, import_errors rows. Tables are truncated between tests.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runImport } from "../../src/ingest/importer.js";
import { IDENTITY_KEY, type RawRow } from "../../src/ingest/schema.js";
import { CsvLeadSource, type LeadSource } from "../../src/ingest/sources.js";
import {
  companies,
  importErrors,
  leads,
  type Suppression,
  sightings,
  suppressions,
} from "../../src/schema.js";

let pg: TestPostgres;
const dir = mkdtempSync(join(tmpdir(), "wren-importer-"));
let n = 0;

const csvQuote = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
function writeCsv(header: string[], rows: string[][]): string {
  const path = join(dir, `f${n++}.csv`);
  writeFileSync(path, `${[header, ...rows].map((r) => r.map(csvQuote).join(",")).join("\n")}\n`);
  return path;
}

/** Adapter-shaped source: keys are minted into the identity channel; the raw cell rides along as inert provenance. */
class SourceKeyedSource implements LeadSource {
  readonly sourceType = "fake_registry";
  readonly sourceRef = "memory";
  readonly contentHash?: string;
  constructor(
    private readonly data: RawRow[],
    contentHash?: string,
  ) {
    if (contentHash !== undefined) this.contentHash = contentHash;
  }
  *rows() {
    for (const row of this.data) {
      const out = { ...row };
      const key = out.source_key;
      if (key) out[IDENTITY_KEY] = { source_key: key };
      yield out;
    }
  }
}

const db = () => pg.db;
/** Test-side non-null: a missing row is a failed test, so it throws. */
function must<T>(v: T | undefined, what = "row"): T {
  if (v === undefined) throw new Error(`expected ${what}`);
  return v;
}
const leadByEmail = async (email: string) =>
  must((await db().select().from(leads).where(eq(leads.email, email)))[0], email);
const findCompanyByDomain = async (domain: string) =>
  (await db().select().from(companies).where(eq(companies.domain, domain)))[0];
const companyByDomain = async (domain: string) => must(await findCompanyByDomain(domain), domain);
const companyByKey = async (key: string) =>
  must((await db().select().from(companies).where(eq(companies.sourceKey, key)))[0], key);
const companyById = async (id: number) =>
  must((await db().select().from(companies).where(eq(companies.id, id)))[0], `company ${id}`);
const errorsOf = (importId: number) =>
  db().select().from(importErrors).where(eq(importErrors.importId, importId));

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["imports", "companies", "leads", "suppressions"]));

describe("runImport", () => {
  it("mixed csv import", async () => {
    const path = writeCsv(
      ["Email", "First Name", "Title", "Company", "Website", "City"],
      [
        ["jane@lobsterpots.example", "Jane", "Owner", "Pots", "lobsterpots.example", "Austin"],
        ["", "", "", "Bar Inc", "https://www.barinc.example", ""],
        ["bob@bazco.example", "Bob", "", "", "", ""],
        ["jane@lobsterpots.example", "Jane", "", "", "", ""],
        ["not-an-email", "", "", "", "", ""],
      ],
    );
    const { batch, stats } = await runImport(db(), new CsvLeadSource(path), {
      defaults: { source: "niche-db", country: "US" },
    });
    expect(stats).toMatchObject({
      rows: 5,
      leads_created: 2,
      duplicate_leads: 1,
      companies_created: 3,
      errors: 1,
    });

    const jane = await leadByEmail("jane@lobsterpots.example");
    expect(jane).toBeDefined();
    expect(jane.status).toBe("imported");
    expect(jane.geo).toBe("Austin");
    expect(jane.source).toBe("niche-db"); // segment default filled the gap
    expect(jane.country).toBe("US");
    expect((await companyById(jane.companyId as number)).domain).toBe("lobsterpots.example");
    expect((jane.raw as RawRow).Email).toBe("jane@lobsterpots.example");

    // The duplicate row (4) is a sighting of jane, full row kept.
    const sighting = must(
      (await db().select().from(sightings).where(eq(sightings.leadId, jane.id)))[0],
    );
    expect(sighting.importId).toBe(batch.id);
    expect(sighting.rowNumber).toBe(4);
    expect((sighting.raw as RawRow)["First Name"]).toBe("Jane");

    // The rejected row (5) lands in import_errors with its content.
    const errors = await errorsOf(batch.id);
    expect(errors).toHaveLength(1);
    const err = must(errors[0]);
    expect(err.kind).toBe("rejected");
    expect(err.rowNumber).toBe(5);
    expect(err.reason).toContain("not-an-email");
    expect((err.raw as RawRow).Email).toBe("not-an-email");

    const bar = await companyByDomain("barinc.example");
    expect(bar.name).toBe("Bar Inc");
    expect(bar.importId).toBe(batch.id); // bare company rows carry provenance
    expect((bar.raw as RawRow).Company).toBe("Bar Inc");

    const bob = await leadByEmail("bob@bazco.example");
    const bobCo = await companyById(bob.companyId as number);
    expect(bobCo.domain).toBe("bazco.example");
    expect(bobCo.importId).toBe(batch.id);
  });

  it("suppression at the edge", async () => {
    const [optout, eveOptout, spamDomain] = (await db()
      .insert(suppressions)
      .values([
        { kind: "email", value: "jane@optout.example", reason: "opt_out" },
        { kind: "email", value: "eve@nastyspam.example", reason: "opt_out" },
        { kind: "domain", value: "nastyspam.example", reason: "manual" },
      ])
      .returning()) as [Suppression, Suppression, Suppression];
    const path = writeCsv(
      ["Email", "Company", "Website"],
      [
        ["jane@optout.example", "", ""], // suppressed email
        ["bob@nastyspam.example", "", ""], // suppressed mailbox domain
        ["", "Nasty Spam", "nastyspam.example"], // suppressed-domain company row
        ["carol@gmail.com", "", "nastyspam.example"], // suppressed business domain
        ["eve@nastyspam.example", "", ""], // two rules match; exact address wins
        ["dave@cleanco.example", "", ""],
      ],
    );
    const { stats } = await runImport(db(), new CsvLeadSource(path));
    // Suppression gates sending, not storage: the counter is kept but the row is stored.
    expect(stats).toMatchObject({
      leads_created: 1,
      leads_suppressed: 4,
      companies_created: 3,
      companies_suppressed: 1,
    });

    const nasty = await companyByDomain("nastyspam.example");
    expect(nasty.name).toBe("Nasty Spam");

    const all = Object.fromEntries((await db().select().from(leads)).map((l) => [l.email, l]));
    const L = (email: string) => must(all[email], email);
    expect(L("jane@optout.example").suppressionId).toBe(optout.id);
    expect(L("bob@nastyspam.example").suppressionId).toBe(spamDomain.id);
    expect(L("carol@gmail.com").suppressionId).toBe(spamDomain.id);
    expect(L("eve@nastyspam.example").suppressionId).toBe(eveOptout.id);
    for (const email of [
      "jane@optout.example",
      "bob@nastyspam.example",
      "carol@gmail.com",
      "eve@nastyspam.example",
    ]) {
      expect(L(email).status).toBe("suppressed");
    }
    // A suppressed business domain still gets its company created/linked.
    for (const email of ["bob@nastyspam.example", "carol@gmail.com", "eve@nastyspam.example"]) {
      expect(L(email).companyId).toBe(nasty.id);
    }
    expect(L("dave@cleanco.example").status).toBe("imported");
    expect(L("dave@cleanco.example").suppressionId).toBeNull();
  });

  it("revoked suppression no longer gates", async () => {
    await db().insert(suppressions).values({
      kind: "email",
      value: "jane@wasoptout.example",
      reason: "opt_out",
      revokedAt: new Date(),
    });
    const path = writeCsv(["Email"], [["jane@wasoptout.example"]]);
    const { stats } = await runImport(db(), new CsvLeadSource(path));
    expect(stats.leads_suppressed).toBe(0);
    const lead = await leadByEmail("jane@wasoptout.example");
    expect(lead.status).toBe("imported");
    expect(lead.suppressionId).toBeNull();
  });

  it("niche stamped at create, blank-filled, never overwritten", async () => {
    await runImport(
      db(),
      new CsvLeadSource(
        writeCsv(
          ["Email", "Company", "Website"],
          [["ana@firma.example", "Firm A", "firma.example"]],
        ),
      ),
      { niche: "sec_ria" },
    );
    expect((await companyByDomain("firma.example")).niche).toBe("sec_ria");

    await runImport(
      db(),
      new CsvLeadSource(
        writeCsv(
          ["Email", "Company", "Website"],
          [["ana2@firma.example", "Firm A", "firma.example"]],
        ),
      ),
      { niche: "agencies" },
    );
    expect((await companyByDomain("firma.example")).niche).toBe("sec_ria"); // first claim stands

    await db().insert(companies).values({ domain: "firmb.example", name: "Firm B", raw: {} }); // pre-niche shape
    await runImport(
      db(),
      new CsvLeadSource(
        writeCsv(
          ["Email", "Company", "Website"],
          [["bo@firmb.example", "Firm B", "firmb.example"]],
        ),
      ),
      { niche: "agencies" },
    );
    expect((await companyByDomain("firmb.example")).niche).toBe("agencies"); // NULL blank-filled
  });

  it("source-keyed firm imports domainless, then gains a domain", async () => {
    const profile = "https://linkedin.com/company/causey-wealth";
    const first = await runImport(
      db(),
      new SourceKeyedSource([
        { company_name: "Causey Wealth", website: profile, source_key: "crd:42" },
      ]),
    );
    expect(first.stats).toMatchObject({ companies_created: 1, errors: 0 });
    expect(first.batch.contentHash).toBeNull(); // source without hashing stays honest
    let company = await companyByKey("crd:42");
    expect(company.domain).toBeNull(); // a profile URL never keys a company
    expect(company.socialUrl).toBe(profile);
    expect((company.raw as RawRow).website).toBe(profile);

    // Next roster lists the real site: matched by source_key, domain filled in place.
    const second = await runImport(
      db(),
      new SourceKeyedSource(
        [{ company_name: "Causey Wealth", website: "causeywealth.example", source_key: "crd:42" }],
        "a".repeat(64),
      ),
    );
    expect(second.stats).toMatchObject({ companies_created: 0, companies_seen: 1 });
    expect(second.batch.contentHash).toBe("a".repeat(64));
    company = await companyByKey("crd:42");
    expect(company.domain).toBe("causeywealth.example");
    expect(company.socialUrl).toBe(profile); // earlier claim stands

    const sighting = must(
      (await db().select().from(sightings).where(eq(sightings.companyId, company.id)))[0],
    );
    expect(sighting.importId).toBe(second.batch.id);
    expect(sighting.rowNumber).toBe(1);
    expect((sighting.raw as RawRow).website).toBe("causeywealth.example");
  });

  it("source_key never folds into a domain match", async () => {
    await runImport(
      db(),
      new CsvLeadSource(writeCsv(["Company", "Website"], [["Foo", "foo.example"]])),
    );
    const { stats } = await runImport(
      db(),
      new SourceKeyedSource([
        { company_name: "Foo Advisors", website: "foo.example", source_key: "crd:7" },
      ]),
    );
    expect(stats).toMatchObject({ companies_created: 1, companies_seen: 0, domain_conflicts: 1 });
    expect((await companyByDomain("foo.example")).sourceKey).toBeNull();
    expect((await companyByKey("crd:7")).domain).toBeNull();
  });

  it("source-keyed firms sharing a domain stay distinct", async () => {
    const { batch, stats } = await runImport(
      db(),
      new SourceKeyedSource([
        { company_name: "Guggenheim", website: "shared.example", source_key: "crd:1" },
        { company_name: "Folger Nolan", website: "shared.example", source_key: "crd:2" },
      ]),
    );
    expect(stats).toMatchObject({ companies_created: 2, domain_conflicts: 1 });
    const first = await companyByKey("crd:1");
    const second = await companyByKey("crd:2");
    expect(first.domain).toBe("shared.example");
    expect(second.id).not.toBe(first.id);
    expect(second.domain).toBeNull();

    const conflict = must((await errorsOf(batch.id))[0]);
    expect(conflict.kind).toBe("domain_conflict");
    expect(conflict.rowNumber).toBe(2);
    expect(conflict.reason).toContain("shared.example");
    expect(conflict.reason).toContain("crd:1");
    expect(conflict.reason).toContain("crd:2");
    expect((conflict.raw as RawRow).source_key).toBe("crd:2");
    // Conflict parties as FKs: company_id is the domain owner, claimant_company_id the declined row.
    expect(conflict.companyId).toBe(first.id);
    expect(conflict.claimantCompanyId).toBe(second.id);
  });

  it("duplicate lead sighting keeps the fresh row", async () => {
    await runImport(db(), new CsvLeadSource(writeCsv(["Email"], [["pat@haulco.example"]])));
    const { batch, stats } = await runImport(
      db(),
      new CsvLeadSource(
        writeCsv(["Email", "First Name", "Last Name"], [["pat@haulco.example", "Pat", "Hauler"]]),
      ),
    );
    expect(stats.duplicate_leads).toBe(1);
    const pat = await leadByEmail("pat@haulco.example");
    expect(pat.firstName).toBeNull(); // scalar columns keep the first claim
    const sighting = must(
      (await db().select().from(sightings).where(eq(sightings.leadId, pat.id)))[0],
    );
    expect(sighting.importId).toBe(batch.id);
    expect(sighting.rowNumber).toBe(1);
    expect((sighting.raw as RawRow)["First Name"]).toBe("Pat");
  });

  it("reimport dedupes and backfills company name", async () => {
    await runImport(
      db(),
      new CsvLeadSource(
        writeCsv(["Email", "Website"], [["jane@quietmill.example", "quietmill.example"]]),
      ),
    );
    let company = await companyByDomain("quietmill.example");
    expect(company.name).toBeNull();

    const { batch, stats } = await runImport(
      db(),
      new CsvLeadSource(
        writeCsv(
          ["Email", "Company", "Website"],
          [
            ["jane@quietmill.example", "", ""], // already imported
            ["", "Quiet Mill", "quietmill.example"], // backfills the missing name
          ],
        ),
      ),
    );
    // Two matches against the same company: the duplicate lead's own business domain and the bare company row.
    expect(stats).toMatchObject({ duplicate_leads: 1, companies_created: 0, companies_seen: 2 });
    company = await companyByDomain("quietmill.example");
    expect(company.name).toBe("Quiet Mill");

    const byRow = Object.fromEntries(
      (await db().select().from(sightings).where(eq(sightings.companyId, company.id))).map((s) => [
        s.rowNumber,
        s,
      ]),
    );
    expect(Object.keys(byRow).map(Number).sort()).toEqual([1, 2]);
    expect(must(byRow[1]).importId).toBe(batch.id);
    expect((must(byRow[2]).raw as RawRow).Company).toBe("Quiet Mill");
    const jane = await leadByEmail("jane@quietmill.example");
    expect(await db().select().from(sightings).where(eq(sightings.leadId, jane.id))).toHaveLength(
      1,
    );
  });

  it("generic csv source_key column cannot assert identity", async () => {
    await runImport(
      db(),
      new SourceKeyedSource([{ company_name: "Real Firm", source_key: "crd:99" }]),
    );
    const real = await companyByKey("crd:99");
    expect(real.domain).toBeNull();

    await runImport(
      db(),
      new CsvLeadSource(
        writeCsv(
          ["company_name", "website", "source_key"],
          [["Evil Co", "evil.example", "crd:99"]],
        ),
      ),
    );
    const again = await companyByKey("crd:99");
    expect(again.id).toBe(real.id);
    expect(again.domain).toBeNull(); // untouched
    const evil = await companyByDomain("evil.example");
    expect(evil.sourceKey).toBeNull(); // column present but never asserted
  });

  it("lead source_key matches the registry's company", async () => {
    await runImport(
      db(),
      new SourceKeyedSource([
        { company_name: "Causey Wealth", website: "causeywealth.example", source_key: "crd:1" },
      ]),
    );
    const company = await companyByKey("crd:1");
    await runImport(
      db(),
      new SourceKeyedSource([{ email: "jane@causeywealth.example", source_key: "crd:1" }]),
    );
    expect((await leadByEmail("jane@causeywealth.example")).companyId).toBe(company.id);
  });

  it("keyed match with changed domain is flagged, not applied", async () => {
    await runImport(
      db(),
      new SourceKeyedSource([
        { company_name: "Causey Wealth", website: "old.example", source_key: "crd:1" },
      ]),
    );
    const company = await companyByKey("crd:1");
    expect(company.domain).toBe("old.example");

    const { batch } = await runImport(
      db(),
      new SourceKeyedSource([
        { company_name: "Causey Wealth", website: "new.example", source_key: "crd:1" },
      ]),
    );
    expect((await companyByKey("crd:1")).domain).toBe("old.example"); // never auto-changed
    const error = must((await errorsOf(batch.id))[0]);
    expect(error.kind).toBe("domain_changed");
    expect(error.companyId).toBe(company.id);
    expect(error.claimantCompanyId).toBeNull();
    expect(error.reason).toContain("old.example");
    expect(error.reason).toContain("new.example");
    expect(await findCompanyByDomain("new.example")).toBeUndefined();
  });

  it("duplicate lead gains a company link", async () => {
    await runImport(db(), new CsvLeadSource(writeCsv(["Email"], [["pat@gmail.com"]])));
    expect((await leadByEmail("pat@gmail.com")).companyId).toBeNull();
    const { stats } = await runImport(
      db(),
      new CsvLeadSource(
        writeCsv(["Email", "First Name", "Website"], [["pat@gmail.com", "Pat", "haulco.example"]]),
      ),
    );
    expect(stats.duplicate_leads).toBe(1);
    const pat = await leadByEmail("pat@gmail.com");
    expect(pat.firstName).toBeNull(); // scalar columns still keep the first claim
    expect((await companyById(pat.companyId as number)).domain).toBe("haulco.example");
  });

  it("company country written at create, blank-filled, never overwritten", async () => {
    const row = { company_name: "Acme", website: "acme.example", source_key: "crd:1" };
    await runImport(db(), new SourceKeyedSource([row]));
    expect((await companyByKey("crd:1")).country).toBeNull();
    await runImport(db(), new SourceKeyedSource([{ ...row, country: "DE" }]));
    expect((await companyByKey("crd:1")).country).toBe("DE"); // blank-filled
    await runImport(db(), new SourceKeyedSource([{ ...row, country: "FR" }]));
    expect((await companyByKey("crd:1")).country).toBe("DE"); // never overwritten
  });

  it("defaults persisted; unrecognized country not defaulted", async () => {
    const path = writeCsv(
      ["Email", "Country"],
      [
        ["jane@foo.example", ""], // absent -> default fills it
        ["bob@bar.example", "Freedonia"], // present but unrecognized -> stays NULL
      ],
    );
    const { batch, stats } = await runImport(db(), new CsvLeadSource(path), {
      defaults: { country: "US" },
    });
    expect(batch.defaults).toEqual({ persona: null, source: null, geo: null, country: "US" });
    expect(stats.country_unrecognized).toBe(1);
    expect((await leadByEmail("jane@foo.example")).country).toBe("US");
    expect((await leadByEmail("bob@bar.example")).country).toBeNull();
  });

  it("coverage stats and unmapped headers", async () => {
    const path = writeCsv(
      ["Email", "First Name", "Legal Name", "Company", "Website"],
      [
        ["jane@foo.example", "Jane", "Foo Legal LLC", "", "foo.example"],
        ["", "", "", "Bar Inc", "bar.example"],
      ],
    );
    const { stats } = await runImport(db(), new CsvLeadSource(path));
    expect(stats.lead_fields).toMatchObject({ email: 1, first_name: 1, last_name: 0 });
    expect(stats.company_fields).toMatchObject({ domain: 1, name: 1 });
    expect(stats.unmapped_headers).toEqual(["Legal Name"]);
  });

  it("column map makes a new client csv configuration", async () => {
    const path = writeCsv(["Contact Email", "Legal Name"], [["jane@foo.example", "Foo Legal LLC"]]);
    const { stats } = await runImport(db(), new CsvLeadSource(path), {
      columnMap: { "Contact Email": "email", "Legal Name": "title" },
    });
    expect((await leadByEmail("jane@foo.example")).title).toBe("Foo Legal LLC");
    expect(stats.unmapped_headers).toEqual([]);
  });

  it("column map rejects an unknown field before any row", async () => {
    const path = writeCsv(["Contact Email"], [["jane@foo.example"]]);
    await expect(
      runImport(db(), new CsvLeadSource(path), { columnMap: { "Contact Email": "not_a_field" } }),
    ).rejects.toThrow(/unknown field/);
  });

  it("freemail lead keeps its social_url pointer", async () => {
    await runImport(
      db(),
      new CsvLeadSource(
        writeCsv(["Email", "Website"], [["jane@gmail.com", "https://linkedin.com/in/jane"]]),
      ),
    );
    const jane = await leadByEmail("jane@gmail.com");
    expect(jane.socialUrl).toBe("https://linkedin.com/in/jane");
    expect(jane.companyId).toBeNull();
  });

  it("replay guard flags same content, same source type", async () => {
    const path = writeCsv(["Email"], [["jane@foo.example"]]);
    const first = await runImport(db(), new CsvLeadSource(path));
    expect(first.stats.replay_of).toBeUndefined();
    const second = await runImport(db(), new CsvLeadSource(path));
    expect(second.stats.replay_of).toBe(first.batch.id);
  });
});
