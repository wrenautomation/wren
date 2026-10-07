/**
 * The training record against Postgres (designs/2026-10-07-training-record.md): a post's steps
 * from the model's draft (with its prompt) through his edit, approve and send; a reject with its
 * why and a redraft's superseded row; a DM contact's rounds; a refused quick pick.
 */
import { keepSentEdit } from "@wren/core/ask";
import { draftSteps, recordDraft, rejectWhy } from "@wren/core/draft-record";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addIdea,
  approveDrafts,
  draftIdea,
  markFailed,
  markPublished,
  redraft,
  rejectDrafts,
  writeDraft,
} from "../../src/index.js";

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
  await truncate(pg.db, ["content_ideas", "content_drafts", "runs", "draft_events"]);
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
    expect(String((gen?.llm as { prompt?: string }).prompt)).toContain("The spend gate shipped");
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
