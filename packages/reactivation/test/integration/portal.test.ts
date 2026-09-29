/**
 * The portal API over a seeded list: every route, as the demo, an operator
 * and a client login. The demo's answers must never carry a surname, an
 * address's local part, a profile link's name or the agency it was built
 * from, whatever the route or field.
 */
import { clients } from "@wren/core/clients";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "../../src/demo/seed.js";
import { EMAIL_FILTERS, REPLY_FILTERS } from "../../src/portal/outbox.js";
import { DEMO_NAME, PortalRefusal, portalApi } from "../../src/portal/service.js";
import { PEOPLE_FILTERS } from "../../src/portal/views.js";
import { scoreCrmContacts } from "../../src/score.js";
import { deps as seedDeps, today } from "./demo-fixture.js";

let pg: TestPostgres;
/** Every transaction the portal opened, and how. */
const opened: unknown[] = [];
let api: ReturnType<typeof portalApi>;
let enrollmentId = 0;
let replyId = 0;

const personId = async (full: string) => {
  const [r] = await pg.db.execute<{ id: number }>(
    sql`select id from people where full_name = ${full}`,
  );
  if (!r) throw new Error(`${full} is not on the list`);
  return r.id;
};

beforeAll(async () => {
  pg = await startTestPostgres();
  const db = pg.db;
  await seedDemo(db, seedDeps, { agency: "northside.example", today });
  const cara = await personId("Cara Lim");
  const jane = await personId("Jane Doe");
  const [umbrella] = await db.execute<{ id: number }>(
    sql`select id from companies where name = 'Umbrella Health'`,
  );
  // What the lookups would have written: facts that name the person in every field they can.
  const [doc] = await db.execute<{ id: number }>(sql`
    insert into documents (url, kind, content_hash, title, text)
    values ('https://www.linkedin.com/in/cara-lim', 'profile', 'h1',
      'Cara Lim - Senior Recruiter | LinkedIn', 'Cara Lim, cara.lim@initech.example')
    returning id`);
  const [moved] = await db.execute<{ id: number }>(sql`
    insert into findings (kind, person_id, fact_key, value, document_id, source_url, confidence, via)
    values ('job_change', ${cara}, 'jc:cara',
      ${JSON.stringify({ from: "Umbrella Health", to: "Initech", title: "Senior Recruiter", name: "Cara Lim", evidence: "Cara Lim (cara.lim@initech.example) joined Initech" })}::jsonb,
      ${doc?.id}, 'https://www.linkedin.com/in/cara-lim/', 0.9, 'search')
    returning id`);
  await db.execute(sql`
    insert into findings (kind, person_id, fact_key, value, source_url, confidence, via)
    values ('still_there', ${jane}, 'st:jane',
      ${JSON.stringify({ company: "Umbrella Health", title: "Talent Lead", quote: "Jane Doe leads talent" })}::jsonb,
      'https://umbrellahealth.com/team/jane-doe', 0.8, 'crawl')`);
  const [hiring] = await db.execute<{ id: number }>(sql`
    insert into findings (kind, company_id, fact_key, value, source_url, confidence, via)
    values ('hiring', ${umbrella?.id}, 'hi:umbrella',
      ${JSON.stringify({ count: 2, roles: ["Recruiter, reporting to Jane Doe"] })}::jsonb,
      'https://umbrellahealth.com/careers', 1, 'crawl')
    returning id`);
  await db.execute(sql`
    insert into company_checks (company_id, state, finding_id, tried)
    values (${umbrella?.id}, 'hiring', ${hiring?.id}, '[]'::jsonb)`);
  await scoreCrmContacts(db, today);
  await db.execute(sql`
    insert into briefs (person_id, state, text, citations, dropped, inputs_hash, model, prompt_version)
    values (${cara}, 'written',
      ${`Cara Lim moved to Initech [f${moved?.id}]. Write to cara.lim@initech.example or linkedin.com/in/cara-lim.`},
      '[]'::jsonb, '[]'::jsonb, 'x', 'fake', 'v1')`);

  // An email pair to Cara and her reply, both naming her every way they can.
  const [enr] = await db.execute<{ id: number }>(sql`
    insert into enrollments (person_id, company_id, niche, sequence_name, sequence_snapshot, offer,
      state, kind, to_email, sender)
    values (${cara}, ${umbrella?.id}, 'reactivation', 'reactivation', '{}'::jsonb, 'reactivation',
      'active', 'person', 'cara.lim@initech.example', 'sam@acme-talent.example')
    returning id`);
  enrollmentId = enr?.id ?? 0;
  await db.execute(sql`
    insert into messages (enrollment_id, step, template, template_version, to_email, subject, body,
      provenance, state)
    values
      (${enrollmentId}, 0, 'reactivation_opener', 'v1', 'cara.lim@initech.example', 'initech',
        'Hi Cara, saw you moved from Umbrella. Cara Lim, right?', '{}'::jsonb, 'draft'),
      (${enrollmentId}, 1, 'reactivation_followup', 'v1', 'cara.lim@initech.example', null,
        'Cara, one more note.', '{}'::jsonb, 'draft')`);
  const [reply] = await db.execute<{ id: number }>(sql`
    insert into thread_events (enrollment_id, kind, disposition, disposition_source, from_address, subject, body_text,
      received_at)
    values (${enrollmentId}, 'reply', 'interested', 'llm', 'cara.lim@initech.example', 'Re: initech',
      'Sure. Cara Lim, cara.lim@initech.example, linkedin.com/in/cara-lim', now())
    returning id`);
  replyId = reply?.id ?? 0;

  await db.insert(clients).values([
    { id: "demo", name: "Northside Talent", database: "wren_client_demo", demo: true },
    {
      id: "acme",
      name: "Acme Staffing",
      database: "wren_client_acme",
      portalEmails: ["owner@acme.example", "ops@acme.example"],
    },
    { id: "beta", name: "Beta Search", database: "wren_client_beta" },
  ]);
  // Every client reads the one seeded database; the recorder sees how it is opened.
  const client: Db = new Proxy(db, {
    get(target, key, receiver) {
      if (key !== "transaction") return Reflect.get(target, key, receiver);
      return (fn: never, config: unknown) => {
        opened.push(config);
        return target.transaction(fn, config as never);
      };
    },
  });
  api = portalApi({ main: db, open: () => client });
});
afterAll(() => pg.stop());

const demo = { viewer: { demo: true as const } };
const operator = { viewer: { email: "william@wren.example", operator: true } };
const owner = { viewer: { email: "Owner@Acme.example" } };

/** A surname, an address's local part, a profile's name, the agency. */
const LEAKS = [
  /\b(doe|lim|roe)\b/i,
  /jane\.|cara\.|bob\./i,
  /linkedin\.com\/in\/[^•]/i,
  /northside/i,
];
const leaks = (v: unknown) => {
  const json = JSON.stringify(v);
  return LEAKS.filter((re) => re.test(json)).map(String);
};

describe("the demo", () => {
  it("is named by DEMO_NAME, never by the agency", async () => {
    expect(await api.me(demo)).toEqual({ clients: [{ id: "demo", name: DEMO_NAME }], demo: true });
  });

  it("no route leaks a name, an address or a profile", async () => {
    const cara = await personId("Cara Lim");
    const answers: [string, unknown][] = [
      ["overview", await api.overview(demo)],
      ["health", await api.health(demo)],
      ["raw", await api.raw(demo)],
      ["raw search", await api.raw({ ...demo, via: "search" })],
      ["person", await api.person({ ...demo, personId: cara })],
      ["person jane", await api.person({ ...demo, personId: await personId("Jane Doe") })],
    ];
    for (const filter of PEOPLE_FILTERS)
      answers.push([`people ${filter}`, await api.people({ ...demo, filter })]);
    for (const filter of EMAIL_FILTERS)
      answers.push([`emails ${filter}`, await api.emails({ ...demo, filter })]);
    for (const filter of REPLY_FILTERS)
      answers.push([`replies ${filter}`, await api.replies({ ...demo, filter })]);
    expect((await api.emails({ ...demo, filter: "all" })).rows).toHaveLength(1);
    expect((await api.replies({ ...demo, filter: "all" })).rows).toHaveLength(1);
    for (const [route, answer] of answers) expect(leaks(answer), route).toEqual([]);
  });

  it("the facts are still there, masked", async () => {
    const view = await api.person({ ...demo, personId: await personId("Cara Lim") });
    expect(view.row.name).toBe("Cara L.");
    expect(view.row.now).toMatchObject({ kind: "job_change", company: "Initech" });
    expect(view.brief?.text).toContain("Cara L. moved to Initech");
    expect(view.brief?.text).toContain("c•••@initech.example");
    expect(view.sources.map((s) => s.url)).toContain("https://www.linkedin.com/in/•••/");
    const people = await api.people({ ...demo, filter: "moved" });
    expect(people.rows.map((r) => r.name)).toEqual(["Cara L."]);
  });

  it("search matches firms, never names", async () => {
    expect((await api.people({ ...demo, q: "Doe" })).total).toBe(0);
    expect((await api.people({ ...demo, q: "Umbrella" })).total).toBeGreaterThan(0);
  });

  it("reads in a read-only transaction", async () => {
    opened.length = 0;
    await api.overview(demo);
    await api.people({ ...operator, client: "acme" });
    expect(opened).toEqual([{ accessMode: "read only" }, { accessMode: "read only" }]);
  });
});

describe("logins", () => {
  it("an operator sees every client by its real name, and real names on a real list", async () => {
    expect(await api.me(operator)).toEqual({
      clients: [
        { id: "acme", name: "Acme Staffing" },
        { id: "beta", name: "Beta Search" },
        { id: "demo", name: "Northside Talent" },
      ],
      demo: false,
    });
    const acme = await api.people({ ...operator, client: "acme", q: "Doe" });
    expect(acme.rows.map((r) => r.name)).toEqual(["Jane Doe"]);
  });

  it("an operator reading the demo still gets it masked", async () => {
    expect(leaks(await api.people({ ...operator, client: "demo" }))).toEqual([]);
  });

  it("a client login sees only its own clients, whatever the case of its email", async () => {
    expect(await api.me(owner)).toEqual({
      clients: [{ id: "acme", name: "Acme Staffing" }],
      demo: false,
    });
    expect((await api.overview(owner)).people).toBeGreaterThan(0);
  });

  it("refuses another client's list, a login with no client, and a missing person", async () => {
    const refusal = (status: number) =>
      expect.objectContaining({ constructor: PortalRefusal, status });
    await expect(api.overview({ ...owner, client: "beta" })).rejects.toEqual(refusal(403));
    await expect(api.overview({ ...owner, client: "demo" })).rejects.toEqual(refusal(403));
    await expect(api.overview({ viewer: { email: "stranger@x.example" } })).rejects.toEqual(
      refusal(403),
    );
    await expect(api.overview({ viewer: { email: "" } })).rejects.toEqual(refusal(403));
    await expect(api.person({ ...owner, personId: 999_999 })).rejects.toEqual(refusal(404));
  });
});

describe("writes", () => {
  const refusal = (status: number) =>
    expect.objectContaining({ constructor: PortalRefusal, status });

  it("the demo refuses every write, even from an operator", async () => {
    await expect(api.approve({ ...demo, enrollmentIds: [enrollmentId] })).rejects.toEqual(
      refusal(403),
    );
    await expect(api.book({ ...demo, threadEventId: replyId })).rejects.toEqual(refusal(403));
    await expect(
      api.skip({ ...operator, client: "demo", enrollmentIds: [enrollmentId] }),
    ).rejects.toEqual(refusal(403));
    expect((await api.emails({ ...owner, filter: "awaiting" })).total).toBe(1);
  });

  it("a demo reply carries no bill: prices stay off public pages", async () => {
    expect((await api.replies(demo)).bill).toBeNull();
    expect((await api.replies(owner)).bill).toMatchObject({ meetings: 0, total: 1000 });
  });

  it("a client approves, marks a meeting, and a second click changes nothing", async () => {
    const first = await api.approve({ ...owner, enrollmentIds: [enrollmentId, 999_999] });
    expect(first).toEqual({ done: [enrollmentId], skipped: [999_999] });
    expect(await api.approve({ ...owner, enrollmentIds: [enrollmentId] })).toEqual({
      done: [],
      skipped: [enrollmentId],
    });
    const emails = await api.emails({ ...owner, filter: "approved" });
    expect(emails.rows[0]).toMatchObject({ enrollmentId, approvedBy: "client" });
    expect(emails.approval.firstApproved).toBe(true);

    const booked = await api.book({ ...owner, threadEventId: replyId });
    expect(booked.by).toBe("owner@acme.example");
    const again = await api.book({ ...operator, client: "acme", threadEventId: replyId });
    expect(again).toEqual(booked);
    const replies = await api.replies({ ...owner, filter: "booked" });
    expect(replies.rows[0]?.handoff?.recruiter).toBe("sam@acme-talent.example");
    expect(replies.bill).toMatchObject({ meetings: 1, meetingFees: 500, total: 1500 });

    // Each mark is a meeting billed: another login can't take it back; the marker or Wren can.
    const ops = { viewer: { email: "ops@acme.example" } };
    await expect(api.book({ ...ops, threadEventId: replyId, booked: false })).rejects.toEqual(
      refusal(403),
    );
    await api.book({ ...owner, threadEventId: replyId, booked: false });
    expect((await api.replies({ ...owner, filter: "booked" })).total).toBe(0);
    await api.book({ ...ops, threadEventId: replyId });
    await api.book({ ...operator, client: "acme", threadEventId: replyId, booked: false });
    expect((await api.replies({ ...owner, filter: "booked" })).total).toBe(0);
    await expect(api.book({ ...owner, threadEventId: 999_999 })).rejects.toEqual(refusal(404));
    await expect(api.approve({ ...owner, enrollmentIds: ["1; drop" as never] })).rejects.toEqual(
      refusal(404),
    );
  });
});
