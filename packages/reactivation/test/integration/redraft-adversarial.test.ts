/**
 * Redraft against the migrated schema: which pairs it rewrites, what it leaves
 * alone, races with approval and edits, failures, and the counts around it.
 * Drafts are written by the real compose stage first; people are imported and
 * verified for real, scores and briefs seeded. Tests that expose a bug assert
 * the correct behavior and are marked "Bug".
 */
import { FakeVerifier, type LocalCheckerLike } from "@wren/channel-email";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm, LlmError } from "@wren/llm";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approveDrafts, skipDrafts } from "../../src/approve.js";
import { briefLines } from "../../src/brief.js";
import {
  COMPOSE_VERSION,
  composeCrmEmails,
  composeRoom,
  redraftAwaiting,
} from "../../src/compose.js";
import { CRM_FORMATS } from "../../src/crm/formats.js";
import { runCrmImport } from "../../src/crm/import.js";
import { CrmCsvSource } from "../../src/crm/source.js";
import { checkCrmEmails } from "../../src/crm/verify.js";
import { whyOf } from "../../src/portal/outbox.js";
import { setClientProfile } from "../../src/profile.js";
import type { ClientProfile } from "../../src/schema.js";
import {
  parseReactivationSettings,
  type ReactivationSettings,
  type Sender,
} from "../../src/settings.js";
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

async function scoreAndBrief(first: string, score: number, text?: string) {
  const p = await pid(first);
  await db().execute(sql`
    insert into contact_scores (person_id, score, reasons, next_step)
    values (${p}, ${score}, '[]'::jsonb, ${score > 0 ? "reach_out" : "none"})
    on conflict (person_id) do update set score = excluded.score, next_step = excluded.next_step`);
  await db().execute(sql`
    insert into briefs (person_id, state, text, citations, dropped, inputs_hash, model, prompt_version)
    values (${p}, 'written', ${text ?? `${first} is still there since 2019. [c1]`},
      '{"findings":[],"crm":[1]}'::jsonb, '[]'::jsonb, ${`hash-${first}`}, 'fake', 'v1')
    on conflict (person_id) do update set text = excluded.text, inputs_hash = excluded.inputs_hash`);
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

/** The first compose pass: short, a bare string, no why. */
const firstDraft = (first: string) => ({
  subject: "quick question",
  opener: `Hi ${first},\nI noticed you are still there. Worth a short call? Reply with a couple of times that work and I'll book it. Thanks for reading.`,
  followup: `Hi ${first}, a quick nudge on that short call.`,
});
/** The redraft: paragraphs, each with the brief lines it rests on. */
const secondDraft = (first: string) => ({
  subject: "a short call",
  opener: [
    { text: `Hi ${first},` },
    { text: "I noticed you are still there.", from: [1] },
    {
      text: "Worth a short call? Reply with a couple of times that work and I'll book it. Thanks for reading.",
    },
  ],
  followup: [{ text: `Hi ${first}, a quick nudge on that short call.`, from: ["1"] }],
});

let answer: (prompt: string, first: string) => string | Promise<string>;
let asked: string[] = [];
const llm = new FakeLlm({
  respond: (prompt) => {
    const first = /Start with "Hi ([^,"]+),"/.exec(prompt)?.[1] ?? "there";
    asked.push(first);
    return answer(prompt, first);
  },
});

let profile: ClientProfile;
let settings: ReactivationSettings;
/** Enrollment ids by first name, as the first compose pass made them. */
let enr: Record<string, number> = {};

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
  await importRows(ROWS);
  await scoreAndBrief("Jane", 50);
  await scoreAndBrief("Carl", 30);
  await scoreAndBrief("Dana", 20);
  profile = await setClientProfile(db(), PROFILE);
  settings = settingsWith();
  answer = (_p, first) => JSON.stringify(firstDraft(first));
  const made = await composeCrmEmails(db(), llm, { settings, profile });
  if (made.drafted !== 3) throw new Error(`fixture: drafted ${JSON.stringify(made)}`);
  enr = Object.fromEntries(
    (
      await rows<{ first_name: string; id: number }>(sql`
        select p.first_name, e.id from enrollments e join people p on p.id = e.person_id`)
    ).map((r) => [r.first_name, Number(r.id)]),
  );
  answer = (_p, first) => JSON.stringify(secondDraft(first));
  asked = [];
});

const redraft = (
  opts: { enrollmentIds?: number[]; senders?: readonly Sender[]; p?: ClientProfile | null } = {},
) =>
  redraftAwaiting(db(), llm, {
    profile: opts.p === undefined ? profile : opts.p,
    senders: opts.senders ?? settings.senders,
    ...(opts.enrollmentIds ? { enrollmentIds: opts.enrollmentIds } : {}),
  });

interface Msg extends Record<string, unknown> {
  id: number;
  step: number;
  subject: string | null;
  body: string;
  state: string;
  template_version: string;
  edited_at: unknown;
  provenance: Record<string, unknown>;
}
const messagesOf = (enrollmentId: number | undefined) =>
  rows<Msg>(sql`
    select id, step, subject, body, state, template_version, edited_at, provenance
    from messages where enrollment_id = ${enrollmentId ?? -1} order by step`);
const bodies = async (enrollmentId: number | undefined) =>
  (await messagesOf(enrollmentId)).map((m) => m.body);
const isRedrafted = async (enrollmentId: number | undefined) =>
  (await messagesOf(enrollmentId))[0]?.subject === "a short call";

describe("what it rewrites", () => {
  it("every awaiting pair, in place: same enrollment, address, mailbox and message rows", async () => {
    const before = await rows<{ id: number; to_email: string; sender: string }>(
      sql`select id, to_email, sender from enrollments order by id`,
    );
    const ids = (await rows<{ id: number }>(sql`select id from messages order by id`)).map(
      (m) => m.id,
    );
    expect(await redraft()).toEqual({
      selected: 3,
      redrafted: 3,
      failed: 0,
      skipped: 0,
      aborted: null,
    });
    expect(
      await rows<{ id: number; to_email: string; sender: string }>(
        sql`select id, to_email, sender from enrollments order by id`,
      ),
    ).toEqual(before);
    expect(
      (await rows<{ id: number }>(sql`select id from messages order by id`)).map((m) => m.id),
    ).toEqual(ids);
    for (const id of Object.values(enr)) {
      const [opener, followup] = await messagesOf(id);
      expect(opener?.subject).toBe("a short call");
      expect(opener?.state).toBe("draft");
      expect(followup?.subject).toBeNull();
      expect(followup?.state).toBe("draft");
      expect(opener?.template_version).toBe(COMPOSE_VERSION);
      expect(
        opener?.body.endsWith("\n\nAnn Lee\nNorthside Talent") ||
          opener?.body.endsWith("\n\nBob Roe\nNorthside Talent"),
      ).toBe(true);
    }
  });

  it("the new provenance carries today's brief lines and a why the portal can read", async () => {
    await scoreAndBrief("Jane", 50, "Jane is still there since 2019. [c1] She leads hiring. [c1]");
    await redraft({ enrollmentIds: [enr.Jane ?? -1] });
    const [opener, followup] = await messagesOf(enr.Jane);
    const brief = opener?.provenance.brief as { lines: string[] };
    expect(brief.lines).toEqual(
      briefLines("Jane is still there since 2019. [c1] She leads hiring. [c1]"),
    );
    expect(opener?.provenance.composer).toBe(COMPOSE_VERSION);
    const why = whyOf(opener?.provenance, followup?.provenance);
    expect(why?.opener).toEqual([{ text: "I noticed you are still there.", lines: [0] }]);
    expect(why?.followup).toEqual([
      { text: "Hi Jane, a quick nudge on that short call.", lines: [0] },
    ]);
    const paragraphs = (opener?.body ?? "").split(/\n{2,}/).map((p) => p.trim());
    for (const w of why?.opener ?? []) expect(paragraphs).toContain(w.text);
  });

  it("named ids: only those, whatever else waits", async () => {
    const s = await redraft({ enrollmentIds: [enr.Carl ?? -1] });
    expect(s).toMatchObject({ selected: 1, redrafted: 1 });
    expect(await isRedrafted(enr.Carl)).toBe(true);
    expect(await isRedrafted(enr.Jane)).toBe(false);
    expect(await isRedrafted(enr.Dana)).toBe(false);
    expect(asked).toEqual(["Carl"]);
  });

  it("named ids that are unknown, repeated or empty do nothing extra", async () => {
    expect(await redraft({ enrollmentIds: [] })).toMatchObject({ selected: 0, redrafted: 0 });
    expect(
      await redraft({ enrollmentIds: [enr.Dana ?? -1, enr.Dana ?? -1, 999_999] }),
    ).toMatchObject({ selected: 1, redrafted: 1 });
    expect(asked).toEqual(["Dana"]);
  });

  it("no profile: aborts and touches nothing", async () => {
    const before = await bodies(enr.Jane);
    const s = await redraft({ p: null });
    expect(s.aborted).toMatch(/no firm profile/);
    expect(asked).toEqual([]);
    expect(await bodies(enr.Jane)).toEqual(before);
  });
});

describe("a mover", () => {
  it("is redrafted as moved from the old firm to the new, though filed under the new", async () => {
    const [beta] = await rows<{ id: number }>(sql`
      insert into companies (domain, name) values ('betalabs.example', 'Beta Labs') returning id`);
    await db().execute(sql`update enrollments set company_id = ${beta?.id} where id = ${enr.Jane}`);
    await db().execute(sql`
      update messages set provenance = provenance
        || '{"moved":{"from":"Acme Staffing","to":"Beta Labs"}}'::jsonb
      where enrollment_id = ${enr.Jane} and step = 0`);
    const prompts: string[] = [];
    answer = (p, first) => {
      prompts.push(p);
      return JSON.stringify(secondDraft(first));
    };
    expect((await redraft({ enrollmentIds: [enr.Jane ?? -1] })).redrafted).toBe(1);
    expect(prompts[0]).toContain("who moved from Acme Staffing to Beta Labs.");
    const [opener] = await messagesOf(enr.Jane);
    expect(opener?.provenance.moved).toEqual({ from: "Acme Staffing", to: "Beta Labs" });
  });
});

describe("what it never touches", () => {
  it("a pair with a sent opener, even named, even with its followup still a draft", async () => {
    await db().execute(sql`
      update messages set state = 'sent', sent_at = now(), message_id = '<m1@mail.example>'
      where enrollment_id = ${enr.Jane ?? -1} and step = 0`);
    const before = await bodies(enr.Jane);
    expect(await redraft({ enrollmentIds: [enr.Jane ?? -1] })).toMatchObject({
      selected: 0,
      redrafted: 0,
    });
    expect(await redraft()).toMatchObject({ selected: 2, redrafted: 2 });
    expect(asked).not.toContain("Jane");
    expect(await bodies(enr.Jane)).toEqual(before);
  });

  it("an approved pair, and a skipped one", async () => {
    await approveDrafts(db(), { enrollmentIds: [enr.Jane ?? -1] }, "client");
    await skipDrafts(db(), { enrollmentIds: [enr.Carl ?? -1] }, "client");
    const jane = await bodies(enr.Jane);
    const carl = await bodies(enr.Carl);
    const s = await redraft({ enrollmentIds: [enr.Jane ?? -1, enr.Carl ?? -1, enr.Dana ?? -1] });
    expect(s).toMatchObject({ selected: 1, redrafted: 1 });
    expect(asked).toEqual(["Dana"]);
    expect(await bodies(enr.Jane)).toEqual(jane);
    expect(await bodies(enr.Carl)).toEqual(carl);
    expect((await messagesOf(enr.Jane)).map((m) => m.state)).toEqual(["approved", "approved"]);
    expect((await messagesOf(enr.Carl)).map((m) => m.state)).toEqual(["rejected", "rejected"]);
  });

  it("a pair whose mailbox is gone or suspended is skipped, unpaid", async () => {
    const ann = settings.senders.find((x) => x.address === "ann@mail.example");
    const bob = settings.senders.find((x) => x.address === "bob@mail.example");
    if (!ann || !bob) throw new Error("fixture senders");
    const janeSender = (
      await one<{ sender: string }>(
        sql`select sender from enrollments where id = ${enr.Jane ?? -1}`,
      )
    ).sender;
    expect(janeSender).toBe("ann@mail.example");
    const s = await redraft({ senders: [{ ...ann, suspended: true }, bob] });
    // Jane and Dana are Ann's (owner alee), Carl is Bob's.
    expect(s).toMatchObject({ selected: 3, redrafted: 1, skipped: 2 });
    expect(asked).toEqual(["Carl"]);
    const t = await redraft({ senders: [ann] });
    expect(t).toMatchObject({ selected: 3, redrafted: 2, skipped: 1 });
  });

  it("a pair approved while the model wrote is left as approved, with its old words", async () => {
    const before = await bodies(enr.Jane);
    answer = async (_p, first) => {
      if (first === "Jane")
        await approveDrafts(db(), { enrollmentIds: [enr.Jane ?? -1] }, "client");
      return JSON.stringify(secondDraft(first));
    };
    const s = await redraft();
    expect(s).toMatchObject({ selected: 3, redrafted: 2, skipped: 1 });
    expect(await bodies(enr.Jane)).toEqual(before);
    expect((await messagesOf(enr.Jane)).map((m) => m.state)).toEqual(["approved", "approved"]);
    const drafted = await one<{ n: number }>(sql`
      select count(*)::int n from compositions
      where state = 'drafted' and enrollment_id = ${enr.Jane ?? -1}`);
    expect(drafted.n).toBe(1);
  });

  it("a pair skipped while the model wrote stays skipped, with its old words", async () => {
    const before = await bodies(enr.Carl);
    answer = async (_p, first) => {
      if (first === "Carl") await skipDrafts(db(), { enrollmentIds: [enr.Carl ?? -1] }, "client");
      return JSON.stringify(secondDraft(first));
    };
    expect(await redraft()).toMatchObject({ redrafted: 2, skipped: 1 });
    expect(await bodies(enr.Carl)).toEqual(before);
  });

  // Bug (waste): compose checks suppressions before it pays for a draft; redraft doesn't
  // (compose.ts:777-798), so an address that opted out since is written to again, at cost, for
  // an email that can never send.
  it("Bug: a pair whose address was suppressed since is not paid for again", async () => {
    await db().execute(
      sql`insert into suppressions (kind, value, reason) values ('email', 'jane@acmestaffing.com', 'opt_out')`,
    );
    await redraft();
    expect(asked).not.toContain("Jane");
    expect(await isRedrafted(enr.Jane)).toBe(false);
  });
});

describe("edits", () => {
  const edit = (enrollmentId: number | undefined, step: number, body: string) =>
    db().execute(sql`
      update messages set body = ${body}, edited_at = now()
      where enrollment_id = ${enrollmentId ?? -1} and step = ${step}`);

  it("without ids: an edited opener keeps its words, unpaid", async () => {
    await edit(enr.Jane, 0, "Hi Jane,\nMy own words.");
    const s = await redraft();
    expect(s).toMatchObject({ selected: 2, redrafted: 2, skipped: 0 });
    expect(asked).not.toContain("Jane");
    const [opener] = await messagesOf(enr.Jane);
    expect(opener?.body).toBe("Hi Jane,\nMy own words.");
    expect(opener?.edited_at).not.toBeNull();
  });

  it("without ids: an edited followup alone holds the pair too", async () => {
    await edit(enr.Carl, 1, "Carl, my own nudge.");
    const s = await redraft();
    expect(s).toMatchObject({ selected: 2, redrafted: 2 });
    expect(await isRedrafted(enr.Carl)).toBe(false);
    expect((await messagesOf(enr.Carl))[1]?.body).toBe("Carl, my own nudge.");
  });

  it("without ids: an edit while the model wrote wins, and counts as skipped", async () => {
    const was = (await messagesOf(enr.Dana))[1];
    answer = async (_p, first) => {
      if (first === "Dana") await edit(enr.Dana, 0, "Hi Dana,\nEdited mid-flight.");
      return JSON.stringify(secondDraft(first));
    };
    const s = await redraft();
    expect(s).toMatchObject({ selected: 3, redrafted: 2, skipped: 1 });
    const [opener, followup] = await messagesOf(enr.Dana);
    expect(opener?.body).toBe("Hi Dana,\nEdited mid-flight.");
    expect(opener?.edited_at).not.toBeNull();
    expect(followup?.subject).toBeNull();
    expect(followup?.body).toBe(was?.body);
    expect(followup?.provenance).toEqual(was?.provenance);
    expect(
      (
        await one<{ n: number }>(sql`
          select count(*)::int n from compositions
          where state = 'drafted' and enrollment_id = ${enr.Dana ?? -1}`)
      ).n,
    ).toBe(1);
  });

  it("named ids: an edited pair is rewritten and its edit marks cleared", async () => {
    await edit(enr.Jane, 0, "Hi Jane,\nMy own words.");
    await edit(enr.Jane, 1, "Jane, my own nudge.");
    const s = await redraft({ enrollmentIds: [enr.Jane ?? -1] });
    expect(s).toMatchObject({ selected: 1, redrafted: 1, skipped: 0 });
    const msgs = await messagesOf(enr.Jane);
    expect(msgs.map((m) => m.edited_at)).toEqual([null, null]);
    expect(msgs[0]?.body).toContain("I noticed you are still there.");
    expect(msgs[1]?.body).toContain("a quick nudge on that short call.");
  });

  it("named ids: an edit while the model wrote is still rewritten, as asked", async () => {
    answer = async (_p, first) => {
      if (first === "Jane") await edit(enr.Jane, 0, "Hi Jane,\nEdited mid-flight.");
      return JSON.stringify(secondDraft(first));
    };
    expect(await redraft({ enrollmentIds: [enr.Jane ?? -1] })).toMatchObject({ redrafted: 1 });
    const [opener] = await messagesOf(enr.Jane);
    expect(opener?.edited_at).toBeNull();
    expect(opener?.body).toContain("I noticed you are still there.");
  });
});

describe("failures", () => {
  it("an answer that doesn't parse keeps the old words and records why", async () => {
    const before = await bodies(enr.Jane);
    const prov = (await messagesOf(enr.Jane))[0]?.provenance;
    answer = (_p, first) => (first === "Jane" ? "sorry, no" : JSON.stringify(secondDraft(first)));
    const s = await redraft();
    expect(s).toMatchObject({ selected: 3, redrafted: 2, failed: 1 });
    expect(await bodies(enr.Jane)).toEqual(before);
    expect((await messagesOf(enr.Jane))[0]?.provenance).toEqual(prov);
    const c = await one<{ detail: string; enrollment_id: number | null }>(sql`
      select detail, enrollment_id from compositions where state = 'failed'`);
    expect(c.detail).toMatch(new RegExp(`^redraft of #${enr.Jane}: did not parse`));
    expect(c.enrollment_id).toBeNull();
  });

  it("a draft the gate refuses keeps the old words", async () => {
    const before = await bodies(enr.Carl);
    answer = (_p, first) =>
      JSON.stringify(
        first === "Carl"
          ? {
              ...secondDraft(first),
              opener: [{ text: "Hi Carl," }, { text: "See https://evil.example now.", from: [1] }],
            }
          : secondDraft(first),
      );
    const s = await redraft();
    expect(s).toMatchObject({ redrafted: 2, failed: 1 });
    expect(await bodies(enr.Carl)).toEqual(before);
    expect((await messagesOf(enr.Carl)).map((m) => m.state)).toEqual(["draft", "draft"]);
  });

  it("a provider error stops the pass: what's done stays done, the rest untouched", async () => {
    const dana = await bodies(enr.Dana);
    answer = (_p, first) => {
      if (first === "Dana") throw new LlmError("HTTP 529", { status: 529 });
      return JSON.stringify(secondDraft(first));
    };
    const s = await redraft();
    expect(s.aborted).toMatch(/529/);
    expect(await bodies(enr.Dana)).toEqual(dana);
    expect(
      (
        await one<{ n: number }>(
          sql`select count(*)::int n from compositions where state = 'failed'`,
        )
      ).n,
    ).toBe(0);
  });
});

describe("the counts around it", () => {
  const counts = async () => {
    const status = await crmStatus(db(), { compose: { settings, profile } });
    return {
      room: await composeRoom(db(), settings.compose.perDay),
      drafted: status.emails.drafted,
      awaiting: status.emails.awaiting,
      approved: status.emails.approved,
      sent: status.emails.sent,
      due: status.emails.due,
      enrollments: (await one<{ n: number }>(sql`select count(*)::int n from enrollments`)).n,
      messages: (await one<{ n: number }>(sql`select count(*)::int n from messages`)).n,
    };
  };

  it("a redraft writes no new email: room, written, awaiting and the rest stay", async () => {
    const before = await counts();
    expect(before).toMatchObject({ drafted: 3, awaiting: 3, enrollments: 3, messages: 6 });
    await redraft();
    expect(await counts()).toEqual(before);
    await redraft();
    expect(await counts()).toEqual(before);
  });

  it("after an approval and a redraft, the counts still add up", async () => {
    await approveDrafts(db(), { enrollmentIds: [enr.Jane ?? -1] }, "client");
    const before = await counts();
    await redraft();
    expect(await counts()).toEqual(before);
    expect(before).toMatchObject({ awaiting: 2, approved: 1 });
  });

  it("a failed redraft leaves the email counts as they were", async () => {
    const before = await counts();
    answer = () => "sorry, no";
    expect(await redraft()).toMatchObject({ failed: 3 });
    expect(await counts()).toEqual(before);
  });
});
