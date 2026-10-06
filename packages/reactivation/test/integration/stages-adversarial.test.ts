/**
 * Adversarial tests for the signals, score, brief and status stages against
 * the migrated schema, seeded by a CRM CSV import. Each test says what SHOULD
 * happen per the doc comments; failing ones are marked BUG.
 */
import { classifyRow } from "@wren/core";
import { SiteCallError, type SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { FetchError, type Fetcher } from "@wren/research";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { briefSubjects, briefsDue, writeCrmBriefs } from "../../src/brief.js";
import { CRM_FORMATS } from "../../src/crm/formats.js";
import { runCrmImport } from "../../src/crm/import.js";
import { CrmCsvSource } from "../../src/crm/source.js";
import { rankedContacts } from "../../src/ranked.js";
import { scoreCrmContacts } from "../../src/score.js";
import { checkCrmCompanies, crmSignalSubjects } from "../../src/signals.js";
import { crmStatus } from "../../src/status.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, [
    "company_event_checks",
    "briefs",
    "contact_scores",
    "company_checks",
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
  ]);
  await importCsv(CSV);
});
const db = () => pg.db;

const CSV = [
  "ID,Name,Email,Company,Website",
  "1,Jane Doe,jane@acmestaffing.com,Acme Staffing,https://acmestaffing.com",
  "2,Bob Roe,bob@acmestaffing.com,Acme Staffing,https://acmestaffing.com",
  "3,Carl Poe,carl@betarecruit.com,Beta Recruit,https://betarecruit.com",
].join("\n");
async function importCsv(csv: string, name = "export.csv") {
  const f = CRM_FORMATS.get("crm-generic");
  if (!f) throw new Error("crm-generic");
  await runCrmImport(db(), new CrmCsvSource(f, name, new TextEncoder().encode(csv)));
}

const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T> => {
  const [r] = await db().execute<T>(q);
  if (!r) throw new Error("no row");
  return r as T;
};
const personId = async (first: string) =>
  (await one<{ id: number }>(sql`select id from people where first_name = ${first}`)).id;
const companyId = async (name: string) =>
  (await one<{ id: number }>(sql`select id from companies where name = ${name}`)).id;

let keys = 0;
async function finding(f: {
  kind: string;
  person?: number;
  company?: number;
  value: Record<string, unknown>;
  confidence?: number;
  via?: string;
  daysAgo?: number;
}): Promise<number> {
  keys += 1;
  const r = await one<{ id: number }>(sql`
    insert into findings (kind, person_id, company_id, fact_key, value, confidence, via, observed_at)
    values (${f.kind}, ${f.person ?? null}, ${f.company ?? null}, ${`adv:${keys}`},
      ${JSON.stringify(f.value)}::jsonb, ${f.confidence ?? 0.9}, ${f.via ?? "linkedin@research"},
      now() - make_interval(days => ${f.daysAgo ?? 0}))
    returning id`);
  return r.id;
}
const lookedUp = (person: number, state = "matched") =>
  db().execute(
    sql`insert into person_lookups (person_id, state, tried) values (${person}, ${state}, '[]'::jsonb)`,
  );
const hiringAt = async (company: number) => {
  const id = await finding({
    kind: "hiring",
    company,
    value: { count: 2, roles: [{ title: "Recruiter" }, { title: "Sourcer" }] },
    via: "greenhouse",
  });
  await db().execute(sql`
    insert into company_checks (company_id, state, finding_id, tried)
    values (${company}, 'hiring', ${id}, '[]'::jsonb)`);
  return id;
};

type Handler = (path: string) => unknown;
function sites(handlers: Record<string, Handler>): SiteClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async call(site, method, path) {
      calls.push(`${site} ${path}`);
      const h = handlers[site];
      if (!h) throw new SiteCallError(site, method, path, 404, "no such site");
      return h(path) as never;
    },
    async via() {
      return "api";
    },
  };
}
function fetcher(pages: Record<string, string | Error>): Fetcher {
  return {
    userAgent: "test",
    async get(url) {
      const p = pages[url];
      if (p instanceof Error) throw p;
      return p === undefined ? { status: 404, url, text: "" } : { status: 200, url, text: p };
    },
  };
}
/** A model that cites the first finding mark in its prompt. */
const citesFirstFinding = (text: string) =>
  new FakeLlm({
    respond: (p) =>
      JSON.stringify({ sentences: [`${text} [${/\[(f\d+)\]/.exec(p)?.[1] ?? "f0"}]`] }),
  });

describe("signals: whose LinkedIn page", () => {
  // BUG (latent: import can't yet give one person rows at two firms): profile_page takes any CRM person's
  // still_there page, even one whose latest row (and so that reading) is another firm's.
  it("a person's current page at another firm is not this firm's page", async () => {
    const jane = await personId("Jane");
    const beta = await companyId("Beta Recruit");
    const imp = await one<{ import_id: number }>(sql`select import_id from crm_contacts limit 1`);
    await db().execute(sql`
      insert into crm_contacts (person_id, company_id, import_id, row_number, format, crm_key, raw)
      values (${jane}, ${beta}, ${imp.import_id}, 99, 'crm-generic', 'moved-99', '{}'::jsonb)`);
    await finding({
      kind: "still_there",
      person: jane,
      value: { companyUrl: "https://www.linkedin.com/company/beta-recruit" },
    });
    const pages = Object.fromEntries(
      (await crmSignalSubjects(db())).map((s) => [s.firm.name, s.linkedinPage]),
    );
    expect(pages["Beta Recruit"]).toBe("beta-recruit");
    expect(pages["Acme Staffing"]).toBeNull();
  });

  // BUG: the lead importer keeps a scheme-less LinkedIn website raw as social_url; linkedinCompany needs a scheme, so the known page is dropped and searched for.
  it("a scheme-less LinkedIn company url in social_url is the firm's page", async () => {
    const website = "linkedin.com/company/acme-staffing";
    expect(
      classifyRow({ Email: "jane@acmestaffing.com", Company: "Acme Staffing", Website: website }),
    ).toMatchObject({ socialUrl: website });
    await db().execute(
      sql`update companies set social_url = ${website} where name = 'Acme Staffing'`,
    );
    const subject = (await crmSignalSubjects(db())).find((s) => s.firm.name === "Acme Staffing");
    expect(subject?.linkedinPage).toBe("acme-staffing");
  });
});

describe("signals: caps, errors, re-checks", () => {
  it("a LinkedIn cap parks the rest without asking LinkedIn again", async () => {
    await db().execute(
      sql`update companies set social_url = 'https://www.linkedin.com/company/' || lower(replace(name, ' ', '-'))`,
    );
    const s = sites({
      linkedin: (path) => {
        throw new SiteCallError("linkedin", "GET", path, 429, "retry after 43200s");
      },
    });
    const stats = await checkCrmCompanies(
      db(),
      { fetcher: fetcher({}), sites: s },
      { linkedin: "research", concurrency: 1 },
    );
    expect(stats).toMatchObject({ selected: 2, capped: 2, errors: 0, aborted: null });
    expect(s.calls.filter((c) => c.startsWith("linkedin"))).toHaveLength(1);
    expect(await crmSignalSubjects(db())).toEqual([]);
  });

  it("five errors in a row stop the stage; the rest stay due", async () => {
    await importCsv(
      [
        "ID,Name,Email,Company,Website",
        ...["c", "d", "e", "f", "g"].map(
          (x, i) => `${10 + i},P${x} Q,p@${x}firm.com,${x.toUpperCase()} Firm,https://${x}firm.com`,
        ),
      ].join("\n"),
      "more.csv",
    );
    const broken: Fetcher = {
      userAgent: "test",
      async get() {
        throw new Error("fetcher bug");
      },
    };
    const stats = await checkCrmCompanies(
      db(),
      { fetcher: broken, sites: sites({}) },
      { linkedin: null, concurrency: 1 },
    );
    expect(stats).toMatchObject({ selected: 7, errors: 5 });
    expect(stats.aborted).toMatch(/5 errors in a row/);
    expect(await crmSignalSubjects(db())).toHaveLength(7);
  });

  // BUG: with no fetcher (WREN_FETCH_CONTACT unset) and no LinkedIn account nothing is tried, yet every company is recorded unresolved and parked 30 days.
  it("with nothing to check with, no company is parked as couldn't tell", async () => {
    const stats = await checkCrmCompanies(
      db(),
      { fetcher: null, sites: sites({}) },
      { linkedin: null },
    );
    expect(stats.unresolved).toBe(0);
    expect(await crmSignalSubjects(db())).toHaveLength(2);
  });

  // BUG: store.ts nulls finding_id on any non-capped re-check, so one careers-page timeout wipes a week-old hiring signal and parks the firm for 30 days.
  it("a re-check that can't reach the site keeps the hiring it last saw", async () => {
    const acme = await companyId("Acme Staffing");
    const board = {
      "https://acmestaffing.com/careers": "https://jobs.lever.co/acmestaffing",
      "https://api.lever.co/v0/postings/acmestaffing?mode=json": JSON.stringify([
        { text: "Recruiter", hostedUrl: "https://jobs.lever.co/acmestaffing/1" },
      ]),
    };
    await checkCrmCompanies(
      db(),
      { fetcher: fetcher(board), sites: sites({}) },
      { linkedin: null },
    );
    const first = await one<{ finding_id: number | null }>(
      sql`select finding_id from company_checks where company_id = ${acme}`,
    );
    expect(first.finding_id).not.toBeNull();

    await db().execute(sql`update company_checks set checked_at = now() - interval '8 days'`);
    const down = fetcher({ "https://acmestaffing.com/careers": new FetchError("ETIMEDOUT") });
    await checkCrmCompanies(db(), { fetcher: down, sites: sites({}) }, { linkedin: null });
    const again = await one<{ state: string; finding_id: number | null }>(
      sql`select state, finding_id from company_checks where company_id = ${acme}`,
    );
    expect(again.state).toBe("unresolved");
    expect(again.finding_id).toBe(first.finding_id);
  });
});

describe("briefs: which facts", () => {
  // BUG: brief facts take the latest firm's hiring even for a mover; the score drops it ("their old firm's"), the brief tells the model it's "their company".
  it("a mover's brief doesn't carry the old firm's open roles", async () => {
    const jane = await personId("Jane");
    await finding({
      kind: "job_change",
      person: jane,
      value: { from: "Acme Staffing", to: "Gamma Talent", title: "VP Talent" },
    });
    const hiring = await hiringAt(await companyId("Acme Staffing"));
    await lookedUp(jane);
    await scoreCrmContacts(db());
    const [s] = await briefSubjects(db());
    expect(s?.personId).toBe(jane);
    expect(s?.facts.map((f) => f.mark)).not.toContain(`f${hiring}`);
  });

  // BUG: the inputs hash leaves out the firm name the prompt and fact text use, so a renamed firm keeps its old brief.
  it("a brief is due again when the firm's name it was written with changes", async () => {
    const jane = await personId("Jane");
    await finding({ kind: "still_there", person: jane, value: {} });
    await lookedUp(jane);
    await scoreCrmContacts(db());
    await writeCrmBriefs(db(), citesFirstFinding("Still at Acme Staffing."));
    expect(await briefsDue(db())).toBe(0);
    await db().execute(
      sql`update companies set name = 'Acme Talent Partners' where name = 'Acme Staffing'`,
    );
    expect(await briefsDue(db())).toBe(1);
  });

  it("a brief whose facts are all gone is retired, with no model call", async () => {
    const jane = await personId("Jane");
    await finding({ kind: "still_there", person: jane, value: {} });
    await lookedUp(jane);
    await scoreCrmContacts(db());
    await writeCrmBriefs(db(), citesFirstFinding("Still at Acme Staffing."));
    await db().execute(sql`delete from findings`);
    await scoreCrmContacts(db());
    expect(await briefsDue(db())).toBe(1);
    const silent = new FakeLlm({
      respond: () => {
        throw new Error("no call expected");
      },
    });
    await writeCrmBriefs(db(), silent);
    const b = await one<{ state: string; text: string }>(
      sql`select state, text from briefs where person_id = ${jane}`,
    );
    expect(b).toEqual({ state: "empty", text: "" });
    expect(await briefsDue(db())).toBe(0);
  });

  it("a brief isn't due again when the same facts are read again on a later day", async () => {
    const jane = await personId("Jane");
    await finding({ kind: "still_there", person: jane, value: {}, daysAgo: 3 });
    await lookedUp(jane);
    await scoreCrmContacts(db());
    await writeCrmBriefs(db(), citesFirstFinding("Still there."));
    await db().execute(sql`update findings set observed_at = now()`);
    await scoreCrmContacts(db());
    expect(await briefsDue(db())).toBe(0);
  });
});

describe("ranked list", () => {
  // BUG: ranked.ts joins any written brief without checking it still matches; someone who left (score 0) is never rebriefed, so the old pitch shows forever.
  it("someone who left doesn't show the brief written while they were there", async () => {
    const jane = await personId("Jane");
    await finding({ kind: "still_there", person: jane, value: {} });
    await hiringAt(await companyId("Acme Staffing"));
    await lookedUp(jane);
    await scoreCrmContacts(db());
    await writeCrmBriefs(db(), citesFirstFinding("Still at Acme, which is hiring."));

    await finding({
      kind: "left",
      person: jane,
      value: { from: "Acme Staffing" },
      confidence: 0.99,
    });
    await scoreCrmContacts(db());
    const row = (await rankedContacts(db())).find((c) => c.personId === jane);
    expect(row?.score).toBe(0);
    expect(row?.brief).toBeNull();
  });
});

describe("status", () => {
  // BUG: with a failed brief waiting its day, `next` says everyone is briefed; failed briefs aren't in the "wait" list.
  it("a failed brief waiting to retry isn't reported as everyone briefed", async () => {
    await db().execute(sql`
      insert into verifications (verifier, result, raw, email, contact_candidate_id)
      select 'test', 'valid', '{}'::jsonb, cc.email, cc.id from contact_candidates cc`);
    const jane = await personId("Jane");
    await finding({ kind: "still_there", person: jane, value: {} });
    for (const p of ["Jane", "Bob", "Carl"]) await lookedUp(await personId(p));
    await checkCrmCompanies(db(), { fetcher: fetcher({}), sites: sites({}) }, { linkedin: null });
    await db().execute(sql`insert into company_event_checks (company_id, state, tried)
      select distinct company_id, 'none', '[]'::jsonb from crm_contacts`);
    await scoreCrmContacts(db());
    await writeCrmBriefs(db(), new FakeLlm({ default: "sorry, no" }));

    const s = await crmStatus(db());
    expect(s.due).toEqual([]);
    expect(s.briefs.failed).toBe(1);
    expect(s.next).not.toContain("briefed");
  });
});
