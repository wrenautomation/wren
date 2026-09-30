/**
 * The compose stage against the migrated schema: who is due, what one pass
 * writes, the day's budget, approval, the gate, races, suppression, status and
 * `crm run --only`. People are imported and verified for real; scores and
 * briefs are seeded directly. Tests that expose a bug assert the correct
 * behavior and are marked "Was a bug".
 */
import { FakeVerifier, type LocalCheckerLike } from "@wren/channel-email";
import type { SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm, LlmError } from "@wren/llm";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  composeCrmEmails,
  composeDue,
  composeEligible,
  composeRoom,
  composeSubjects,
  type Draft,
} from "../../src/compose.js";
import { CRM_FORMATS } from "../../src/crm/formats.js";
import { runCrmImport } from "../../src/crm/import.js";
import { CrmCsvSource } from "../../src/crm/source.js";
import { checkCrmEmails } from "../../src/crm/verify.js";
import { readClientProfile, setClientProfile } from "../../src/profile.js";
import { runCrm } from "../../src/run.js";
import type { ClientProfile } from "../../src/schema.js";
import { parseReactivationSettings, type ReactivationSettings } from "../../src/settings.js";
import { crmStatus } from "../../src/status.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
const db = () => pg.db;

const checker: LocalCheckerLike = {
  async check(email) {
    return { email, failure: null, flags: [], mxHosts: ["mx"], mxPath: "mx", passed: true };
  },
};

const HEADER = "ID,Name,Email,Company,Website,Owner";
const ROWS = [
  "1,Jane Doe,jane@acmestaffing.com,Acme Staffing,https://acmestaffing.com,alee",
  "2,Bob Roe,bob@acmestaffing.com,Acme Staffing,https://acmestaffing.com,Bob Roe",
  "3,Carl Poe,carl@betarecruit.com,Beta Recruit,https://betarecruit.com,",
  "4,Dana Fox,dana@gammahire.com,Gamma Hire,https://gammahire.com,ALEE",
];
async function importRows(rows: string[]) {
  const f = CRM_FORMATS.get("crm-generic");
  if (!f) throw new Error("crm-generic");
  const csv = [HEADER, ...rows].join("\n");
  await runCrmImport(db(), new CrmCsvSource(f, "export.csv", new TextEncoder().encode(csv)));
  await checkCrmEmails(db(), new FakeVerifier({ authoritative: true }), checker);
}

const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T> => {
  const [r] = await db().execute<T>(q);
  if (!r) throw new Error("no row");
  return r as T;
};
const rows = <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) =>
  db().execute<T>(q) as Promise<T[]>;
const pid = async (first: string) =>
  (await one<{ id: number }>(sql`select id from people where first_name = ${first}`)).id;
const cid = async (name: string) =>
  (await one<{ id: number }>(sql`select id from companies where name = ${name}`)).id;

async function scoreAndBrief(first: string, score: number, text?: string, state = "written") {
  const p = await pid(first);
  await db().execute(sql`
    insert into contact_scores (person_id, score, reasons) values (${p}, ${score}, '[]'::jsonb)
    on conflict (person_id) do update set score = excluded.score`);
  await db().execute(sql`
    insert into briefs (person_id, state, text, citations, dropped, inputs_hash, model, prompt_version)
    values (${p}, ${state}, ${text ?? `${first} is still there since 2019. [c1]`},
      '{"findings":[],"crm":[1]}'::jsonb, '[]'::jsonb, ${`hash-${first}`}, 'fake', 'v1')
    on conflict (person_id) do update set state = excluded.state, text = excluded.text`);
}

let keys = 0;
async function finding(kind: string, person: number, confidence = 0.9) {
  keys += 1;
  await db().execute(sql`
    insert into findings (kind, person_id, fact_key, value, confidence, via, observed_at)
    values (${kind}, ${person}, ${`test:${keys}`}, '{}'::jsonb, ${confidence}, 'linkedin@research', now())`);
}

async function enrollment(e: {
  person: number | null;
  company: number;
  to: string;
  state?: "active" | "finished" | "stopped";
  offer?: string;
}): Promise<number> {
  const state = e.state ?? "active";
  const r = await one<{ id: number }>(sql`
    insert into enrollments (person_id, niche, sequence_name, sequence_snapshot, offer, state,
      stop_reason, company_id, kind, to_email, sender)
    values (${e.person}, 'reactivation', 'reactivation', '{}'::jsonb, ${e.offer ?? "reactivation"},
      ${state}, ${state === "stopped" ? "manual" : null}, ${e.company},
      ${e.person === null ? "role_inbox" : "person"}, ${e.to}, 'x@mail.example')
    returning id`);
  return r.id;
}

async function failedComposition(person: number, hoursAgo: number) {
  await db().execute(sql`
    insert into compositions (person_id, state, detail, inputs_hash, model, prompt_version, created_at)
    values (${person}, 'failed', 'test', 'h', 'fake', 'v1', now() - make_interval(hours => ${hoursAgo}))`);
}

const PROFILE = {
  firm: "Northside Talent",
  sells: "senior engineers in fintech",
  voice: "plain and warm",
  recruiters: [
    { name: "Ann Lee", email: "ann@northside.example", owners: ["alee"] },
    { name: "Bob Roe", email: "bob@northside.example", owners: [] },
  ],
  defaultRecruiter: "bob@northside.example",
  signature: "{name}\nNorthside Talent",
};
const settingsWith = (over: Record<string, unknown> = {}): ReactivationSettings =>
  parseReactivationSettings({
    on: true,
    senders: [
      { address: "ann@mail.example", name: "Ann Lee", recruiter: "ann@northside.example" },
      { address: "bob@mail.example", name: "Bob Roe", recruiter: "bob@northside.example" },
    ],
    ...over,
  });

/** Writes a clean draft to whoever the prompt greets; `answer` swaps it per test. */
let answer: (prompt: string, first: string) => string | Promise<string>;
const cleanDraft = (first: string): Draft => ({
  subject: "quick question",
  opener: `Hi ${first},\nI noticed you are still there. Worth a short call? Reply with a couple of times that work and I'll book it. Thanks for reading.`,
  followup: `Hi ${first}, a quick nudge on that short call.`,
});
const llm = new FakeLlm({
  respond: (prompt) => {
    const first = /Start with "Hi ([^,"]+),"/.exec(prompt)?.[1] ?? "there";
    return answer(prompt, first);
  },
});

let profile: ClientProfile;
beforeEach(async () => {
  await truncate(pg.db, [
    "compositions",
    "handoffs",
    "messages",
    "enrollments",
    "client_profile",
    "suppressions",
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
  answer = (_p, first) => JSON.stringify(cleanDraft(first));
  await importRows(ROWS);
  await scoreAndBrief("Jane", 50);
  await scoreAndBrief("Bob", 40);
  await scoreAndBrief("Carl", 30);
  await scoreAndBrief("Dana", 20);
  profile = await setClientProfile(db(), PROFILE);
});

const compose = (settings = settingsWith(), limit?: number, p: ClientProfile | null = profile) =>
  composeCrmEmails(db(), llm, { settings, profile: p, ...(limit ? { limit } : {}) });
const names = async () => (await composeSubjects(db())).map((s) => s.firstName);

describe("who is due", () => {
  it("best score first, one per company", async () => {
    expect(await names()).toEqual(["Jane", "Carl", "Dana"]);
    expect(await composeEligible(db())).toBe(3);
  });

  it("a catch-all address is written to only when the client allows it", async () => {
    const catchAll = async (authoritative: boolean) => {
      await db().execute(sql`delete from verifications where email = 'carl@betarecruit.com'`);
      await db().execute(sql`
        update contact_candidates set state = 'candidate' where email = 'carl@betarecruit.com'`);
      await db().execute(sql`
        insert into verifications (contact_candidate_id, email, verifier, result, raw)
        select id, email, 'smtp', 'catch_all', ${JSON.stringify({ authoritative })}::jsonb
        from contact_candidates where email = 'carl@betarecruit.com'`);
    };
    await catchAll(true);
    expect(await names()).toEqual(["Jane", "Dana"]);
    const allowed = async () =>
      (await composeSubjects(db(), { catchAll: true })).map((s) => s.firstName);
    expect(await allowed()).toEqual(["Jane", "Carl", "Dana"]);
    expect(await composeEligible(db(), true)).toBe(3);
    // A verifier that can't be trusted to say catch-all says nothing.
    await catchAll(false);
    expect(await allowed()).toEqual(["Jane", "Dana"]);
  });

  it("the brief goes out with its marks taken out", async () => {
    const [s] = await composeSubjects(db(), { limit: 1 });
    expect(s?.brief).toBe("Jane is still there since 2019.");
    expect(s?.owner).toBe("alee");
    expect(s?.email).toBe("jane@acmestaffing.com");
  });

  it("score 0, an empty brief, or no brief is not due", async () => {
    await scoreAndBrief("Jane", 0);
    await scoreAndBrief("Carl", 30, "nothing", "empty");
    await db().execute(sql`delete from briefs where person_id = ${await pid("Dana")}`);
    expect(await names()).toEqual(["Bob"]);
  });

  it("an address that is not verified is not due", async () => {
    await truncate(pg.db, ["people", "companies", "imports", "crm_contacts"]);
    await importRows([
      "3,Carl Poe,carl+risky@betarecruit.com,Beta Recruit,https://betarecruit.com,",
      "4,Dana Fox,dana@gammahire.com,Gamma Hire,https://gammahire.com,",
    ]);
    await scoreAndBrief("Carl", 30);
    await scoreAndBrief("Dana", 20);
    expect(await names()).toEqual(["Dana"]);
  });

  it("moved or left is not due; the next person at the firm is", async () => {
    await finding("job_change", await pid("Jane"));
    await finding("left", await pid("Carl"));
    expect(await names()).toEqual(["Bob", "Dana"]);
  });

  it("a surer still_there outweighs a job_change", async () => {
    await finding("job_change", await pid("Jane"), 0.5);
    await finding("still_there", await pid("Jane"), 0.95);
    expect((await names())[0]).toBe("Jane");
  });

  it("anyone ever enrolled is not due; a finished enrollment frees the company", async () => {
    await enrollment({
      person: await pid("Jane"),
      company: await cid("Acme Staffing"),
      to: "jane@acmestaffing.com",
      state: "finished",
    });
    expect(await names()).toEqual(["Bob", "Carl", "Dana"]);
  });

  it("an active thread at the company or to the address blocks it", async () => {
    await enrollment({
      person: null,
      company: await cid("Acme Staffing"),
      to: "info@acme.example",
    });
    // Another firm's row, same address, different case.
    await enrollment({
      person: null,
      company: await cid("Gamma Hire"),
      to: "CARL@BetaRecruit.com",
    });
    expect(await names()).toEqual([]);
  });

  it("a failure today backs off a day; three failures stop it", async () => {
    await failedComposition(await pid("Jane"), 1);
    await failedComposition(await pid("Carl"), 30);
    await failedComposition(await pid("Carl"), 50);
    await failedComposition(await pid("Dana"), 30);
    await failedComposition(await pid("Dana"), 50);
    await failedComposition(await pid("Dana"), 70);
    expect(await names()).toEqual(["Bob", "Carl"]);
  });
});

describe("one pass", () => {
  it("an enrollment and two messages per contact, from the owner's recruiter", async () => {
    const stats = await compose();
    expect(stats).toMatchObject({ selected: 3, drafted: 3, approved: 0, failed: 0, aborted: null });
    const ens = await rows<{
      person_id: number;
      sender: string;
      to_email: string;
      state: string;
      offer: string;
      niche: string;
    }>(sql`select * from enrollments order by id`);
    expect(ens.map((e) => [e.to_email, e.sender])).toEqual([
      ["jane@acmestaffing.com", "ann@mail.example"],
      ["carl@betarecruit.com", "bob@mail.example"],
      ["dana@gammahire.com", "ann@mail.example"],
    ]);
    expect(ens.every((e) => e.state === "active" && e.offer === "reactivation")).toBe(true);

    const msgs = await rows<{
      step: number;
      subject: string | null;
      body: string;
      state: string;
      approved_by: string | null;
      approved_at: Date | null;
      template: string;
      provenance: { recruiter: string | null; owner: string | null };
    }>(sql`
      select m.* from messages m join enrollments e on e.id = m.enrollment_id
      where e.to_email = 'jane@acmestaffing.com' order by m.step`);
    expect(msgs.map((m) => [m.step, m.template, m.subject])).toEqual([
      [0, "reactivation_opener", "quick question"],
      [1, "reactivation_followup", null],
    ]);
    for (const m of msgs) {
      expect(m.body.endsWith("\n\nAnn Lee\nNorthside Talent")).toBe(true);
      expect(m.body).not.toContain("{name}");
      expect(m.state).toBe("draft");
      expect(m.approved_by).toBeNull();
      expect(m.approved_at).toBeNull();
      expect(m.provenance).toMatchObject({ owner: "alee", recruiter: "ann@northside.example" });
    }
    const comps = await rows<{ state: string; enrollment_id: number | null }>(
      sql`select state, enrollment_id from compositions`,
    );
    expect(comps).toHaveLength(3);
    expect(comps.every((c) => c.state === "drafted" && c.enrollment_id !== null)).toBe(true);
  });

  it("the model's CRLF and trailing spaces are tidied before storing", async () => {
    answer = (_p, first) =>
      JSON.stringify({
        subject: "  quick question  ",
        opener: `Hi ${first},   \r\n\r\n\r\n\r\nWorth a short call?  \r\nThanks.`,
        followup: `Hi ${first}, nudge.`,
      });
    await compose(settingsWith(), 1);
    const m = await one<{ subject: string; body: string }>(
      sql`select subject, body from messages where step = 0`,
    );
    expect(m.subject).toBe("quick question");
    expect(m.body.startsWith("Hi Jane,\n\nWorth a short call?\nThanks.")).toBe(true);
  });

  it("a second pass writes nothing new", async () => {
    await compose();
    const again = await compose();
    expect(again).toMatchObject({ selected: 0, drafted: 0 });
    expect((await one<{ n: number }>(sql`select count(*)::int n from enrollments`)).n).toBe(3);
    expect((await one<{ n: number }>(sql`select count(*)::int n from messages`)).n).toBe(6);
  });
});

describe("the day's budget", () => {
  it("perDay caps a pass; drafts waiting for approval hold the next", async () => {
    const s = settingsWith({ compose: { perDay: 2 } });
    expect(await compose(s)).toMatchObject({ selected: 2, drafted: 2 });
    expect(await composeRoom(db(), 2)).toBe(0);
    expect(await compose(s)).toMatchObject({ selected: 0, drafted: 0 });
    expect(await composeDue(db(), s, profile)).toEqual({
      due: 0,
      blocked: "today's 2 are written or waiting for approval",
    });
  });

  it("--limit caps below the room", async () => {
    expect(await compose(settingsWith(), 1)).toMatchObject({ selected: 1, drafted: 1 });
    expect(await composeRoom(db(), 20)).toBe(19);
  });

  it("drafts yesterday still waiting count against today", async () => {
    await compose(settingsWith(), 2);
    await db().execute(sql`update compositions set created_at = now() - interval '2 days'`);
    expect(await composeRoom(db(), 3)).toBe(1);
  });

  it("perDay 0 writes nothing", async () => {
    expect(await compose(settingsWith({ compose: { perDay: 0 } }))).toMatchObject({
      selected: 0,
      drafted: 0,
    });
  });
});

describe("approval", () => {
  const approveAll = (by: string) =>
    db().execute(
      sql`update messages set state = 'approved', approved_at = now(), approved_by = ${by}`,
    );

  it("first: drafts until a person approved one, then the rest flow", async () => {
    expect(await compose(settingsWith(), 1)).toMatchObject({ drafted: 1, approved: 0 });
    await approveAll("client");
    expect(await compose(settingsWith(), 1)).toMatchObject({ drafted: 1, approved: 1 });
    const m = await rows<{ state: string; approved_by: string; approved_at: Date | null }>(sql`
      select m.state, m.approved_by, m.approved_at from messages m
      join enrollments e on e.id = m.enrollment_id where e.to_email like 'carl%'`);
    expect(m).toHaveLength(2);
    for (const x of m) {
      expect(x.state).toBe("approved");
      expect(x.approved_by).toBe("auto");
      expect(x.approved_at).not.toBeNull();
    }
  });

  it("first: an auto approval is not a person's", async () => {
    await compose(settingsWith(), 1);
    await approveAll("auto");
    expect(await compose(settingsWith(), 1)).toMatchObject({ drafted: 1, approved: 0 });
  });

  it("every: always drafts", async () => {
    await compose(settingsWith({ approval: "every" }), 1);
    await approveAll("operator");
    expect(await compose(settingsWith({ approval: "every" }), 1)).toMatchObject({
      drafted: 1,
      approved: 0,
    });
  });
});

describe("the gate and the model", () => {
  it("a draft the gate refuses is a failed composition, and backs off", async () => {
    answer = (_p, first) =>
      JSON.stringify({ ...cleanDraft(first), opener: `Hi ${first}, only $500 a meeting.` });
    expect(await compose(settingsWith(), 1)).toMatchObject({ failed: 1, drafted: 0 });
    const c = await one<{ state: string; detail: string; enrollment_id: number | null }>(
      sql`select state, detail, enrollment_id from compositions`,
    );
    expect(c.state).toBe("failed");
    expect(c.detail).toMatch(/opener: a price/);
    expect(c.enrollment_id).toBeNull();
    expect((await one<{ n: number }>(sql`select count(*)::int n from enrollments`)).n).toBe(0);
    expect((await names())[0]).toBe("Bob");
  });

  it("an answer that does not parse is a failed composition", async () => {
    answer = () => "sorry, no";
    expect(await compose(settingsWith(), 1)).toMatchObject({ failed: 1 });
    expect((await one<{ detail: string }>(sql`select detail from compositions`)).detail).toMatch(
      /did not parse/,
    );
  });

  it("a provider error aborts the pass and records nothing", async () => {
    answer = () => {
      throw new LlmError("HTTP 529", { status: 529 });
    };
    const s = await compose();
    expect(s.aborted).toMatch(/529/);
    expect((await one<{ n: number }>(sql`select count(*)::int n from compositions`)).n).toBe(0);
  });

  it("lost race: nothing half-written, the composition says why", async () => {
    const acme = await cid("Acme Staffing");
    answer = async (_p, first) => {
      if (first === "Jane")
        await enrollment({ person: null, company: acme, to: "info@acme.example" });
      return JSON.stringify(cleanDraft(first));
    };
    const s = await compose();
    expect(s).toMatchObject({ raced: 1, drafted: 2, errors: 0 });
    const jane = await pid("Jane");
    expect(
      (
        await one<{ n: number }>(
          sql`select count(*)::int n from enrollments where person_id = ${jane}`,
        )
      ).n,
    ).toBe(0);
    expect(
      (
        await one<{ n: number }>(
          sql`select count(*)::int n from messages where to_email like 'jane%'`,
        )
      ).n,
    ).toBe(0);
    const c = await one<{ detail: string }>(
      sql`select detail from compositions where person_id = ${jane}`,
    );
    expect(c.detail).toBe("already enrolled when it was written");
  });

  // Was a bug (design): a lost race is stored as `failed`, so it counts toward MAX_FAILURES and the
  // one-day backoff, and shows in status as a failed email though the model did nothing wrong.
  it("a lost race is not a failure of the person", async () => {
    const acme = await cid("Acme Staffing");
    answer = async (_p, first) => {
      if (first === "Jane")
        await enrollment({ person: null, company: acme, to: "info@acme.example" });
      return JSON.stringify(cleanDraft(first));
    };
    await compose();
    const status = await crmStatus(db(), { compose: { settings: settingsWith(), profile } });
    expect(status.emails.failed).toBe(0);
  });

  // Was a bug (waste): two people at different firms sharing one address are both picked in one
  // pass; the second is paid for, then loses the address race by construction.
  it("one address is written to once per pass", async () => {
    await truncate(pg.db, ["people", "companies", "imports", "crm_contacts"]);
    await importRows([
      "3,Carl Poe,team@sharedinbox.com,Beta Recruit,https://betarecruit.com,",
      "4,Dana Fox,team@sharedinbox.com,Gamma Hire,https://gammahire.com,",
    ]);
    const people = await rows<{ n: number }>(sql`select count(*)::int n from people`);
    if (people[0]?.n !== 2) return; // the importer merged them: nothing to test
    await scoreAndBrief("Carl", 30);
    await scoreAndBrief("Dana", 20);
    let calls = 0;
    answer = (_p, first) => {
      calls += 1;
      return JSON.stringify(cleanDraft(first));
    };
    const s = await compose();
    expect(s.raced).toBe(0);
    expect(calls).toBe(1);
  });
});

describe("suppression", () => {
  const suppress = (kind: string, value: string) =>
    db().execute(
      sql`insert into suppressions (kind, value, reason) values (${kind}, ${value}, 'opt_out')`,
    );

  it("a suppressed address or domain is skipped, the rest are written", async () => {
    await suppress("email", "jane@acmestaffing.com");
    await suppress("domain", "gammahire.com");
    // Suppressed contacts are never picked, so Bob takes Acme's slot from Jane.
    expect(await compose()).toMatchObject({ selected: 2, suppressed: 0, drafted: 2 });
    expect(
      (
        await rows<{ to_email: string }>(sql`select to_email from enrollments order by to_email`)
      ).map((r) => r.to_email),
    ).toEqual(["bob@acmestaffing.com", "carl@betarecruit.com"]);
  });

  // Was a bug: suppressed contacts were never excluded in SQL and never recorded, so they take the
  // top of every pass's budget. With a small budget, compose never reaches anyone else.
  it("suppressed contacts do not starve the rest of the list", async () => {
    await suppress("email", "jane@acmestaffing.com");
    await compose(settingsWith(), 1);
    await compose(settingsWith(), 1);
    // One a pass, both to contacts who can be written to.
    expect((await one<{ n: number }>(sql`select count(*)::int n from enrollments`)).n).toBe(2);
  });

  // Was a bug: same root: status and `crm run` count a suppressed contact as due forever.
  it("a suppressed contact is not due", async () => {
    await truncate(pg.db, ["contact_scores"]);
    await scoreAndBrief("Jane", 50);
    await suppress("email", "jane@acmestaffing.com");
    expect(await composeEligible(db())).toBe(0);
  });
});

describe("blocked", () => {
  it("each reason aborts the pass without a call", async () => {
    let calls = 0;
    answer = (_p, first) => {
      calls += 1;
      return JSON.stringify(cleanDraft(first));
    };
    expect((await compose(settingsWith(), undefined, null)).aborted).toMatch(/no firm profile/);
    expect((await compose(settingsWith({ senders: [] }))).aborted).toMatch(/no senders/);
    expect((await compose(settingsWith({ stages: { compose: false } }))).aborted).toMatch(
      /stages.compose/,
    );
    await db().execute(sql`delete from verifications`);
    expect((await compose()).aborted).toMatch(/not ready to send: not verified yet/);
    expect(calls).toBe(0);
  });
});

describe("crm status: emails", () => {
  it("counts before and after a pass", async () => {
    const opts = { compose: { settings: settingsWith(), profile } };
    const before = await crmStatus(db(), opts);
    expect(before.emails).toMatchObject({ drafted: 0, awaiting: 0, due: 3, blocked: null });
    expect(before.due).toContain("compose");
    expect(before.next).toMatch(/write 3 emails/);
    await compose();
    const after = await crmStatus(db(), opts);
    expect(after.emails).toMatchObject({
      drafted: 3,
      awaiting: 3,
      approved: 0,
      sent: 0,
      failed: 0,
      due: 0,
    });
    expect(after.due).not.toContain("compose");
  });

  it("without settings compose is never due", async () => {
    const s = await crmStatus(db());
    expect(s.emails).toMatchObject({ due: 0, blocked: "settings not given" });
    expect(s.due).not.toContain("compose");
  });

  // Was a bug: `awaiting` counts step-0 drafts of stopped enrollments, which nobody will ever
  // approve; composeRoom counts only active ones, so the two disagree.
  it("awaiting approval counts only live threads", async () => {
    await compose(settingsWith(), 1);
    await db().execute(sql`update enrollments set state = 'stopped', stop_reason = 'manual'`);
    const s = await crmStatus(db(), { compose: { settings: settingsWith(), profile } });
    expect(s.emails.awaiting).toBe(0);
  });
});

describe("crm run", () => {
  const deps = (withLlm = true) => ({
    verifier: new FakeVerifier({ authoritative: true }),
    checker,
    sites: {
      async call() {
        throw new Error("no sites in this test");
      },
      async via() {
        return "api";
      },
    } as SiteClient,
    fetcher: null,
    llm: withLlm ? llm : null,
  });

  it("only compose: the other due stages wait", async () => {
    const compose = { settings: settingsWith(), profile };
    const stages = await runCrm(db(), deps(), { linkedin: null, compose, only: ["compose"] });
    expect(stages.map((s) => s.stage)).toEqual(["compose"]);
    expect(stages[0]?.stats).toMatchObject({ drafted: 3 });
    expect((await crmStatus(db(), { compose })).due).toContain("lookup");
  });

  it("only a stage that is not due does nothing", async () => {
    const compose = { settings: settingsWith(), profile };
    expect(await runCrm(db(), deps(), { linkedin: null, compose, only: ["verify"] })).toEqual([]);
  });

  it("--limit reaches compose", async () => {
    const compose = { settings: settingsWith(), profile };
    const [r] = await runCrm(db(), deps(), {
      linkedin: null,
      compose,
      only: ["compose"],
      limit: 1,
    });
    expect(r?.stats).toMatchObject({ selected: 1, drafted: 1 });
  });

  it("no LLM: compose stops and says why", async () => {
    const compose = { settings: settingsWith(), profile };
    const [r] = await runCrm(db(), deps(false), { linkedin: null, compose, only: ["compose"] });
    expect(r?.stats.aborted).toMatch(/emails need an LLM/);
  });
});

describe("profile", () => {
  it("round trips, replaces whole, and moves updatedAt", async () => {
    const first = await readClientProfile(db());
    expect(first).toMatchObject({
      one: true,
      firm: "Northside Talent",
      feeAvg: null,
      defaultRecruiter: "bob@northside.example",
    });
    expect(first?.recruiters).toEqual(PROFILE.recruiters);
    const second = await setClientProfile(db(), {
      firm: " Other Firm ",
      sells: "s",
      voice: "v",
      signature: "sig",
      feeAvg: 20000,
    });
    expect(second).toMatchObject({
      firm: "Other Firm",
      recruiters: [],
      defaultRecruiter: null,
      feeAvg: 20000,
    });
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(
      (first as ClientProfile).updatedAt.getTime(),
    );
    expect((await one<{ n: number }>(sql`select count(*)::int n from client_profile`)).n).toBe(1);
    expect(await readClientProfile(db())).toEqual(second);
  });

  it("a bad profile writes nothing", async () => {
    await expect(setClientProfile(db(), { ...PROFILE, firm: "" })).rejects.toThrow(/firm/);
    expect((await readClientProfile(db()))?.firm).toBe("Northside Talent");
  });
});
