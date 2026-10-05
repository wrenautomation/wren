/**
 * `site_days` against Postgres: the lander's export rolled up per day and first touch, then
 * upserted. A second read of the same export changes nothing; a later read with more rows
 * overwrites the day, never adds to it. Synthetic rows only.
 */
import type { SiteApplication, SiteHit } from "@wren/channel-email";
import { serveRecords } from "@wren/core/records/serve";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { asc, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SEARCH_RECORDS } from "../../src/records.js";
import { siteDays } from "../../src/schema.js";
import { rollupSite, upsertSiteDays } from "../../src/site-days.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, ["site_days", "search_days", "search_answers", "search_keywords"]);
});

let id = 0;
const hit = (
  ts: string,
  visitor: string | null,
  page: string,
  o: Partial<SiteHit> = {},
): SiteHit => ({
  id: ++id,
  ts: `${ts}T12:00:00.000Z`,
  visitor,
  page,
  secs: 5,
  cta: 0,
  touched: 0,
  r: "",
  ...o,
});
const app = (ts: string, visitor: string, first_touch = ""): SiteApplication => ({
  id: ++id,
  ts: `${ts}T12:00:00.000Z`,
  visitor,
  offer: "demo",
  fit: 1,
  r: "",
  first_touch,
});

const hits = [
  hit("2026-01-01", "v1", "/", {
    utm_source: "linkedin",
    utm_medium: "organic",
    utm_campaign: "launch",
  }),
  hit("2026-01-01", "v1", "/pricing"),
  hit("2026-01-01", "v2", "/", { r: "code12345" }),
  hit("2026-01-01", "v2", "/book/demo"),
  hit("2026-01-02", "v1", "/watch/demo"),
  hit("2026-01-02", "v3", "/"),
  hit("2026-01-02", null, "/", { ref: "https://www.google.com/" }),
];
const apps = [
  app("2026-01-02", "v1"),
  app("2026-01-02", "v3", JSON.stringify({ utm_source: "sms" })),
];

const read = () =>
  pg.db
    .select()
    .from(siteDays)
    .orderBy(asc(siteDays.day), asc(siteDays.channel))
    .then((rows) => rows.map(({ syncedAt: _, ...r }) => r));

describe("site days", () => {
  it("counts each visit, form and booking click under the visitor's first touch", async () => {
    await upsertSiteDays(pg.db, rollupSite(hits, apps));
    const zero = { visits: 0, firstTouches: 0, forms: 0, bookings: 0, watchPlays: 0 };
    expect(await read()).toEqual([
      {
        ...zero,
        day: "2026-01-01",
        channel: "content",
        campaign: "launch",
        visits: 1,
        firstTouches: 1,
      },
      {
        ...zero,
        day: "2026-01-01",
        channel: "email",
        campaign: "",
        visits: 1,
        firstTouches: 1,
        bookings: 1,
      },
      {
        ...zero,
        day: "2026-01-02",
        channel: "content",
        campaign: "launch",
        visits: 1,
        forms: 1,
        watchPlays: 1,
      },
      { ...zero, day: "2026-01-02", channel: "direct", campaign: "", visits: 1, firstTouches: 1 },
      { ...zero, day: "2026-01-02", channel: "search", campaign: "", visits: 1, firstTouches: 1 },
      { ...zero, day: "2026-01-02", channel: "sms", campaign: "", forms: 1 },
    ]);
  });

  it("a re-read never double counts; a longer export overwrites the day", async () => {
    await upsertSiteDays(pg.db, rollupSite(hits, apps));
    const once = await read();
    await upsertSiteDays(pg.db, rollupSite(hits, apps));
    expect(await read()).toEqual(once);
    await upsertSiteDays(pg.db, rollupSite([...hits, hit("2026-01-01", "v2", "/book/demo")], apps));
    const email = (await read()).find((r) => r.day === "2026-01-01" && r.channel === "email");
    expect(email).toMatchObject({ visits: 1, bookings: 2 });
    expect(await read()).toHaveLength(once.length);
  });

  it("serves every search and site record, every view, with the footer's sums", async () => {
    await upsertSiteDays(pg.db, rollupSite(hits, apps));
    await pg.db.execute(sql`
      insert into search_keywords (phrase, source) values ('synthetic phrase', 'seed');
      insert into search_days (day, query, page, clicks, impressions, position) values
        ('2026-01-10', 'synthetic phrase', 'https://site.example/', 2, 40, 3),
        ('2026-01-02', 'synthetic phrase', 'https://site.example/', 1, 10, 5);
      insert into search_answers (engine, keyword_id, asked_on, cited, sources, questions)
        select 'google', id, '2026-01-10', true, '[]', '[]' from search_keywords`);
    const api = serveRecords(SEARCH_RECORDS, pg.db);
    for (const t of SEARCH_RECORDS)
      for (const v of t.views) await api.list({ record: t.id, view: v.id, limit: 50 });
    const site = await api.list({ record: "marketing.site_day", view: "channel", limit: 50 });
    expect(site.totals.booked).toEqual({ n: 1, of: 5 });
    const [kw] = (await api.list({ record: "marketing.keyword", limit: 5 })).rows;
    expect(kw).toMatchObject({
      clicks: 2,
      impressions: 40,
      clicksChange: 1,
      impressionsChange: 30,
    });
    const answers = await api.list({ record: "marketing.answer", view: "cited", limit: 5 });
    expect(answers.rows).toHaveLength(1);
  });
});
