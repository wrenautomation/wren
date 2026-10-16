/**
 * Decide's sources and his Learn calls against a real Postgres (designs/2026-10-16-decide.md):
 * marks, saves and SOP adds kept as calls in Wren's workspace only, history backfilled once, due
 * subjects shown without names, and `wren decide backfill --dry-run` writing nothing. Synthetic.
 */

import { recordDraft } from "@wren/core/draft-record";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { askSop, items, mark, saveLink } from "@wren/learn";
import { learnDue } from "@wren/learn/decide";
import { commentsDue } from "@wren/outreach/decide";
import { redditPlaces, redditThreads } from "@wren/outreach/schema";
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
const calls = async (subject?: string) =>
  (await pg.db.execute(
    subject
      ? sql`select subject, label, source, ref from decision_calls where subject = ${subject} order by id`
      : sql`select subject, label, source, ref from decision_calls where kind = 'learn_worth' order by id`,
  )) as unknown as Record<string, unknown>[];

async function item(client: string, n: number, extra: Partial<typeof items.$inferInsert> = {}) {
  const [r] = await pg.db
    .insert(items)
    .values({
      client,
      url: `https://example.com/${client}/${n}`,
      title: `Synthetic item ${n}`,
      creator: "Some Creator",
      text: "A synthetic summary.",
      transcript: "Synthetic words about cold email reply rates.",
      kind: "article",
      scoredAt: NOW,
      ...extra,
    })
    .returning({ id: items.id });
  if (!r) throw new Error("no item");
  return r.id;
}

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

describe("Learn calls", () => {
  it("a star, a save and an SOP add are worth; an archive alone is skip; a client's are none", async () => {
    const a = await item("wren", 1);
    const b = await item("wren", 2);
    const c = await item("client-x", 3);
    await mark(pg.db, "wren", [a], "star", "owner@example.com");
    await mark(pg.db, "wren", [a], "archive");
    await mark(pg.db, "wren", [b], "archive");
    await mark(pg.db, "wren", [b], "archive"); // already archived: nothing changed, no call
    await mark(pg.db, "client-x", [c], "star");
    const saved = await saveLink(pg.db, {
      client: "wren",
      url: "https://example.com/wren/saved",
      by: "owner@example.com",
      via: "portal",
    });
    await askSop(pg.db, { client: "wren", itemId: b, sop: "cold-email", by: "owner@example.com" });
    expect(await calls()).toEqual([
      { subject: `learn:${a}`, label: "worth", source: "star", ref: null },
      { subject: `learn:${b}`, label: "skip", source: "archive", ref: null },
      {
        subject: `learn:${saved.id}`,
        label: "worth",
        source: "save",
        ref: `learn_worth:${saved.id}:save`,
      },
      { subject: `learn:${b}`, label: "worth", source: "sop", ref: `learn_worth:${b}:sop` },
    ]);
  });

  it("due items carry focus and words, never the creator; a decided one isn't due", async () => {
    const due = await learnDue(pg.db, NOW, 10);
    expect(due.length).toBeGreaterThanOrEqual(2);
    const first = due[0];
    expect(first?.state).toMatchObject({ item: { title: "Synthetic item 1", kind: "article" } });
    expect((first?.state.focus as string[]).length).toBeGreaterThan(3);
    expect(JSON.stringify(first?.state)).not.toContain("Some Creator");
    expect(due.every((d) => !d.subject.includes("client"))).toBe(true);
  });
});

describe("comment source", () => {
  it("an open draft is due with the post it answers; a called one isn't", async () => {
    await pg.db
      .insert(redditPlaces)
      .values({ subreddit: "smallbusiness", name: "smallbusiness", foundBy: "test" });
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
    expect(dry.calls.learn.worth).toBeGreaterThanOrEqual(2);
    expect((await calls()).length).toBe(before);
    await wren("backfill");
    const once = (await calls()).length;
    expect(once).toBeGreaterThan(before);
    await wren("backfill");
    expect((await calls()).length).toBe(once);
  });

  it("stats prints a row per kind; mode refuses a gate", async () => {
    const out = await wren("stats");
    expect(out).toContain("comment_quality");
    expect(out).toContain("learn_worth");
    await expect(wren("mode", "learn_worth", "gate")).rejects.toThrow("no gate filter");
  });
});
