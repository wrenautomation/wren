/**
 * Drafts' "Up next" (designs/2026-10-14-saving-and-ui-audit.md): every post draft that waits or
 * is scheduled, soonest first. A scheduled one goes by its slot; one that waits by when it was
 * drafted. The editor lists the same idea's other drafts.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentDrafts, contentIdeas } from "../../src/index.js";
import { draftRecordOf, siblingsOf } from "../../src/records.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  await truncate(pg.db, ["content_drafts", "content_ideas"]);
}, 300_000);
afterAll(async () => pg?.stop());

describe("Drafts, up next", () => {
  it("lists waiting and scheduled drafts by when each is due", async () => {
    const [idea] = await pg.db
      .insert(contentIdeas)
      .values({ text: "A synthetic idea", source: "cli" })
      .returning();
    if (!idea) throw new Error("no idea");
    const at = (iso: string) => new Date(iso);
    const draft = (
      platform: "x" | "linkedin" | "facebook" | "threads",
      text: string,
      status: "draft" | "approved" | "rejected",
      scheduledFor?: Date,
    ) => ({
      ideaId: idea.id,
      platform,
      text,
      status,
      promptVersion: "test",
      ...(scheduledFor ? { scheduledFor } : {}),
    });
    const rows = await pg.db
      .insert(contentDrafts)
      .values([
        draft("x", "waits, drafted first", "draft"),
        draft("linkedin", "scheduled late", "approved", at("2099-01-03T10:00:00Z")),
        draft("facebook", "scheduled soon", "approved", at("2099-01-01T10:00:00Z")),
        draft("threads", "turned down", "rejected"),
      ])
      .returning({ id: contentDrafts.id, text: contentDrafts.text });
    await pg.db.execute(
      sql`update content_drafts set created_at = '2026-10-01T00:00:00Z' where text = 'waits, drafted first'`,
    );

    const view = draftRecordOf().views.find((v) => v.id === "next");
    expect(draftRecordOf().views[0]?.id).toBe("next");
    if (!view) throw new Error("no Up next view");
    expect(view.sort).toBe("due");
    const states = (view.where as { state: string[] }).state;
    const got = await pg.db.execute<{ text: string }>(
      sql`select text from marketing_draft_records
        where state in (${sql.join(
          states.map((s) => sql`${s}`),
          sql`, `,
        )})
        order by due asc nulls last, id`,
    );
    expect(got.map((r) => r.text)).toEqual([
      "waits, drafted first",
      "scheduled soon",
      "scheduled late",
    ]);
    expect(rows).toHaveLength(4);

    // The editor shows the same idea's other platforms beside this one.
    const first = rows.find((r) => r.text === "waits, drafted first");
    if (!first) throw new Error("no draft");
    const others = await siblingsOf(pg.db, first.id);
    expect(others.map((o) => o.platform).sort()).toEqual(["facebook", "linkedin", "threads"]);
    expect(others.some((o) => o.id === first.id)).toBe(false);
  });
});
