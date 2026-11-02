/**
 * The draft-model scorecard on Postgres, synthetic steps (designs/2026-10-14-draft-models.md):
 * drafts group by the model that wrote the version he saw, unedited and edited approvals and
 * rejections count apart, a redraft is the last version, guard drops count by model, a sent
 * comment's proof joins in, history without an arm stays outside the test, and the window cuts.
 */

import { finishRun, openRun } from "@wren/core";
import { setWrenSettings } from "@wren/core/clients";
import { DRAFT_MODELS_COMPONENT } from "@wren/core/draft-models";
import { recordDraft } from "@wren/core/draft-record";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { draftScorecard } from "../../src/draft-models.js";

const NOW = new Date("2026-10-14T12:00:00Z");
const SINCE = new Date("2026-10-01T00:00:00Z");
const GEMINI = "gateway:free";
const COHERE = "cohere:command-a-03-2025";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, ["draft_events", "comment_proofs", "runs", "wren_settings"]);
});

const gen = (item: string, by: string, text: string, arm: string | null, at = NOW) =>
  recordDraft(pg.db, {
    item,
    event: "generated",
    via: "model",
    by,
    text,
    at,
    meta: arm ? { arm } : {},
  });
const person = (item: string, event: "sent" | "rejected" | "edited", text?: string) =>
  recordDraft(pg.db, {
    item,
    event,
    via: "person",
    by: "william",
    text: text ?? null,
    ...(event === "rejected" ? { reason: "voice" as const } : {}),
    at: new Date(NOW.getTime() + 60_000),
  });
const guard = async (by: string | null, outcome: string) => {
  const run = await openRun(pg.db, {
    command: "guard",
    argv: { stage: "comments.sort", item: "comment:9" },
    ...(by ? { model: by } : {}),
  });
  await finishRun(pg.db, run.id, { outcome });
};

describe("draftScorecard", () => {
  it("scores each model by how its drafts ended", async () => {
    await gen("comment:1", GEMINI, "Ask which step they drop at.", "gateway:free");
    await person("comment:1", "sent", "Ask which step they drop at.");
    await gen("comment:2", GEMINI, "Try a call first.", "gateway:free");
    await person("comment:2", "sent", "Try a short call first.");
    await gen("thread:t3_a", COHERE, "Start with one list.", "cohere");
    await person("thread:t3_a", "rejected");
    await gen("thread:t3_b", COHERE, "Count the drop-offs.", "cohere");
    await gen("thread:t3_b", COHERE, "Count the drop-offs weekly.", "cohere");
    await person("thread:t3_b", "sent", "Count the drop-offs weekly.");
    await gen("dm:5", COHERE, "Open draft", "cohere");
    await guard(GEMINI, "dropped");
    await guard(COHERE, "redrafted");
    await guard(null, "dropped");
    await pg.db.execute(sql`insert into comment_proofs (item, platform, state)
      values ('comment:1', 'reddit', 'live')`);

    const card = await draftScorecard(pg.db, SINCE);
    const g = card.rows.find((r) => r.by === GEMINI);
    const c = card.rows.find((r) => r.by === COHERE);
    expect(g).toMatchObject({
      armed: true,
      label: "Gemini 3.8 Flash",
      generated: 2,
      approvedUnedited: 1,
      approvedEdited: 1,
      dropped: 1,
      proof: { live: 1, hidden: 0, missing: 0 },
    });
    expect(c).toMatchObject({
      label: "Command A",
      generated: 3,
      approvedUnedited: 1,
      rejected: 1,
      open: 1,
      redrafted: 1,
    });
    expect(card.rows).toHaveLength(2);
    expect(card.verdict.winner).toBeNull();
    expect(card.arms.map((a) => a.model)).toEqual(["gateway:free", "cohere"]);
  });

  it("keeps drafts with no arm outside the test and cuts at since", async () => {
    await gen("comment:3", COHERE, "Old way.", null);
    await gen("comment:4", GEMINI, "Too old.", "gateway:free", new Date("2026-09-01T00:00:00Z"));
    const card = await draftScorecard(pg.db, SINCE);
    expect(card.rows).toHaveLength(1);
    expect(card.rows[0]).toMatchObject({ armed: false, by: COHERE, generated: 1 });
  });

  it("reads the saved arms", async () => {
    await setWrenSettings(
      pg.db,
      DRAFT_MODELS_COMPONENT,
      { arms: [{ model: "cohere", weight: 1 }] },
      "test",
    );
    expect((await draftScorecard(pg.db, SINCE)).arms).toEqual([{ model: "cohere", weight: 1 }]);
  });
});
