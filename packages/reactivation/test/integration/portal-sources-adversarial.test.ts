/**
 * The emails route's "why" and sources, adversarially: the demo mask over a
 * v4 pair whose paragraphs, brief lines and sources name the person every way
 * they can; whether a masked why still finds its paragraph; and how many
 * sources a page can cite. Tests that expose a bug assert the correct behavior
 * and are marked "Bug".
 */
import { signed } from "@wren/channel-email";
import { clients } from "@wren/core/clients";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { briefLines, MARKS } from "../../src/brief.js";
import { type Answer, COMPOSE_VERSION, readBody } from "../../src/compose.js";
import { seedDemo } from "../../src/demo/seed.js";
import type { EmailRow } from "../../src/portal/outbox.js";
import { DEMO_NAME, portalApi } from "../../src/portal/service.js";
import { sourcesOf } from "../../src/portal/views.js";
import { setClientProfile } from "../../src/profile.js";
import { deps as seedDeps, today } from "./demo-fixture.js";

let pg: TestPostgres;
let api: ReturnType<typeof portalApi>;
let cara = 0;
let umbrella = 0;
let moved = 0;
let hiring = 0;
const db = () => pg.db;

const SENDER = "Sam Rivera";
const SIGNATURE = `${SENDER}\nNorthside Talent`;
const demo = { viewer: { demo: true as const } };
const owner = { viewer: { email: "owner@acme.example" } };

/** A surname, an address's local part, a profile link's name, the agency. */
const LEAKS = [
  /\b(doe|lim)\b/i,
  /jane\.|cara\./i,
  /linkedin\.com\/in\/[^•]/i,
  /cara-lim|lim-cara/i,
  /northside/i,
];
const leaks = (v: unknown) => {
  const json = JSON.stringify(v);
  return LEAKS.filter((re) => re.test(json)).map(String);
};

const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T> => {
  const [r] = await db().execute<T>(q);
  if (!r) throw new Error("no row");
  return r as T;
};

/** An enrollment to Cara with a v4 pair written from `brief` by `answer`. */
async function pair(
  brief: string,
  answer: { opener: Answer["opener"]; followup: Answer["followup"] },
  state: "active" | "finished" = "finished",
): Promise<number> {
  const lines = briefLines(brief);
  const opener = readBody(answer.opener, lines.length, SENDER);
  const followup = readBody(answer.followup, lines.length, SENDER);
  const provenance = (why: unknown) =>
    JSON.stringify({
      composer: COMPOSE_VERSION,
      brief: { inputs_hash: "h", citations: { findings: [], crm: [] }, lines },
      address: { candidate_id: null, email: "cara.lim@initech.example", evidence: "crm" },
      owner: "Cara Lim's owner",
      recruiter: "sam@acme-talent.example",
      why,
      version: COMPOSE_VERSION,
    });
  const e = await one<{ id: number }>(sql`
    insert into enrollments (person_id, company_id, niche, sequence_name, sequence_snapshot, offer,
      state, kind, to_email, sender)
    values (${cara}, ${umbrella}, 'reactivation', 'reactivation', '{}'::jsonb, 'reactivation',
      ${state}, 'person', 'cara.lim@initech.example', 'sam@acme-talent.example')
    returning id`);
  await db().execute(sql`
    insert into messages (enrollment_id, step, template, template_version, to_email, subject, body,
      provenance, state)
    values
      (${e.id}, 0, 'reactivation_opener', ${COMPOSE_VERSION}, 'cara.lim@initech.example',
        'Cara Lim at Initech', ${signed(opener.text, SIGNATURE)},
        ${provenance(opener.why)}::jsonb, 'draft'),
      (${e.id}, 1, 'reactivation_followup', ${COMPOSE_VERSION}, 'cara.lim@initech.example', null,
        ${signed(followup.text, SIGNATURE)}, ${provenance(followup.why)}::jsonb, 'draft')`);
  return Number(e.id);
}

/** Findings for Cara, oldest last: their marks. */
async function findings(n: number, tag: string): Promise<string[]> {
  const r = await db().execute<{ id: number }>(sql`
    insert into findings (kind, person_id, fact_key, value, confidence, via, observed_at)
    select 'still_there', ${cara}, ${`${tag}:`} || g, '{}'::jsonb, 0.5, 'crawl',
      now() - make_interval(mins => g)
    from generate_series(1, ${n}) g
    returning id`);
  return r.map((x) => `f${x.id}`);
}

/** How the portal's Body finds a why: the body's paragraphs, trimmed. */
const paragraphs = (body: string | null) => (body ?? "").split(/\n{2,}/).map((p) => p.trim());
const marksIn = (lines: string[]) =>
  lines.flatMap((l) =>
    [...l.matchAll(MARKS)].flatMap((m) =>
      (m[1] ?? "").split(/[,;]/).map((x) => x.trim().toLowerCase()),
    ),
  );

let naming = 0;

beforeAll(async () => {
  pg = await startTestPostgres();
  await seedDemo(db(), seedDeps, { agency: "northside.example", today });
  cara = (await one<{ id: number }>(sql`select id from people where full_name = 'Cara Lim'`)).id;
  umbrella = (
    await one<{ id: number }>(sql`select id from companies where name = 'Umbrella Health'`)
  ).id;
  const doc = await one<{ id: number }>(sql`
    insert into documents (url, kind, content_hash, title, text)
    values ('https://www.linkedin.com/in/cara-lim', 'profile', 'h1',
      'Cara Lim - Senior Recruiter | LinkedIn', 'Cara Lim, cara.lim@initech.example')
    returning id`);
  moved = (
    await one<{ id: number }>(sql`
      insert into findings (kind, person_id, fact_key, value, document_id, source_url, confidence, via)
      values ('job_change', ${cara}, 'jc:cara',
        ${JSON.stringify({ from: "Umbrella Health", to: "Initech", title: "Senior Recruiter", name: "Cara Lim", evidence: "Cara Lim (cara.lim@initech.example) joined Initech, see linkedin.com/in/cara-lim" })}::jsonb,
        ${doc.id}, 'https://www.linkedin.com/in/cara-lim/', 0.9, 'search')
      returning id`)
  ).id;
  hiring = (
    await one<{ id: number }>(sql`
      insert into findings (kind, company_id, fact_key, value, source_url, confidence, via)
      values ('hiring', ${umbrella}, 'hi:umbrella',
        ${JSON.stringify({ count: 2, roles: [{ title: "Recruiter, reporting to Jane Doe", location: "Toronto" }] })}::jsonb,
        'https://umbrellahealth.com/careers', 1, 'crawl')
      returning id`)
  ).id;
  await setClientProfile(db(), {
    firm: "Northside Talent",
    sells: "tech hires for startups",
    voice: "Plain and short.",
    recruiters: [{ name: SENDER, email: "sam@acme-talent.example" }],
    signature: "{name}\nNorthside Talent",
  });
  await db()
    .insert(clients)
    .values([
      { id: "demo", name: "Northside Talent", database: "wren_client_demo", demo: true },
      {
        id: "acme",
        name: "Acme Staffing",
        database: "wren_client_acme",
        portalEmails: ["owner@acme.example"],
      },
    ]);
  api = portalApi({ main: db(), open: () => db() });

  // A pair that names Cara in every paragraph, every brief line and every source.
  naming = await pair(
    `Cara Lim moved to Initech as Senior Recruiter. [f${moved}] Umbrella Health has 2 open roles under Jane Doe. [f${hiring}] Find her at cara.lim@initech.example or linkedin.com/in/cara-lim. [F${moved}]`,
    {
      opener: [
        { text: "Hi Cara," },
        { text: "Cara Lim, you moved to Initech — congrats on Senior Recruiter.", from: [1] },
        {
          text: "Umbrella Health (where Jane Doe hires) has 2 open roles.\n\nI found you at linkedin.com/in/cara-lim and cara.lim@initech.example.",
          from: ["2", 3, 3],
        },
        { text: "Northside Talent can help CARA LIM, or Lim-Cara, or cara%20lim.", from: [1, 2] },
        { text: "Worth a call?\n\nThanks, Sam" },
      ],
      followup: [{ text: "Cara Lim, one more note about Initech and Jane Doe.", from: [1] }],
    },
    "active",
  );
});
afterAll(() => pg.stop());

const rowOf = (rows: EmailRow[], id: number) => {
  const r = rows.find((x) => x.enrollmentId === id);
  if (!r) throw new Error(`no row for #${id}`);
  return r;
};

describe("the demo's why and sources", () => {
  it("the fixture wrote a why for every paragraph that rests on the brief", async () => {
    const page = await api.emails({ ...owner, filter: "all" });
    const row = rowOf(page.rows, naming);
    expect(row.why?.brief).toHaveLength(3);
    expect(row.why?.opener.map((w) => w.lines)).toEqual([[0], [1, 2], [1, 2], [0, 1]]);
    expect(row.why?.followup).toHaveLength(1);
    expect(row.sources.map((s) => s.mark).sort()).toEqual([`f${hiring}`, `f${moved}`].sort());
  });

  it("no why, brief line or source leaks a name, an address, a profile or the agency", async () => {
    for (const filter of ["all", "awaiting"] as const) {
      const page = await api.emails({ ...demo, filter });
      const row = rowOf(page.rows, naming);
      expect(leaks(row.why), `why (${filter})`).toEqual([]);
      expect(leaks(row.sources), `sources (${filter})`).toEqual([]);
      expect(leaks(page), `page (${filter})`).toEqual([]);
    }
  });

  it("the facts are still there, masked", async () => {
    const row = rowOf((await api.emails({ ...demo, filter: "all" })).rows, naming);
    expect(row.why?.brief[0]).toBe(`Cara L. moved to Initech as Senior Recruiter. [f${moved}]`);
    expect(row.why?.opener[0]?.text).toBe(
      "Cara L., you moved to Initech, congrats on Senior Recruiter.",
    );
    expect(row.opener).toContain(DEMO_NAME);
    const byMark = new Map(row.sources.map((s) => [s.mark, s]));
    expect(byMark.get(`f${moved}`)).toMatchObject({
      kind: "job_change",
      url: "https://www.linkedin.com/in/•••/",
      title: "Cara L. - Senior Recruiter | LinkedIn",
      confidence: 0.9,
    });
    expect(byMark.get(`f${hiring}`)?.value).toMatchObject({
      roles: [{ title: "Recruiter, reporting to Jane D.", location: "Toronto" }],
    });
  });

  it("every masked why still finds its paragraph in the masked email", async () => {
    for (const view of [demo, owner]) {
      const row = rowOf((await api.emails({ ...view, filter: "all" })).rows, naming);
      const opener = paragraphs(row.opener);
      const followup = paragraphs(row.followup);
      expect(row.why?.opener.length).toBeGreaterThan(0);
      for (const w of row.why?.opener ?? []) expect(opener).toContain(w.text);
      for (const w of row.why?.followup ?? []) expect(followup).toContain(w.text);
    }
  });

  it("every source a why cites is on the row, and nothing it doesn't cite", async () => {
    for (const view of [demo, owner]) {
      const row = rowOf((await api.emails({ ...view, filter: "all" })).rows, naming);
      const cited = new Set(marksIn(row.why?.brief ?? []));
      expect(new Set(row.sources.map((s) => s.mark.toLowerCase()))).toEqual(cited);
    }
  });
});

describe("how many sources a page can cite", () => {
  // Bug: sourcesOf caps at MAX_MARKS (PAGE * 40 = 2000) per kind, but findingSources
  // (views.ts:337) still says `limit 100`, so the 101st finding and on never come back.
  it("Bug: 150 findings cited come back as 150 sources", async () => {
    const marks = await findings(150, "cap150");
    const got = await sourcesOf(db(), marks);
    expect(got.map((s) => s.mark).sort()).toEqual([...marks].sort());
  });

  it("Bug: past MAX_MARKS, 2000 findings come back, not 100", async () => {
    const marks = await findings(2100, "cap2100");
    const got = await sourcesOf(db(), marks);
    expect(got).toHaveLength(2000);
  });

  // Same bug, as the portal shows it: three emails each citing 40 findings is 120 marks on one
  // page; the oldest 20 are cut, so the last email loses half its sources.
  it("Bug: three emails citing 40 findings each all get their 40 sources", async () => {
    const ids: number[] = [];
    for (const tag of ["page-a", "page-b", "page-c"]) {
      const marks = await findings(40, tag);
      ids.push(
        await pair(`Cara Lim is still there. [${marks.join(", ")}]`, {
          opener: [{ text: "Hi Cara, still there?", from: [1] }],
          followup: "One more note.",
        }),
      );
    }
    const page = await api.emails({ ...owner, filter: "all" });
    for (const id of ids) expect(rowOf(page.rows, id).sources, `#${id}`).toHaveLength(40);
  });

  it("marks are read case-blind, once each, and unknown ones drop", async () => {
    const got = await sourcesOf(db(), [
      `F${moved}`,
      `f${moved}`,
      `f${hiring}`,
      "f999999",
      "x12",
      "f",
      "f1.5",
      "f-3",
      "c999999",
    ]);
    expect(got.map((s) => s.mark).sort()).toEqual([`f${hiring}`, `f${moved}`].sort());
  });

  // Bug: sourcesOf (views.ts:356-357) takes any Iterable but spreads it once per kind, so a
  // one-shot iterable (a Set's values(), a generator) is spent on the findings and every CRM
  // mark drops.
  it("Bug: a one-shot iterable of marks still finds the CRM rows", async () => {
    const crm = await one<{ id: number }>(
      sql`select id from crm_contacts where person_id = ${cara} limit 1`,
    );
    const marks = [`f${moved}`, `c${crm.id}`];
    expect((await sourcesOf(db(), marks)).map((s) => s.mark).sort()).toEqual(marks.sort());
    const got = await sourcesOf(db(), new Set(marks).values());
    expect(got.map((s) => s.mark).sort()).toEqual(marks.sort());
  });

  // Bug: sourcesOf (views.ts:357-360) passes any run of digits to `f.id in (...)`; one past the
  // integer range makes Postgres throw, so a single bad mark takes down the whole emails page.
  it("Bug: a mark past the id range drops like any unknown mark", async () => {
    await expect(sourcesOf(db(), [`f${moved}`, "f99999999999"])).resolves.toHaveLength(1);
  });
});
