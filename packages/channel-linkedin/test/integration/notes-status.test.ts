import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { llmCalls } from "@wren/core/schema";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ingestNotes, moveToDone, readInbox } from "../../src/inbox.js";
import { addNote, listNotes } from "../../src/notes.js";
import { notes, posts } from "../../src/schema.js";
import { collectStatus } from "../../src/status.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["notes", "posts", "llm_calls", "research_runs"]));

/** Same wiring the Restate handler uses, minus the journal. */
async function ingestDir(dir: string): Promise<number> {
  const found = await readInbox(dir);
  return ingestNotes(found, {
    insert: async (n) => void (await addNote(pg.db, n.body, "inbox", n.imagePaths)),
    move: (n) => moveToDone(dir, n),
  });
}

describe("notes", () => {
  it("ingest inserts rows and moves files; a rerun is a no-op", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inbox-"));
    await writeFile(join(dir, "a.md"), "first");
    await writeFile(join(dir, "a.png"), "");
    expect(await ingestDir(dir)).toBe(1);
    expect(await ingestDir(dir)).toBe(0);
    const rows = await listNotes(pg.db, "new");
    expect(rows.map((r) => [r.body, r.source, r.imagePaths.length])).toEqual([
      ["first", "inbox", 1],
    ]);
    expect((await readdir(join(dir, "done"))).sort()).toEqual(["a.md", "a.png"]);
  });
  it("addNote trims and rejects blank", async () => {
    const row = await addNote(pg.db, "  hi  ", "cli");
    expect(row.body).toBe("hi");
    await expect(addNote(pg.db, " ", "cli")).rejects.toThrow(/empty/);
  });
});

describe("collectStatus", () => {
  it("counts posts, notes, and only this month's spend", async () => {
    const today = new Date("2026-09-17T00:00:00Z");
    await pg.db.insert(posts).values([
      { postType: "insight", draftPath: "a.md", createdAt: new Date("2026-09-14T00:00:00Z") },
      { postType: "insight", draftPath: "b.md", status: "published" },
    ]);
    await pg.db.insert(notes).values({ body: "n", source: "cli" });
    const call = { provider: "p", model: "m", promptName: "n", promptHash: "h", stage: "draft" };
    await pg.db.insert(llmCalls).values([
      { ...call, costUsd: 1.25 },
      { ...call, costUsd: 9, createdAt: new Date("2026-08-31T23:00:00Z") },
    ]);
    const r = await collectStatus(pg.db, today);
    expect(r.postsByStatus).toEqual({ draft: 1, published: 1 });
    expect(r.oldestDraftDays).toBe(3);
    expect(r.unusedNotes).toBe(1);
    expect(r.lastResearchRunAt).toBeNull();
    expect(r.spendThisMonthUsd).toBeCloseTo(1.25);
  });
});
