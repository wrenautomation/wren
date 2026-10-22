/**
 * Studio's line and angle stay on the idea (wa-4ep): written with the words, read back on the
 * waiting board. An angle off the list is refused by the table.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { waitingIdeas, writeOwn } from "../../src/own.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
}, 300_000);
afterAll(async () => pg?.stop());
beforeEach(async () => {
  await truncate(pg.db, ["content_drafts", "content_ideas"]);
});

describe("an idea's line and angle", () => {
  it("are kept when written and read back on the waiting board", async () => {
    await writeOwn(pg.db, {
      text: "One plain post.",
      platforms: ["x", "linkedin"],
      by: null,
      mark: { line: "line-a", angle: "Proof" },
    });
    const [idea] = await waitingIdeas(pg.db);
    expect(idea).toMatchObject({ line: "line-a", angle: "Proof" });
    expect(idea?.drafts).toHaveLength(2);
  });

  it("are null when none is picked", async () => {
    await writeOwn(pg.db, { text: "Another post.", platforms: ["x"], by: null });
    const [idea] = await waitingIdeas(pg.db);
    expect(idea).toMatchObject({ line: null, angle: null });
  });

  it("refuse an angle off the list", async () => {
    const err = await pg.db
      .execute(sql`insert into content_ideas (text, source, angle) values ('x', 'cli', 'Rant')`)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(String((err as { cause?: unknown } | null)?.cause)).toMatch(/ck_content_ideas_angle/);
  });
});
