/**
 * The Run page over a seeded list: the replay rebuilt from the records, in
 * story order, and the live run read by its cursor.
 */
import { type FeedLine, runFeed } from "@wren/core";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "../../src/demo/seed.js";
import { STAGE_STARTS } from "../../src/feed.js";
import { portalRun } from "../../src/portal/run.js";
import { portalStory } from "../../src/portal/story.js";
import { scoreCrmContacts } from "../../src/score.js";
import type { CrmStage } from "../../src/status.js";
import { deps as seedDeps, today } from "./demo-fixture.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const idOf = async (q: ReturnType<typeof sql>) => {
  const [r] = await pg.db.execute<{ id: number }>(q);
  if (!r) throw new Error("not found");
  return r.id;
};
const newRun = async () => {
  const [r] = await pg.db.execute<{ id: string }>(
    sql`insert into runs (id, command, argv) values (gen_random_uuid(), 'crm run', '[]'::jsonb) returning id`,
  );
  return r?.id ?? "";
};
const ofStep = (lines: FeedLine[], step: string) => lines.filter((l) => l.step === step);

describe("nothing on the list yet", () => {
  it("the replay is empty and there is no live run", async () => {
    expect(await portalStory(pg.db)).toEqual({ lines: [], asOf: null });
    expect(await portalRun(pg.db, { operator: true })).toEqual({
      live: null,
      story: { lines: [], asOf: null },
    });
  });

  it("a poll with a cursor gets no replay", async () => {
    expect(await portalRun(pg.db, { run: "x", after: 0, operator: false })).toEqual({
      live: null,
      story: null,
    });
  });
});

describe("a list with every stage on record", () => {
  let lines: FeedLine[] = [];

  beforeAll(async () => {
    const db = pg.db;
    await seedDemo(db, seedDeps, { agency: "northside.example", today });
    const cara = await idOf(sql`select id from people where full_name = 'Cara Lim'`);
    const jane = await idOf(sql`select id from people where full_name = 'Jane Doe'`);
    const bob = await idOf(sql`select id from people where full_name = 'Bob Roe'`);
    const umbrella = await idOf(sql`select id from companies where name = 'Umbrella Health'`);
    const globex = await idOf(sql`select id from companies where name = 'Globex'`);

    // Verify: Cara's address bounced once, then worked; Jane's bounces; Bob's can't tell.
    const cc = (person: number) =>
      idOf(sql`select id from contact_candidates where evidence = 'crm' and person_id = ${person}`);
    const [cc1, cc2, cc3] = [await cc(cara), await cc(jane), await cc(bob)];
    await db.execute(sql`
      insert into verifications (contact_candidate_id, email, verifier, result, raw, checked_at)
      values (${cc1}, 'x', 'mv', 'invalid', '{}'::jsonb, now() - interval '2 days'),
        (${cc1}, 'x', 'mv', 'valid', '{}'::jsonb, now() - interval '1 day'),
        (${cc2}, 'x', 'local', 'invalid', '{}'::jsonb, now() - interval '1 day'),
        (${cc3}, 'x', 'mv', 'risky', '{}'::jsonb, now() - interval '1 day')`);

    // Lookup: Cara moved, Jane couldn't be told, Bob parked by a cap with nothing known.
    await db.execute(sql`
      insert into findings (kind, person_id, fact_key, value, source_url, confidence, via)
      values ('job_change', ${cara}, 'jc:cara',
        ${JSON.stringify({ from: "Umbrella Health", to: "Initech", title: "Senior Recruiter" })}::jsonb,
        'https://www.linkedin.com/in/cara-lim/', 0.9, 'search')`);
    await db.execute(sql`
      insert into person_lookups (person_id, state, tried, retry_at, looked_up_at)
      values (${cara}, 'matched', '[]'::jsonb, null, now() - interval '20 hours'),
        (${jane}, 'unresolved', '[]'::jsonb, null, now() - interval '19 hours'),
        (${bob}, 'capped', '[]'::jsonb, '2026-10-02T09:00:00Z', now() - interval '18 hours')`);

    // Signals: Umbrella hires, Globex parked by a cap.
    const hiring = await idOf(sql`
      insert into findings (kind, company_id, fact_key, value, source_url, confidence, via)
      values ('hiring', ${umbrella}, 'hi:umbrella', ${JSON.stringify({ count: 2 })}::jsonb,
        'https://umbrellahealth.com/careers', 1, 'job_board')
      returning id`);
    await db.execute(sql`
      insert into company_checks (company_id, state, finding_id, tried, retry_at, checked_at)
      values (${umbrella}, 'hiring', ${hiring}, '[]'::jsonb, null, now() - interval '17 hours'),
        (${globex}, 'capped', null, '[]'::jsonb, '2026-10-02T09:00:00Z', now() - interval '16 hours')`);

    await scoreCrmContacts(db, today);

    // Briefs: Cara's written, Jane's empty (left out).
    await db.execute(sql`
      insert into briefs (person_id, state, text, citations, dropped, inputs_hash, model, prompt_version)
      values (${cara}, 'written', ${"Cara Lim moved to Initech.\nShe recruits there."},
          '[]'::jsonb, '[]'::jsonb, 'x', 'fake', 'v1'),
        (${jane}, 'empty', '', '[]'::jsonb, '[]'::jsonb, 'x', 'fake', 'v1')`);

    // Emails: a draft to Cara; one to Jane stopped (left out).
    const enroll = (person: number, state: string, stop: string | null) =>
      idOf(sql`
        insert into enrollments (person_id, company_id, niche, sequence_name, sequence_snapshot,
          offer, state, stop_reason, kind, to_email, sender)
        values (${person}, ${umbrella}, 'reactivation', 'reactivation', '{}'::jsonb,
          'reactivation', ${state}, ${stop}, 'person', 'a@umbrellahealth.com', 's@acme.example')
        returning id`);
    const toCara = await enroll(cara, "active", null);
    await enroll(jane, "stopped", "manual");
    await db.execute(sql`
      insert into messages (enrollment_id, step, template, template_version, to_email, subject,
        body, provenance, state)
      values (${toCara}, 0, 'reactivation_opener', 'v1', 'a@umbrellahealth.com', 'hi', 'Hi',
        '{}'::jsonb, 'draft')`);

    lines = (await portalStory(db)).lines;
  });

  it("tells the stages in story order, each from its start line to its done line", () => {
    const steps = [...new Set(lines.map((l) => l.step))];
    expect(steps).toEqual(["verify", "lookup", "signals", "score", "brief", "compose"]);
    for (const step of steps) {
      const own = ofStep(lines, step);
      expect(own[0], step).toMatchObject({ kind: "started", line: STAGE_STARTS[step as CrmStage] });
      expect(own.at(-1)?.kind, step).toBe("done");
    }
  });

  it("seq runs 1 to n; no line carries a detail", () => {
    expect(lines.map((l) => l.seq)).toEqual(lines.map((_, i) => i + 1));
    expect(lines.every((l) => l.detail === null)).toBe(true);
  });

  it("verify counts each address by its newest verdict", () => {
    expect(ofStep(lines, "verify").at(-1)).toMatchObject({
      line: "Checked 3 addresses: 1 work, 1 bounce, 1 can't tell",
      count: 3,
    });
  });

  it("a capped lookup with nothing known is left out", () => {
    expect(ofStep(lines, "lookup").map((l) => l.line)).toEqual([
      "Finding where each person is now",
      "Cara Lim moved to Initech, Senior Recruiter",
      "Couldn't tell for sure where Jane Doe is now",
      "Looked up 2 people: 1 moved, 0 left",
    ]);
    expect(ofStep(lines, "lookup").at(-1)?.count).toBe(2);
  });

  it("a parked company waits and isn't counted as checked", () => {
    const own = ofStep(lines, "signals");
    expect(own.map((l) => [l.kind, l.line])).toEqual([
      ["started", "Checking which companies are hiring"],
      ["found", "Umbrella Health is hiring: 2 open roles"],
      ["waiting", "Globex waits until Oct 2. Today's checks ran out."],
      ["done", "Checked 1 company: 1 hiring"],
    ]);
    expect(own.at(-1)?.count).toBe(1);
  });

  it("score names who to call first, and its done line has no count", () => {
    const own = ofStep(lines, "score");
    expect(own[1]?.line).toMatch(/ is number 1 to call \(score \d+\)$/);
    expect(own.at(-1)).toMatchObject({ line: "Ranked everyone by who to call first", count: null });
  });

  it("only written briefs and emails not stopped", () => {
    expect(ofStep(lines, "brief").map((l) => l.line)).toEqual([
      "Writing a brief on each person, with sources",
      "Wrote a brief on Cara Lim: 2 sourced lines",
      "Wrote 1 brief",
    ]);
    expect(ofStep(lines, "compose").map((l) => l.line)).toEqual([
      "Drafting emails for your OK",
      "Drafted an email to Cara Lim: waiting for your OK",
      "Drafted 1 email",
    ]);
  });

  it("a stage with no records is left out, the rest keep their order", async () => {
    const undo = new Error("undo");
    await expect(
      pg.db.transaction(async (tx) => {
        await tx.execute(sql`delete from company_checks`);
        const steps = [...new Set((await portalStory(tx)).lines.map((l) => l.step))];
        expect(steps).toEqual(["verify", "lookup", "score", "brief", "compose"]);
        throw undo; // put the records back
      }),
    ).rejects.toBe(undo);
  });

  describe("the live run", () => {
    let runA = "";
    let fed: FeedLine[] = [];

    beforeAll(async () => {
      runA = await newRun();
      const feed = runFeed(pg.db, runA);
      await feed.emit({
        step: "lookup",
        kind: "started",
        line: "Finding where each person is now",
      });
      await feed.emit({ step: "lookup", kind: "found", subject: "Cara Lim", line: "Cara moved" });
      await feed.emit({
        step: "lookup",
        kind: "failed",
        subject: "Jane Doe",
        line: "Couldn't finish Jane Doe; it will be tried again",
        detail: "Error: 429",
      });
      fed = (await portalRun(pg.db, { operator: true })).live?.lines ?? [];
    });

    it("first load: the newest run's lines, open, and the replay", async () => {
      const page = await portalRun(pg.db, { operator: true });
      expect(page.live).toMatchObject({ run: runA, command: "crm run", open: true });
      expect(page.live?.lines.map((l) => l.line)).toEqual([
        "Finding where each person is now",
        "Cara moved",
        "Couldn't finish Jane Doe; it will be tried again",
      ]);
      expect(page.live?.last).toBe(fed[2]?.seq);
      expect(page.story?.lines.length).toBe(lines.length);
    });

    it("after a cursor: only the lines past it, and no replay", async () => {
      const page = await portalRun(pg.db, { run: runA, after: fed[0]?.seq, operator: true });
      expect(page.live?.lines.map((l) => l.line)).toEqual([
        "Cara moved",
        "Couldn't finish Jane Doe; it will be tried again",
      ]);
      expect(page.story).toBeNull();
      const caughtUp = await portalRun(pg.db, { run: runA, after: fed[2]?.seq, operator: true });
      expect(caughtUp.live?.lines).toEqual([]);
      expect(caughtUp.live?.last).toBe(fed[2]?.seq);
    });

    it("a stale run id gets every line of the watched run", async () => {
      const page = await portalRun(pg.db, { run: "an-older-run", after: 999_999, operator: true });
      expect(page.live?.lines.map((l) => l.seq)).toEqual(fed.map((l) => l.seq));
      expect(page.live?.last).toBe(fed[2]?.seq);
    });

    it("the technical why is for operators only", async () => {
      const detail = async (operator: boolean) =>
        (await portalRun(pg.db, { operator })).live?.lines.map((l) => l.detail);
      expect(await detail(true)).toEqual([null, null, "Error: 429"]);
      expect(await detail(false)).toEqual([null, null, null]);
    });

    it("a newer run that writes takes over, sent whole", async () => {
      const runB = await newRun();
      await runFeed(pg.db, runB).emit({ step: "verify", kind: "started", line: "B started" });
      const page = await portalRun(pg.db, { run: runA, after: fed[2]?.seq, operator: false });
      expect(page.live?.run).toBe(runB);
      expect(page.live?.lines.map((l) => l.line)).toEqual(["B started"]);
    });

    it("a finished run, or one quiet for ten minutes, isn't open", async () => {
      await pg.db.execute(sql`update run_events set at = now() - interval '11 minutes'`);
      expect((await portalRun(pg.db, { operator: false })).live?.open).toBe(false);
      await pg.db.execute(sql`update run_events set at = now()`);
      expect((await portalRun(pg.db, { operator: false })).live?.open).toBe(true);
      await pg.db.execute(sql`update runs set finished_at = now()`);
      expect((await portalRun(pg.db, { operator: false })).live?.open).toBe(false);
    });
  });
});
