/**
 * The signals, score and brief stages against the migrated schema, with facts
 * seeded directly: who each stage picks, what it writes, and when it is due
 * again. Canned pages, a fake search and a fake LLM; no network.
 */
import type { SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm, LlmError } from "@wren/llm";
import type { Fetcher } from "@wren/research";
import { recordCompanyCheck } from "@wren/research/companies";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { briefSubjects, briefsDue, writeCrmBriefs } from "../../src/brief.js";
import { CRM_FORMATS } from "../../src/crm/formats.js";
import { runCrmImport } from "../../src/crm/import.js";
import { CrmCsvSource } from "../../src/crm/source.js";
import { checkCrmEvents } from "../../src/events.js";
import { crmLookupSubjects } from "../../src/lookup.js";
import { rankedContacts } from "../../src/ranked.js";
import { POINTS, scoreCrmContacts, scoreDue } from "../../src/score.js";
import { checkCrmCompanies, crmSignalSubjects } from "../../src/signals.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, [
    "unit_holds",
    "company_event_checks",
    "mover_addresses",
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
  await importCsv();
});
const db = () => pg.db;

const CSV = [
  "ID,Name,Email,Company,Website",
  "1,Jane Doe,jane@acmestaffing.com,Acme Staffing,https://acmestaffing.com",
  "2,Bob Roe,bob@acmestaffing.com,Acme Staffing,https://acmestaffing.com",
  "3,Carl Poe,carl@betarecruit.com,Beta Recruit,https://betarecruit.com",
].join("\n");
async function importCsv() {
  const f = CRM_FORMATS.get("crm-generic");
  if (!f) throw new Error("crm-generic");
  await runCrmImport(db(), new CrmCsvSource(f, "export.csv", new TextEncoder().encode(CSV)));
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
/** A finding as a stage would have kept it; returns its id. */
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
    values (${f.kind}, ${f.person ?? null}, ${f.company ?? null}, ${`test:${keys}`},
      ${JSON.stringify(f.value)}::jsonb, ${f.confidence ?? 0.9}, ${f.via ?? "linkedin@research"},
      now() - make_interval(days => ${f.daysAgo ?? 0}))
    returning id`);
  return r.id;
}
const lookedUp = (person: number, state = "matched") =>
  db().execute(
    sql`insert into person_lookups (person_id, state, tried) values (${person}, ${state}, '[]'::jsonb)`,
  );
const hiringAt = async (company: number, daysAgo = 0) => {
  const id = await finding({
    kind: "hiring",
    company,
    value: { count: 2, roles: [{ title: "Recruiter" }, { title: "Sourcer" }] },
    via: "greenhouse",
    daysAgo,
  });
  await db().execute(sql`
    insert into company_checks (company_id, state, finding_id, tried)
    values (${company}, 'hiring', ${id}, '[]'::jsonb)`);
  return id;
};

const noSites: SiteClient = {
  async call(site, method, path) {
    throw new Error(`unexpected ${site} ${method} ${path}`);
  },
  async via() {
    return "api";
  },
};
function fetcher(pages: Record<string, string>): Fetcher {
  return {
    userAgent: "test",
    async get(url) {
      const text = pages[url];
      return text === undefined ? { status: 404, url, text: "" } : { status: 200, url, text };
    },
  };
}

describe("signals", () => {
  it("biggest company first; its LinkedIn page comes from a matched profile", async () => {
    const acme = await companyId("Acme Staffing");
    await db().execute(
      sql`update companies set social_url = 'https://www.linkedin.com/company/acme-old' where id = ${acme}`,
    );
    await finding({
      kind: "still_there",
      person: await personId("Jane"),
      value: { companyUrl: "https://www.linkedin.com/company/acme-staffing/" },
    });
    const subjects = await crmSignalSubjects(db());
    expect(subjects.map((s) => [s.firm.name, s.linkedinPage])).toEqual([
      ["Acme Staffing", "acme-staffing"],
      ["Beta Recruit", null],
    ]);
  });

  it("checks each company once, then waits: a week for an answer, a month for none", async () => {
    const f = fetcher({
      "https://acmestaffing.com/careers": "https://jobs.lever.co/acmestaffing",
      "https://api.lever.co/v0/postings/acmestaffing?mode=json": JSON.stringify([
        { text: "Recruiter", hostedUrl: "https://jobs.lever.co/acmestaffing/1" },
      ]),
    });
    const stats = await checkCrmCompanies(db(), { fetcher: f, sites: noSites }, { linkedin: null });
    expect(stats).toMatchObject({
      selected: 2,
      hiring: 1,
      unresolved: 1,
      errors: 0,
      aborted: null,
    });
    expect(await crmSignalSubjects(db())).toEqual([]);

    await db().execute(sql`update company_checks set checked_at = now() - interval '8 days'`);
    expect((await crmSignalSubjects(db())).map((s) => s.firm.name)).toEqual(["Acme Staffing"]);
    await db().execute(sql`update company_checks set checked_at = now() - interval '31 days'`);
    expect(await crmSignalSubjects(db())).toHaveLength(2);
  });

  it("a capped re-check keeps the last real answer and waits for the cap", async () => {
    const acme = await companyId("Acme Staffing");
    const hiring = await hiringAt(acme);
    await recordCompanyCheck(db(), acme, {
      state: "capped",
      finding: null,
      tried: [],
      retryAt: new Date(Date.now() + 3_600_000),
      cappedBy: "linkedin",
      served: "account",
    });
    const k = await one<{ state: string; finding_id: number }>(
      sql`select state, finding_id from company_checks where company_id = ${acme}`,
    );
    expect(k).toEqual({ state: "capped", finding_id: hiring });
    expect((await crmSignalSubjects(db())).map((s) => s.firm.name)).toEqual(["Beta Recruit"]);
  });
});

describe("score", () => {
  const scoreOf = async (first: string) =>
    (
      await one<{ score: number }>(
        sql`select score from contact_scores where person_id = ${await personId(first)}`,
      )
    ).score;

  it("scores everyone from what the stages found", async () => {
    const [jane, bob, carl] = [
      await personId("Jane"),
      await personId("Bob"),
      await personId("Carl"),
    ];
    await finding({ kind: "job_change", person: jane, value: { to: "Gamma" }, confidence: 0.5 });
    await finding({ kind: "still_there", person: jane, value: {}, confidence: 0.9, daysAgo: 3 });
    await finding({ kind: "left", person: bob, value: { from: "Acme Staffing" } });
    await hiringAt(await companyId("Acme Staffing"));
    await db().execute(
      sql`update crm_contacts set last_contacted_on = current_date - 30 where person_id = ${carl}`,
    );

    const stats = await scoreCrmContacts(db());
    expect(stats).toMatchObject({ selected: 3, hiringThere: 1, left: 1, unknown: 1 });
    // The surer reading wins, even when older.
    expect(await scoreOf("Jane")).toBe(POINTS.stillThere + POINTS.hiringThere);
    expect(await scoreOf("Bob")).toBe(0);
    expect(await scoreOf("Carl")).toBe(POINTS.unknown + POINTS.contactedRecently);
  });

  it("sources that disagree hold the person until a third source or a person settles it", async () => {
    const [jane, bob] = [await personId("Jane"), await personId("Bob")];
    const doubt = async (person: number) => {
      await finding({ kind: "still_there", person, value: {}, confidence: 0.8, via: "search" });
      await finding({
        kind: "left",
        person,
        value: { reason: "the mailbox rejects mail" },
        confidence: 0.6,
        via: "email",
      });
    };
    await doubt(jane);
    await doubt(bob);
    await hiringAt(await companyId("Acme Staffing"));
    const stats = await scoreCrmContacts(db());
    expect(stats).toMatchObject({ conflicted: 2, hiringThere: 0 });
    const scored = (person: number) =>
      one<{ next_step: string; reasons: { reason: string }[] }>(
        sql`select next_step, reasons from contact_scores where person_id = ${person}`,
      );
    expect(await scored(jane)).toMatchObject({ next_step: "keep_warm" });
    expect((await scored(jane)).reasons.map((r) => r.reason)).toContain(
      "Sources disagree: a profile search has them at Acme Staffing; their mailbox rejects mail",
    );
    const holdOf = (person: number) =>
      one<{ state: string; released_by: string | null }>(
        sql`select state, released_by from unit_holds_now where subject = ${`person:${person}`}`,
      );
    expect(await holdOf(jane)).toEqual({ state: "held", released_by: null });

    // Its hold ran out: Jane is due one more lookup, though she was looked up.
    await lookedUp(jane);
    expect((await crmLookupSubjects(db())).find((x) => x.personId === jane)).toBeUndefined();
    await db().execute(sql`update unit_holds set until = now() - interval '1 second'`);
    expect((await crmLookupSubjects(db())).find((x) => x.personId === jane)).toMatchObject({
      retry: true,
    });

    // A third source agrees with search: settled, and her firm's roles are a reason to call.
    await finding({
      kind: "still_there",
      person: jane,
      value: {},
      confidence: 0.8,
      via: "exa-cache",
    });
    // A person goes with Bob's surest reading.
    await db().execute(sql`update unit_holds set released_at = now(), released_by = 'op@example.com'
      where subject = ${`person:${bob}`}`);
    expect(await scoreCrmContacts(db())).toMatchObject({ conflicted: 0, hiringThere: 2 });
    expect(await holdOf(jane)).toEqual({ state: "released", released_by: "checks" });
    expect(await holdOf(bob)).toEqual({ state: "released", released_by: "op@example.com" });
    expect(await scored(bob)).toMatchObject({ next_step: "reach_out" });
  });

  it("dated news at the firm they work at now is a reason to call; news over 6 months old isn't", async () => {
    const [jane, carl] = [await personId("Jane"), await personId("Carl")];
    const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
    const news = (company: number, date: string, title: string) =>
      finding({
        kind: "news",
        company,
        value: { event: "acquisition", date, title },
        via: "google",
      });
    await finding({ kind: "still_there", person: jane, value: {}, confidence: 0.9 });
    const acme = await news(
      await companyId("Acme Staffing"),
      day(20),
      "Acme Staffing acquired by Globex",
    );
    await news(await companyId("Beta Recruit"), day(240), "Beta Recruit acquired by Initech");
    await scoreCrmContacts(db());
    expect(await scoreOf("Jane")).toBe(POINTS.stillThere + POINTS.news);
    const why = await one<{ next_step: string; reasons: { reason: string; cites: string[] }[] }>(
      sql`select next_step, reasons from contact_scores where person_id = ${jane}`,
    );
    expect(why.next_step).toBe("reach_out");
    const said = why.reasons.find((r) => r.cites.includes(`f${acme}`));
    expect(said?.reason).toMatch(
      /^Acme Staffing in the news \(\w{3} 2026\): Acme Staffing acquired by Globex$/,
    );
    expect(await scoreOf("Carl")).toBe(POINTS.unknown);

    // A mover's news is their new firm's, once their address there is found.
    const move = await finding({ kind: "job_change", person: carl, value: { to: "Gamma Talent" } });
    const gamma = await one<{ id: number }>(
      sql`insert into companies (domain, name) values ('gamma.example', 'Gamma Talent') returning id`,
    );
    await news(gamma.id, day(10), "Gamma Talent raises $5M");
    await scoreCrmContacts(db());
    expect(await scoreOf("Carl")).toBe(POINTS.moved);
    await db().execute(sql`
      with c as (insert into contact_candidates (person_id, email, domain, evidence, pattern, rank, state, source_ref)
        values (${carl}, 'carl@gamma.example', 'gamma.example', 'guessed_pattern', 'first', 1, 'verified', 'move:test')
        returning id)
      insert into mover_addresses (finding_id, person_id, domain, outcome, candidate_id)
      select ${move}, ${carl}, 'gamma.example', 'found', id from c`);
    await scoreCrmContacts(db());
    expect(await scoreOf("Carl")).toBe(POINTS.moved + POINTS.news);
  });

  it("the news stage searches each firm once a month, and the mover's new firm too", async () => {
    // 03:00 UTC, outside Google's hours, so Exa answers whatever the real clock says.
    const at = new Date();
    at.setUTCHours(3, 0, 0, 0);
    const now = () => at;
    const searched: string[] = [];
    const sites: SiteClient = {
      async call(_site, _method, path, input) {
        searched.push(`${path} ${String((input as { q: string }).q).split('"')[1] ?? ""}`);
        return {
          hits: [
            {
              title: "Acme Staffing acquired by Globex",
              url: "https://news.example/acme",
              snippet: null,
              raw: { publishedDate: new Date(at.getTime() - 86_400_000).toISOString() },
            },
          ],
        } as never;
      },
      async via() {
        return "api";
      },
    };
    const stats = await checkCrmEvents(db(), sites, { timezone: "UTC", now });
    expect(stats).toMatchObject({ selected: 2, found: 1, none: 1, errors: 0 });
    const kept = await one<{ n: number }>(
      sql`select count(*)::int n from findings where kind = 'news'`,
    );
    expect(kept.n).toBe(1);
    expect((await checkCrmEvents(db(), sites, { timezone: "UTC", now })).selected).toBe(0);
    expect(searched).toHaveLength(2);
  });

  it("a hiring reading over a month old doesn't count", async () => {
    await hiringAt(await companyId("Acme Staffing"), 31);
    await scoreCrmContacts(db());
    expect(await scoreOf("Jane")).toBe(POINTS.unknown);
  });

  it("due when unscored, when an input changes, and daily", async () => {
    expect(await scoreDue(db())).toBe(3);
    await scoreCrmContacts(db());
    expect(await scoreDue(db())).toBe(0);
    await finding({ kind: "still_there", person: await personId("Jane"), value: {} });
    expect(await scoreDue(db())).toBe(3);
    await scoreCrmContacts(db());
    await db().execute(sql`update contact_scores set computed_at = now() - interval '2 days'`);
    await db().execute(sql`update findings set observed_at = now() - interval '3 days'`);
    expect(await scoreDue(db())).toBe(3);
  });
});

describe("briefs", () => {
  /** Jane: still there, Acme hiring, lookup matched. Bob left. Carl has nothing found. */
  async function seed() {
    const [jane, bob, carl] = [
      await personId("Jane"),
      await personId("Bob"),
      await personId("Carl"),
    ];
    const where = await finding({
      kind: "still_there",
      person: jane,
      value: { title: "Head of Talent" },
    });
    const hiring = await hiringAt(await companyId("Acme Staffing"));
    await finding({ kind: "left", person: bob, value: {} });
    for (const p of [jane, bob, carl]) await lookedUp(p);
    await scoreCrmContacts(db());
    return { jane, where, hiring };
  }
  const citing = (mark = /\[(f\d+)\]/) =>
    new FakeLlm({
      respond: (p) =>
        JSON.stringify({ sentences: [`Still there. [${mark.exec(p)?.[1] ?? "f0"}]`] }),
    });
  const brief = async (person: number) =>
    one<{ state: string; text: string; citations: unknown; dropped: unknown[] }>(
      sql`select state, text, citations, dropped from briefs where person_id = ${person}`,
    );

  it("only someone worth reaching, looked up, with something found", async () => {
    const { jane, where, hiring } = await seed();
    const subjects = await briefSubjects(db());
    expect(subjects.map((s) => s.personId)).toEqual([jane]);
    const marks = subjects[0]?.facts.map((f) => f.mark);
    expect(marks).toEqual([`f${where}`, `f${hiring}`, expect.stringMatching(/^c\d+$/)]);
    expect(subjects[0]?.facts[1]?.text).toMatch(
      /^Acme Staffing has 2 open roles: Recruiter; Sourcer \(greenhouse job board, read \d{4}-\d\d-\d\d\)$/,
    );
  });

  it("not before the lookup is done", async () => {
    const { jane } = await seed();
    await db().execute(sql`update person_lookups set state = 'capped' where person_id = ${jane}`);
    expect(await briefsDue(db())).toBe(0);
  });

  it("writes a cited brief once; the same facts read again cost nothing", async () => {
    const { jane, where } = await seed();
    const stats = await writeCrmBriefs(db(), citing());
    expect(stats).toMatchObject({ selected: 1, written: 1, dropped: 0, aborted: null });
    expect(await brief(jane)).toMatchObject({
      state: "written",
      text: `Still there. [f${where}]`,
      citations: { findings: [where], crm: [] },
    });
    expect(await briefsDue(db())).toBe(0);
    await db().execute(sql`update findings set observed_at = now() + interval '1 day'`);
    expect(await briefsDue(db())).toBe(0);
    await db().execute(
      sql`update findings set value = '{"title": "VP Talent"}'::jsonb where id = ${where}`,
    );
    expect(await briefsDue(db())).toBe(1);
  });

  it("a brief with nothing the gate keeps is stored empty and not asked again", async () => {
    const { jane } = await seed();
    const llm = new FakeLlm({
      default: JSON.stringify({ sentences: ["Great time to call. [f999]"] }),
    });
    const stats = await writeCrmBriefs(db(), llm);
    expect(stats).toMatchObject({ written: 0, empty: 1, dropped: 1 });
    expect(await brief(jane)).toMatchObject({ state: "empty", text: "" });
    expect(await briefsDue(db())).toBe(0);
    expect((await rankedContacts(db()))[0]).toMatchObject({ personId: jane, brief: null });
  });

  it("an unreadable answer is failed, retried after a day", async () => {
    await seed();
    const stats = await writeCrmBriefs(db(), new FakeLlm({ default: "sorry, no" }));
    expect(stats).toMatchObject({ failed: 1, written: 0 });
    expect(await briefsDue(db())).toBe(0);
    await db().execute(sql`update briefs set created_at = now() - interval '25 hours'`);
    expect(await briefsDue(db())).toBe(1);
  });

  it("a provider failure stops the stage and writes nothing", async () => {
    await seed();
    const llm = new FakeLlm({
      respond: () => {
        throw new LlmError("overloaded", { status: 529 });
      },
    });
    const stats = await writeCrmBriefs(db(), llm);
    expect(stats).toMatchObject({ selected: 1, written: 0, aborted: "overloaded" });
    expect(await briefsDue(db())).toBe(1);
  });
});

describe("ranked", () => {
  it("best score first, with why and the written brief", async () => {
    const jane = await personId("Jane");
    await finding({ kind: "still_there", person: jane, value: {} });
    await hiringAt(await companyId("Acme Staffing"));
    await lookedUp(jane);
    await scoreCrmContacts(db());
    await writeCrmBriefs(
      db(),
      new FakeLlm({
        respond: (p) =>
          JSON.stringify({ sentences: [`Still there. [${/\[(f\d+)\]/.exec(p)?.[1]}]`] }),
      }),
    );
    const list = await rankedContacts(db());
    expect(list.map((c) => [c.name, c.score])).toEqual([
      ["Jane Doe", 100],
      ["Bob Roe", 40],
      ["Carl Poe", 10],
    ]);
    expect(list[0]?.reasons.map((r) => r.reason)).toEqual([
      "Acme Staffing has 2 open roles",
      "Still at Acme Staffing",
    ]);
    expect(list[0]?.brief).toMatch(/^Still there\. \[f\d+\]$/);
    expect(list[1]?.brief).toBeNull();
    expect(await rankedContacts(db(), { limit: 1 })).toHaveLength(1);
  });
});
