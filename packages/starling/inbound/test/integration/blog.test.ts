import { serveRecords } from "@wren/core/records/serve";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cadenceRecord } from "../../src/analytics/records.js";
import { blogRows, keepBlogRow, markEmailed } from "../../src/blog.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});

const post = {
  slug: "synthetic-post",
  title: "A synthetic post",
  description: "One line.",
  body: "Words.",
  date: "2026-10-13",
};

describe("blog rows", () => {
  it("a draft counts nothing; published counts on Plan once; its first day stays", async () => {
    const t0 = new Date();
    await keepBlogRow(pg.db, { ...post, draft: true }, { commit: "a1", by: "test", now: t0 });
    const goal = async () =>
      (
        await serveRecords([cadenceRecord], pg.db).list({
          record: cadenceRecord.id,
          view: "week",
          limit: 30,
        })
      ).rows.find((r) => r.id === "newsletter");
    expect(await goal()).toMatchObject({ done: 0, state: "none" });

    await keepBlogRow(pg.db, { ...post, draft: false }, { commit: "b2", by: "test", now: t0 });
    const t1 = new Date(t0.getTime() + 60_000);
    await keepBlogRow(pg.db, { ...post, draft: false }, { commit: null, by: "test", now: t1 });
    const [row] = await blogRows(pg.db);
    expect(row).toMatchObject({ draft: false, commitSha: "b2" });
    expect(row?.publishedAt?.getTime()).toBe(t0.getTime());
    expect(await goal()).toMatchObject({ done: 1, today: 1 });

    await markEmailed(pg.db, post.slug, t1);
    await markEmailed(pg.db, post.slug, new Date(t1.getTime() + 1000));
    expect((await blogRows(pg.db))[0]?.emailedAt?.getTime()).toBe(t1.getTime());
  });

  it("keeps what it was written from until a save says otherwise", async () => {
    const p = { ...post, slug: "synthetic-from", draft: true };
    const now = new Date();
    const fromOf = async () =>
      (await blogRows(pg.db)).find((r) => r.slug === p.slug)?.fromRef ?? null;
    await keepBlogRow(pg.db, p, { commit: "c1", by: "test", now, from: "video:7" });
    expect(await fromOf()).toBe("video:7");
    await keepBlogRow(pg.db, p, { commit: "c2", by: "test", now });
    expect(await fromOf()).toBe("video:7");
    await keepBlogRow(pg.db, p, { commit: "c3", by: "test", now, from: null });
    expect(await fromOf()).toBeNull();
  });
});
