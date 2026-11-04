/**
 * Decide's sources against a real Postgres (designs/2026-10-16-decide.md): history backfilled
 * once, due subjects shown without names, and `wren decide backfill --dry-run` writing nothing.
 * Synthetic.
 */

import { recordDraft } from "@wren/core/draft-record";
import { resolveObjects } from "@wren/core/objects";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { redditPlaces } from "@wren/starling-acts/schema";
import { commentsDue } from "@wren/starling-outbound/decide";
import { redditThreads } from "@wren/starling-outbound/schema";
import { Command } from "commander";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registerDecide } from "../../src/decide.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
}, 240_000);
afterAll(async () => {
  await pg?.stop();
});

const NOW = new Date();
const calls = async () =>
  (await pg.db.execute(
    sql`select subject, label, source, ref from decision_calls order by id`,
  )) as unknown as Record<string, unknown>[];

async function wren(...argv: string[]): Promise<string> {
  const out: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  try {
    const program = new Command().exitOverride();
    registerDecide(program, (fn) => fn(pg.db), { llmEnvPath: "/nonexistent", rootDir: "/" });
    await program.parseAsync(["node", "wren", "decide", ...argv]);
  } finally {
    log.mockRestore();
  }
  return out.join("\n");
}

describe("comment source", () => {
  it("an open draft is due with the post it answers; a called one isn't", async () => {
    await pg.db
      .insert(redditPlaces)
      .values({ subreddit: "smallbusiness", name: "smallbusiness", foundBy: "test" });
    await resolveObjects(
      pg.db,
      ["t3_open", "t3_done"].map((raw) => ({
        platform: "reddit" as const,
        kind: "post" as const,
        raw,
      })),
    );
    for (const id of ["t3_open", "t3_done"])
      await pg.db.insert(redditThreads).values({
        id,
        subreddit: "smallbusiness",
        title: `Synthetic question ${id}`,
        body: "How do you follow up with leads?",
        author: "someone",
        url: `https://reddit.example/${id}`,
        postedAt: NOW,
        comments: 3,
        raw: {},
      });
    for (const id of ["t3_open", "t3_done"])
      await recordDraft(pg.db, {
        item: `thread:${id}`,
        event: "generated",
        via: "model",
        text: "A synthetic reply.",
      });
    await recordDraft(pg.db, {
      item: "thread:t3_done",
      event: "sent",
      via: "person",
      text: "A synthetic reply.",
    });
    const due = await commentsDue(pg.db, NOW, 10);
    expect(due.map((d) => d.subject)).toEqual(["thread:t3_open"]);
    expect(due[0]?.state).toEqual({
      platform: "reddit",
      where: "r/smallbusiness",
      post: { title: "Synthetic question t3_open", text: "How do you follow up with leads?" },
      draft: "A synthetic reply.",
    });
    expect(JSON.stringify(due[0]?.state)).not.toContain("someone");
  });
});

describe("wren decide", () => {
  it("backfill --dry-run counts and writes nothing; backfill adds each once", async () => {
    const before = (await calls()).length;
    const dry = JSON.parse(await wren("backfill", "--dry-run"));
    expect(dry.dryRun).toBe(true);
    expect(dry.calls.comments.items).toBeGreaterThanOrEqual(1);
    expect((await calls()).length).toBe(before);
    await wren("backfill");
    const once = (await calls()).length;
    await wren("backfill");
    expect((await calls()).length).toBe(once);
  });

  it("stats prints a row per kind; mode refuses a gate", async () => {
    const out = await wren("stats");
    expect(out).toContain("comment_quality");
    expect(out).toContain("document");
    await expect(wren("mode", "document", "gate")).rejects.toThrow("no gate filter");
  });
});
