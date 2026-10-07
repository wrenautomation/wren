/**
 * The training record against Postgres (designs/2026-10-07-training-record.md): a post's steps
 * from the model's draft (with its prompt) through his edit, approve and send; a reject with its
 * why and a redraft's superseded row; a DM contact's rounds; a refused quick pick.
 */
import { keepSentEdit } from "@wren/core/ask";
import { draftRecordOf, draftSteps, recordDraft, rejectWhy } from "@wren/core/draft-record";
import { serveRecords } from "@wren/core/records/serve";
import { type TrainRecord, trainPairs, trainRecords } from "@wren/core/train";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addIdea,
  approveDrafts,
  backfillTraining,
  contentMetrics,
  draftIdea,
  markFailed,
  markPublished,
  redraft,
  rejectDrafts,
  writeDraft,
} from "../../src/index.js";
import { draftRecord } from "../../src/records.js";

const llm = new FakeLlm({
  respond: async (prompt) =>
    prompt.includes("The author read it and says")
      ? '{"text": "Shorter. The gate asks first."}'
      : '{"text": "Shipped the spend gate.\\n\\nEvery buy asks me first."}',
});

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [
    "content_ideas",
    "content_drafts",
    "content_metrics",
    "runs",
    "draft_events",
    "comments",
  ]);
});

const firstDraft = async () => {
  const idea = await addIdea(pg.db, "The spend gate shipped", "cli");
  const [r] = await draftIdea(pg.db, llm, idea, ["linkedin"]);
  if (!r?.ok) throw new Error("no draft");
  return { idea, draft: r.draft };
};
const steps = async (item: string) =>
  (await draftSteps(pg.db, item)).map((s) => [s.event, s.via, s.round]);

describe("a post's record", () => {
  it("keeps the model's prompt, his edit, the approve's slot and the sent words with the id", async () => {
    const { draft } = await firstDraft();
    await writeDraft(pg.db, `draft:${draft.id}`, "Shipped it. Every buy asks me.", {
      command: "draft-set",
      by: "william@example.com",
    });
    const at = new Date("2026-10-08T15:00:00Z");
    await approveDrafts(pg.db, [draft.id], { now: new Date(), at, by: "william@example.com" });
    await markPublished(pg.db, draft.id, {
      id: "urn:li:share:1",
      url: "https://www.linkedin.com/feed/update/urn:li:share:1",
      publishedAt: at.toISOString(),
      fetchedWith: "api",
    });
    // A journaled step run twice keeps one send.
    await markPublished(pg.db, draft.id, {
      id: "urn:li:share:1",
      url: "https://www.linkedin.com/feed/update/urn:li:share:1",
      publishedAt: at.toISOString(),
      fetchedWith: "api",
    });
    const rows = await draftSteps(pg.db, `draft:${draft.id}`);
    expect(rows.map((r) => [r.event, r.via, r.kind])).toEqual([
      ["generated", "model", "post"],
      ["edited", "person", "post"],
      ["approved", "person", "post"],
      ["sent", "wren", "post"],
    ]);
    const [gen, edit, approved, sent] = rows;
    expect(gen?.text).toContain("Shipped the spend gate.");
    expect(gen?.llm).toMatchObject({ stage: "content_draft", model: "fake" });
    expect(String((gen?.llm as { prompt?: string } | null)?.prompt)).toContain(
      "The spend gate shipped",
    );
    expect(edit?.text).toBe("Shipped it. Every buy asks me.");
    expect(edit?.by).toBe("william@example.com");
    expect(approved?.slot?.toISOString()).toBe(at.toISOString());
    expect(sent).toMatchObject({
      text: "Shipped it. Every buy asks me.",
      externalId: "urn:li:share:1",
    });
  });

  it("keeps a reject's quick pick and note, and a redraft's superseded row with his note", async () => {
    const { idea, draft } = await firstDraft();
    const r = await redraft(pg.db, llm, draft, idea, "shorter", { by: "william@example.com" });
    if (!r.ok) throw new Error("no redraft");
    expect(await steps(`draft:${draft.id}`)).toEqual([
      ["generated", "model", 1],
      ["rejected", "person", 1],
    ]);
    const [, superseded] = await draftSteps(pg.db, `draft:${draft.id}`);
    expect(superseded).toMatchObject({ note: "shorter", meta: { redrafted_as: r.draft.id } });
    const [again] = await draftSteps(pg.db, `draft:${r.draft.id}`);
    expect(again).toMatchObject({ event: "generated", ask: "shorter" });

    await rejectDrafts(pg.db, [r.draft.id], {
      by: "cli",
      ...rejectWhy({ reason: "voice", note: " not me " }),
    });
    const last = (await draftSteps(pg.db, `draft:${r.draft.id}`)).at(-1);
    expect(last).toMatchObject({ event: "rejected", reason: "voice", note: "not me", by: "cli" });
  });

  it("keeps a failed publish's error", async () => {
    const { draft } = await firstDraft();
    await approveDrafts(pg.db, [draft.id], { now: new Date(), at: new Date() });
    await markFailed(pg.db, draft.id, "429 from LinkedIn");
    const last = (await draftSteps(pg.db, `draft:${draft.id}`)).at(-1);
    expect(last).toMatchObject({ event: "failed", note: "429 from LinkedIn" });
  });
});

describe("rounds", () => {
  it("opens a DM contact's next round on a new model draft or words after a send", async () => {
    const item = "dm:7";
    const step = (event: "generated" | "edited" | "sent", via: "model" | "person") =>
      recordDraft(pg.db, { item, platform: "reddit", event, via, text: event });
    await step("generated", "model");
    await keepSentEdit(pg.db, { record: "dm", id: "7", by: "w", before: "a", after: "b" });
    await step("sent", "person");
    await step("edited", "person");
    await step("sent", "person");
    await step("generated", "model");
    expect(await steps(item)).toEqual([
      ["generated", "model", 1],
      ["edited", "person", 1],
      ["sent", "person", 1],
      ["edited", "person", 2],
      ["sent", "person", 2],
      ["generated", "model", 3],
    ]);
  });

  it("keeps a post at round 1 and one row per ref", async () => {
    await recordDraft(pg.db, { item: "comment:1", event: "generated", via: "model", ref: "x" });
    await recordDraft(pg.db, { item: "comment:1", event: "generated", via: "model", ref: "x" });
    await recordDraft(pg.db, { item: "comment:1", event: "sent", via: "person" });
    expect(await steps("comment:1")).toEqual([
      ["generated", "model", 1],
      ["sent", "person", 1],
    ]);
  });
});

describe("rejectWhy", () => {
  it("refuses an unknown pick and cuts a long note", () => {
    expect(() => rejectWhy({ reason: "rude" })).toThrow(/reason must be one of/);
    expect(rejectWhy({ note: "x".repeat(400) }).note).toHaveLength(280);
    expect(rejectWhy({})).toEqual({ reason: null, note: null });
  });
});

const shipped = async (o: { edit?: string; views?: number; reactions?: number } = {}) => {
  const { idea, draft } = await firstDraft();
  if (o.edit)
    await writeDraft(pg.db, `draft:${draft.id}`, o.edit, {
      command: "draft-set",
      by: "william@example.com",
    });
  await approveDrafts(pg.db, [draft.id], { now: new Date(), at: new Date(), by: "cli" });
  await markPublished(pg.db, draft.id, {
    id: `urn:li:share:${draft.id}`,
    url: `https://www.linkedin.com/feed/update/${draft.id}`,
    publishedAt: new Date().toISOString(),
    fetchedWith: "api",
  });
  await pg.db.insert(contentMetrics).values({
    draftId: draft.id,
    views: o.views ?? 100,
    reactions: o.reactions ?? 1,
    comments: 0,
    shares: 0,
    follows: 1,
    // Measured after the send: the steps' clock is the database's, to the microsecond.
    asOf: new Date(Date.now() + 1000),
    fetchedWith: "api",
  });
  return { idea, draft };
};

describe("the record page", () => {
  it("lists versions with who wrote them, the decisions, and a timeline", async () => {
    const { draft } = await shipped({ edit: "Shipped it. Every buy asks me." });
    const r = await draftRecordOf(pg.db, `draft:${draft.id}`);
    expect(r?.versions.map((v) => [v.n, v.via])).toEqual([
      [1, "model"],
      [2, "person"],
    ]);
    expect(r?.decisions.map((d) => d.event)).toEqual(["approved", "sent"]);
    const lines = await pg.db.execute<{ kind: string; what: string; post: string }>(sql`
      select kind, what, post from draft_activity where draft = ${draft.id} order by at, seq`);
    expect(lines.map((l) => l.kind)).toEqual([
      "generated",
      "edited",
      "approved",
      "sent",
      "metrics",
    ]);
    expect(lines[0]?.what).toBe("Drafted by fake");
    expect(lines.at(-1)?.what).toContain("1 follows");
    expect(lines[0]?.post).toMatch(new RegExp(`/linkedin/${draft.id}$`));
  });
});

describe("the export", () => {
  it("writes one record per draft with its prompt, versions, send and outcome, people out", async () => {
    const { draft } = await shipped({ edit: "Shipped it. Ask william@example.com." });
    const [r] = (await trainRecords(pg.db)) as [TrainRecord];
    expect(r).toMatchObject({ schema: "wren.draft/1", id: `draft:${draft.id}#1`, kind: "post" });
    expect(String(r.input?.prompt)).toContain("The spend gate shipped");
    expect(r.versions.map((v) => v.by)).toEqual(["fake", "william@example.com"]);
    expect(r.final?.text).toBe("Shipped it. Ask [email].");
    expect(r.final?.external_id).toBe(`urn:li:share:${draft.id}`);
    expect(r.outcome).toMatchObject({ views: 100, follows: 1, snapshots: 1 });
    const [kept] = await trainRecords(pg.db, { people: true });
    expect(kept?.final?.text).toBe("Shipped it. Ask william@example.com.");
    expect(await trainRecords(pg.db, { kinds: ["dm"] })).toEqual([]);
    expect(await trainRecords(pg.db, { since: new Date(Date.now() + 60_000) })).toEqual([]);
  });

  it("names a commenter [person] in the words and the prompt", async () => {
    await recordDraft(pg.db, {
      item: "comment:9",
      platform: "reddit",
      event: "generated",
      via: "model",
      text: "Thanks Jordan Avery, good catch.",
      llm: { prompt: "u/javery42 asked: why?" },
    });
    await pg.db.execute(sql`
      insert into comments (id, platform, channel, ref, post, parent, kind, author, body, url, at, raw)
      values (9, 'reddit', 'content', 'c9', 'p1', 'p1', 'post_reply', 'javery42', 'why?', 'https://x.test/c9',
        now(), '{}')`);
    await pg.db.execute(sql`
      insert into comments (id, platform, channel, ref, post, parent, kind, author, body, url, at, raw)
      values (10, 'reddit', 'content', 'c10', 'p1', 'p1', 'post_reply', 'Jordan Avery', 'hi', 'https://x.test/c10',
        now(), '{}')`);
    await recordDraft(pg.db, { item: "comment:10", event: "generated", via: "model", text: "x" });
    const r = (await trainRecords(pg.db, { items: ["comment:9"] }))[0];
    expect(String(r?.input?.prompt)).toBe("u/[person] asked: why?");
    // Jordan Avery is comment 10's author, not 9's: only the item's own people come out.
    expect(r?.versions[0]?.text).toBe("Thanks Jordan Avery, good catch.");
  });

  it("builds edit, decision and engagement pairs", async () => {
    const a = await shipped({ edit: "Shipped it. Every buy asks me.", reactions: 9 });
    await shipped({ reactions: 1 });
    const no = await firstDraft();
    const r = await redraft(pg.db, llm, no.draft, no.idea, "shorter", {
      by: "william@example.com",
    });
    if (!r.ok) throw new Error("no redraft");
    await approveDrafts(pg.db, [r.draft.id], { now: new Date(), at: new Date() });
    const pairs = trainPairs(await trainRecords(pg.db));
    const decision = pairs.filter((p) => p.type === "decision");
    expect(decision.map((p) => [p.chosen.record, p.rejected.record])).toEqual([
      [`draft:${r.draft.id}#1`, `draft:${no.draft.id}#1`],
    ]);
    expect(decision[0]?.why).toEqual({ reason: null, note: "shorter" });
    const edit = pairs.find((p) => p.type === "edit");
    expect(edit?.rejected.text).toContain("Shipped the spend gate.");
    expect(edit?.chosen.text).toBe("Shipped it. Every buy asks me.");
    expect(pairs.filter((p) => p.type === "engagement")).toHaveLength(1);
    expect(pairs.find((p) => p.type === "engagement")?.chosen.record).toBe(`draft:${a.draft.id}#1`);
  });

  it("offers JSONL on a draft list, each line with its training record", async () => {
    const { draft } = await shipped();
    await recordDraft(pg.db, { item: `draft:${draft.id}`, event: "edited", via: "person" });
    const api = serveRecords([draftRecord], pg.db);
    const [meta] = api.types();
    expect(meta?.drafts).toBe(true);
    const out = await api.export({ record: "marketing.draft", format: "jsonl" });
    expect(out.format).toBe("jsonl");
    for (const line of out.body.trim().split("\n").filter(Boolean)) {
      const row = JSON.parse(line);
      expect(row.record).toBe("marketing.draft");
      expect(Array.isArray(row.drafts)).toBe(true);
    }
  });
});

describe("the backfill", () => {
  it("folds old drafts in once, from the row, the ledger and the audit log", async () => {
    const { draft } = await shipped({ edit: "Shipped it. Every buy asks me." });
    const no = await firstDraft();
    const r = await redraft(pg.db, llm, no.draft, no.idea, "shorter");
    if (!r.ok) throw new Error("no redraft");
    await truncate(pg.db, ["draft_events"]);
    const dry = await backfillTraining(pg.db, { dryRun: true });
    expect(dry.written).toBeGreaterThan(0);
    expect(await trainRecords(pg.db)).toEqual([]);
    const first = await backfillTraining(pg.db);
    expect(first.written).toBe(dry.written);
    expect((await backfillTraining(pg.db)).written).toBe(0);
    expect(await steps(`draft:${draft.id}`)).toEqual([
      ["generated", "model", 1],
      ["edited", "person", 1],
      ["approved", "person", 1],
      ["sent", "wren", 1],
    ]);
    expect(await steps(`draft:${no.draft.id}`)).toEqual([
      ["generated", "model", 1],
      ["rejected", "person", 1],
    ]);
    const [gen] = await draftSteps(pg.db, `draft:${draft.id}`);
    expect(gen?.text).toContain("Shipped the spend gate.");
    const again = await draftSteps(pg.db, `draft:${r.draft.id}`);
    expect(again[0]).toMatchObject({ event: "generated", ask: "shorter" });
  });

  it("folds in a comment's answer and a DM he changed at send", async () => {
    await pg.db.execute(sql`
      insert into comments (id, platform, channel, ref, post, parent, kind, author, body, url, at,
        raw, draft, state, answer, answer_ref, answered_at)
      values (4, 'reddit', 'content', 'c4', 'p1', 'p1', 'post_reply', 'sam', 'how?',
        'https://x.test/c4', now(), '{}', 'Like this.', 'answered', 'Like this, mostly.', 'c5',
        now() + interval '1 minute')`);
    await pg.db.execute(sql`
      insert into runs (id, command, argv, started_at, finished_at, stats)
      values (gen_random_uuid(), 'draft-set', '{"record":"comment","id":"4","by":"w"}',
        now() + interval '30 seconds', now() + interval '30 seconds',
        '{"before":"Like this.","draft":"Like this, mostly."}')`);
    const [c] = await pg.db.execute<{ id: number }>(sql`
      insert into reach_contacts (platform, handle, url, found_in, name, connected_at)
      values ('linkedin', 'jdoe', 'https://x.test/jdoe', 'test', 'Jane Doe', now()) returning id`);
    const contact = c?.id;
    await pg.db.execute(sql`
      insert into reach_messages (contact_id, direction, kind, body, state, created_at)
      values (${contact}, 'out', 'manual', 'Hi Jane, thanks.', 'sent', now() + interval '2 minutes')`);
    await pg.db.execute(sql`
      insert into runs (id, command, argv, started_at, finished_at, stats)
      values (gen_random_uuid(), 'draft-set',
        ${JSON.stringify({ record: "invite", id: String(contact), by: "w", sent: true })}::jsonb,
        now() + interval '2 minutes', now() + interval '2 minutes',
        '{"before":"Hello Jane.","draft":"Hi Jane, thanks."}')`);
    await backfillTraining(pg.db);
    expect(await steps("comment:4")).toEqual([
      ["generated", "model", 1],
      ["edited", "person", 1],
      ["sent", "person", 1],
    ]);
    expect(await steps(`invite:${contact}`)).toEqual([
      ["generated", "model", 1],
      ["edited", "person", 1],
      ["sent", "person", 1],
    ]);
    const [dm] = await trainRecords(pg.db, { kinds: ["invite"] });
    expect(dm?.versions.map((v) => v.text)).toEqual(["Hello [person].", "Hi [person], thanks."]);
  });

  it("leaves an item the live record already holds", async () => {
    await shipped();
    const report = await backfillTraining(pg.db);
    expect(report).toMatchObject({ written: 0, items: 0 });
    expect(report.live).toBe(1);
  });
});
