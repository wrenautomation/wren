/**
 * The portal API over a seeded list: every route, as the demo, an operator
 * and a client login. The demo's answers must never carry a surname, an
 * address's local part, a profile link's name or the agency it was built
 * from, whatever the route or field.
 */
import { runFeed } from "@wren/core";
import { addMember, clients } from "@wren/core/clients";
import { portalMe, type Viewer } from "@wren/core/portal";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "../../src/demo/seed.js";
import { EMAIL_FILTERS, REPLY_FILTERS } from "../../src/portal/outbox.js";
import { DEMO_NAME, PortalRefusal, portalApi } from "../../src/portal/service.js";
import { setClientProfile } from "../../src/profile.js";
import { scoreCrmContacts } from "../../src/score.js";
import { deps as seedDeps, today } from "./demo-fixture.js";

let pg: TestPostgres;
const me = (r: { viewer: Viewer }) => portalMe(pg.db, r.viewer, DEMO_NAME);
/** Every transaction the portal opened, and how. */
const opened: unknown[] = [];
let api: ReturnType<typeof portalApi>;
let enrollmentId = 0;
let replyId = 0;
let runId = "";

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
  // How we found Cara, naming her every way a trail step can.
  await db.execute(sql`
    insert into person_lookups (person_id, state, tried)
    values (${cara}, 'matched', ${JSON.stringify([
      { step: "email", what: "cara.lim@umbrellahealth.com", outcome: "left: bounced" },
      {
        step: "search",
        what: "Cara Lim Umbrella Health",
        outcome: "2 people via exa; cara-lim-1: name differs (Cara Lin); cara-lim: matched",
      },
      { step: "profile", what: "cara-lim", outcome: "Cara Lim, Senior Recruiter at Initech" },
    ])}::jsonb)`);
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
  // A run that said what it found, naming Cara and Jane every way a line can.
  const [run] = await db.execute<{ id: string }>(
    sql`insert into runs (id, command, argv) values (gen_random_uuid(), 'crm run', '[]'::jsonb) returning id`,
  );
  runId = run?.id ?? "";
  const feed = runFeed(db, runId);
  await feed.emit({ step: "lookup", kind: "started", line: "Finding where each person is now" });
  await feed.emit({
    step: "lookup",
    kind: "found",
    subject: "Cara Lim",
    line: "Cara Lim moved to Initech, Senior Recruiter",
    source: { label: "Web search", href: "https://www.linkedin.com/in/cara-lim/" },
  });
  await feed.emit({
    step: "lookup",
    kind: "failed",
    subject: "Jane Doe",
    line: "Couldn't finish Jane Doe; it will be tried again",
    detail: "Error: 429 for jane.doe@umbrellahealth.com",
  });
  // The firm's side: an export named for the agency, a profile that signs as it, a fee.
  await db.execute(sql`update imports set source_ref = 'northside-bullhorn-export.csv'`);
  await setClientProfile(db, {
    firm: "Northside Talent",
    sells: "tech hires for startups",
    feeAvg: 22000,
    voice: "Plain and short.",
    recruiters: [{ name: "Sam Rivera", email: "sam@acme-talent.example" }],
    signature: "{name}\nNorthside Talent",
  });

  await db.insert(clients).values([
    {
      id: "demo",
      name: "Northside Talent",
      database: "wren_client_demo",
      demo: true,
      // Whose login researched the list: never shown, only that LinkedIn was used.
      accounts: { linkedin: "jane-doe-personal" },
    },
    { id: "acme", name: "Acme Staffing", database: "wren_client_acme" },
    { id: "beta", name: "Beta Search", database: "wren_client_beta" },
  ]);
  for (const email of ["owner@acme.example", "ops@acme.example"])
    await addMember(db, "acme", email);
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
const PERSON = "reactivation.person";
const operator = { viewer: { email: "william@wren.example", operator: true } };
const owner = { viewer: { email: "Owner@Acme.example" } };

/** A surname, an address's local part, a profile's name, the agency, the firm's fee. */
const LEAKS = [
  /\b(doe|lim|roe)\b/i,
  /jane\.|cara\.|bob\./i,
  /linkedin\.com\/in\/[^•]/i,
  /northside/i,
  /22000|22,000/,
];
const leaks = (v: unknown) => {
  const json = JSON.stringify(v);
  return LEAKS.filter((re) => re.test(json)).map(String);
};

describe("the demo", () => {
  it("is named by DEMO_NAME, never by the agency", async () => {
    expect(await me(demo)).toEqual({
      clients: [{ id: "demo", name: DEMO_NAME, demo: true }],
      demo: true,
      operator: false,
    });
  });

  it("no route leaks a name, an address or a profile", async () => {
    const cara = await personId("Cara Lim");
    const answers: [string, unknown][] = [
      ["overview", await api.overview(demo)],
      ["health", await api.health(demo)],
      ["setup", await api.setup(demo)],
      ["raw", await api.raw(demo)],
      ["raw search", await api.raw({ ...demo, via: "search" })],
      ["person", await api.person({ ...demo, personId: cara })],
      ["person jane", await api.person({ ...demo, personId: await personId("Jane Doe") })],
      ["run", await api.run(demo)],
      ["run after", await api.run({ ...demo, run: runId, after: 0 })],
      ["work lookup", await api.work({ ...demo, step: "lookup", subject: "Cara L." })],
      ["work signals", await api.work({ ...demo, step: "signals", subject: "Umbrella Health" })],
    ];
    answers.push(["people", await api.recordsList({ ...demo, record: PERSON, limit: 200 })]);
    for (const filter of EMAIL_FILTERS)
      answers.push([`emails ${filter}`, await api.emails({ ...demo, filter })]);
    for (const filter of REPLY_FILTERS)
      answers.push([`replies ${filter}`, await api.replies({ ...demo, filter })]);
    expect((await api.emails({ ...demo, filter: "all" })).rows).toHaveLength(1);
    expect((await api.replies({ ...demo, filter: "all" })).rows).toHaveLength(1);
    for (const [route, answer] of answers) expect(leaks(answer), route).toEqual([]);
    const work = answers.find(([r]) => r === "work lookup")?.[1] as Awaited<
      ReturnType<typeof api.work>
    >;
    expect(work.steps.length).toBe(3);
    expect(work.steps.some((x) => x.queryHref)).toBe(false);
  });

  it("the facts are still there, masked", async () => {
    const view = await api.person({ ...demo, personId: await personId("Cara Lim") });
    expect(view.row.name).toBe("Cara L.");
    expect(view.row.now).toMatchObject({ kind: "job_change", company: "Initech" });
    expect(view.brief?.text).toContain("Cara L. moved to Initech");
    expect(view.brief?.text).toContain("c•••@initech.example");
    expect(view.sources.map((s) => s.url)).toContain("https://www.linkedin.com/in/•••/");
    const people = await api.recordsList({ ...demo, record: PERSON, where: { now: ["moved"] } });
    expect(people.rows.map((r) => r.name)).toEqual(["Cara L."]);
  });

  it("setup says what was plugged in, never whose or from which file", async () => {
    const setup = await api.setup(demo);
    expect(setup.crm).toMatchObject({ format: "bullhorn", imports: 1 });
    expect(setup.research).toEqual(["linkedin"]);
    expect(setup.profile?.firm).toBe(DEMO_NAME);
    expect(setup.profile?.signature).toBe(`{name}\n${DEMO_NAME}`);
    expect(setup.profile?.recruiters).toEqual([
      { name: "Sam Rivera", email: "s•••@acme-talent.example" },
    ]);
    expect(setup.sending.live).toBe(false);
    expect(JSON.stringify(setup)).not.toMatch(/\.csv|export/i);
  });

  it("the overview carries every step, in order", async () => {
    const { pipeline } = await api.overview(demo);
    expect(pipeline.steps.map((s) => s.id)).toEqual([
      "list",
      "emails",
      "where",
      "hiring",
      "score",
      "briefs",
      "drafts",
      "approve",
      "sent",
      "replies",
    ]);
    expect(pipeline.sends).toBe(false);
    const step = (id: string) => pipeline.steps.find((s) => s.id === id);
    expect(step("list")?.state).toBe("done");
    expect(step("replies")).toMatchObject({ count: 1, state: "done" });
    expect(step("sent")?.state).not.toBe("next");
  });

  it("the run page: the live run, then only what is new, and the replay on first load", async () => {
    const first = await api.run(demo);
    expect(first.live).toMatchObject({ run: runId, command: "crm run", open: true });
    expect(first.live?.lines.map((l) => l.line)).toEqual([
      "Finding where each person is now",
      "Cara L. moved to Initech, Senior Recruiter",
      "Couldn't finish Jane D.; it will be tried again",
    ]);
    expect(first.live?.lines.map((l) => l.detail)).toEqual([null, null, null]);
    expect(first.live?.lines[1]?.source).toEqual({
      label: "Web search",
      href: "https://www.linkedin.com/in/•••/",
    });
    const story = first.story?.lines.map((l) => l.line) ?? [];
    expect(story).toContain("Cara L. moved to Initech, Senior Recruiter");
    expect(story).toContain("Umbrella Health is hiring: 2 open roles");
    expect(story).toContain("Wrote a brief on Cara L.: 2 sourced lines");
    expect(story).toContain("Drafted an email to Cara L.: waiting for your OK");
    // The seed checked no addresses: the replay leaves that step out rather than fill it in.
    const steps = [...new Set(first.story?.lines.map((l) => l.step))];
    expect(steps).toEqual(["lookup", "signals", "score", "brief", "compose"]);

    const again = await api.run({ ...demo, run: runId, after: first.live?.last ?? 0 });
    expect(again.live?.lines).toEqual([]);
    expect(again.live?.last).toBe(first.live?.last);
    expect(again.story).toBeNull();
    // A cursor from another run gets the whole of this one.
    const stale = await api.run({ ...demo, run: "an-older-run", after: 999 });
    expect(stale.live?.lines).toHaveLength(3);
  });

  it("reads in a read-only transaction", async () => {
    opened.length = 0;
    await api.overview(demo);
    await api.recordsList({ ...operator, client: "acme", record: PERSON });
    expect(opened).toEqual([{ accessMode: "read only" }, { accessMode: "read only" }]);
  });
});

describe("logins", () => {
  it("an operator sees every client by its real name, and real names on a real list", async () => {
    expect(await me(operator)).toEqual({
      clients: [
        { id: "acme", name: "Acme Staffing" },
        { id: "beta", name: "Beta Search" },
        { id: "demo", name: "Northside Talent", demo: true },
      ],
      demo: false,
      operator: true,
    });
    const acme = await api.recordsList({ ...operator, client: "acme", record: PERSON, q: "Doe" });
    expect(acme.rows.map((r) => r.name)).toEqual(["Jane Doe"]);
  });

  it("the technical why of a failed line is for operators only", async () => {
    const detail = async (who: typeof operator | typeof owner) =>
      (await api.run({ ...who, client: "acme" })).live?.lines.map((l) => l.detail);
    expect(await detail(operator)).toEqual([
      null,
      null,
      "Error: 429 for jane.doe@umbrellahealth.com",
    ]);
    expect(await detail(owner)).toEqual([null, null, null]);
    // Viewing as the client shows what the client sees.
    const asClient = await api.run({ ...operator, client: "acme", asClient: true });
    expect(asClient.live?.lines.map((l) => l.detail)).toEqual([null, null, null]);
  });

  it("an operator reading the demo still gets it masked", async () => {
    expect(leaks(await api.recordsList({ ...operator, client: "demo", record: PERSON }))).toEqual(
      [],
    );
  });

  it("a client login sees only its own clients, whatever the case of its email", async () => {
    expect(await me(owner)).toEqual({
      clients: [{ id: "acme", name: "Acme Staffing" }],
      demo: false,
      operator: false,
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
    await expect(api.approve({ ...demo, ids: [enrollmentId] })).rejects.toEqual(refusal(403));
    await expect(api.book({ ...demo, threadEventId: replyId })).rejects.toEqual(refusal(403));
    await expect(api.unapprove({ ...demo, ids: [enrollmentId] })).rejects.toEqual(refusal(403));
    await expect(api.skip({ ...operator, client: "demo", ids: [enrollmentId] })).rejects.toEqual(
      refusal(403),
    );
    expect((await api.emails({ ...owner, filter: "awaiting" })).total).toBe(1);
  });

  it("a demo reply carries no bill: prices stay off public pages", async () => {
    expect((await api.replies(demo)).bill).toBeNull();
    expect((await api.replies(owner)).bill).toMatchObject({ meetings: 0, total: 1000 });
  });

  it("a client approves, marks a meeting, and a second click changes nothing", async () => {
    const first = await api.approve({ ...owner, ids: [enrollmentId, 999_999] });
    expect(first).toEqual({ done: [enrollmentId], skipped: [999_999] });
    expect(await api.approve({ ...owner, ids: [enrollmentId] })).toEqual({
      done: [],
      skipped: [enrollmentId],
    });
    // Undo puts it back to approve, once; then approve it again for the rest.
    expect(await api.unapprove({ ...owner, ids: [enrollmentId] })).toEqual({
      done: [enrollmentId],
      skipped: [],
    });
    expect((await api.emails({ ...owner, filter: "awaiting" })).total).toBe(1);
    expect((await api.unapprove({ ...owner, ids: [enrollmentId] })).done).toEqual([]);
    await api.approve({ ...owner, ids: [enrollmentId] });
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
    await expect(api.approve({ ...owner, ids: ["1; drop" as never] })).rejects.toEqual(
      refusal(404),
    );
  });
});
