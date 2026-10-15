/**
 * A Reddit draft gets its subreddit picked for it (designs/2026-10-14-saving-and-ui-audit.md):
 * when made, and again at Approve for one made before. The panel lists what's missing and the
 * watched places it may pick; a place whose gate holds every account is never picked.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approveDrafts, contentDrafts } from "../../src/index.js";
import { writeOwn } from "../../src/own.js";
import { shapeView } from "../../src/shape-view.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
}, 300_000);
afterAll(async () => pg?.stop());
beforeEach(async () => {
  await truncate(pg.db, [
    "reddit_requirements",
    "reddit_places",
    "content_drafts",
    "content_ideas",
  ]);
});

const now = new Date("2026-10-14T15:00:00Z");
const write = async () => {
  const r = await writeOwn(pg.db, {
    text: "What a week of cold calls taught me\nThe body of the post, plain and short.",
    platforms: ["reddit"],
    by: null,
  });
  const first = r.results[0];
  if (!first?.ok) throw new Error("no draft");
  return first.draft;
};
const place = (sub: string, fit: number) =>
  pg.db.execute(sql`insert into reddit_places (subreddit, name, found_by, judged, fit, state)
    values (${sub}, ${sub}, 'topic: sales',
      ${JSON.stringify({ fit, why: "fits", rules: "", mayComment: true, mayPost: true, linkOnly: false })}::jsonb,
      ${fit}, 'watching')`);

describe("a Reddit draft's subreddit", () => {
  it("with no watched place, the panel says what's missing and Approve says what to do", async () => {
    const d = await write();
    expect(d.extra.subreddit).toBeUndefined();
    const view = await shapeView(pg.db, d.id);
    expect(view?.missing).toContain("Subreddit");
    expect(view?.places).toEqual([]);
    const err = await approveDrafts(pg.db, [d.id], { now }).catch((e: Error) => e);
    expect(String(err)).toContain(
      '"What a week of cold calls taught me" on Reddit: no subreddit we watch takes posts',
    );
    expect(String(err)).not.toContain(d.id);
  });

  it("is picked when made, past a place whose gate holds every account", async () => {
    await place("held_sub", 9);
    await place("open_sub", 7);
    await pg.db.execute(
      sql`insert into reddit_requirements (subreddit, source, hold) values ('held_sub', 'removal', true)`,
    );
    const d = await write();
    expect(d.extra.subreddit).toBe("open_sub");
    const view = await shapeView(pg.db, d.id);
    expect(view?.missing).toEqual([]);
    expect(view?.places).toEqual(["open_sub"]);
  });

  it("is picked at Approve for a draft made before any place was watched", async () => {
    const d = await write();
    await place("open_sub", 7);
    const [r] = await approveDrafts(pg.db, [d.id], { now });
    expect(r?.status).toBe("approved");
    const [row] = await pg.db.select().from(contentDrafts).where(eq(contentDrafts.id, d.id));
    expect(row?.extra.subreddit).toBe("open_sub");
  });
});
