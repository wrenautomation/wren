/**
 * `site_days` against Postgres: the lander's export rolled up per day and first touch, then
 * upserted. A second read of the same export changes nothing; a later read with more rows
 * overwrites the day, never adds to it. Synthetic rows only.
 */
import type { SiteApplication, SiteEvent, SiteHit } from "@wren/channel-email";
import { serveRecords } from "@wren/core/records/serve";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { asc, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rollupHeat, writeHeatDays } from "../../src/heat.js";
import { heatRecord, SEARCH_RECORDS, sessionRecord } from "../../src/records.js";
import { siteDays } from "../../src/schema.js";
import { callsAndPaid, rollupSite, upsertSiteDays } from "../../src/site-days.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [
    "site_days",
    "search_days",
    "search_answers",
    "search_keywords",
    "heat_days",
    "scroll_days",
  ]);
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
const app = (ts: string, visitor: string, first_touch = "", email = ""): SiteApplication => ({
  id: ++id,
  ts: `${ts}T12:00:00.000Z`,
  visitor,
  offer: "demo",
  fit: 1,
  r: "",
  first_touch,
  email,
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
  app("2026-01-02", "v3", JSON.stringify({ utm_source: "sms" }), "lead@firm.example"),
];

const read = () =>
  pg.db
    .select()
    .from(siteDays)
    .orderBy(asc(siteDays.day), asc(siteDays.channel))
    .then((rows) => rows.map(({ syncedAt: _, ...r }) => r));

describe("site days", () => {
  it("reads booked calls and paid engagements (a bare `day` alias is a syntax error on prod)", async () => {
    expect(await callsAndPaid(pg.db)).toEqual({ calls: [], paid: [] });
  });

  it("counts each visit, form and booking click under the visitor's first touch", async () => {
    await upsertSiteDays(pg.db, rollupSite(hits, apps));
    const zero = {
      visits: 0,
      firstTouches: 0,
      forms: 0,
      bookings: 0,
      watchPlays: 0,
      calls: 0,
      paid: 0,
    };
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

  it("a booked call counts by its link code, else by its email's form; paid by its source", async () => {
    const calls = [
      { day: "2026-01-03", code: "code12345", email: null },
      { day: "2026-01-03", code: null, email: "Lead@Firm.example" },
      { day: "2026-01-03", code: null, email: "stranger@else.example" },
    ];
    const paid = [{ day: "2026-01-09", channel: "sms" as const, campaign: "" }];
    await upsertSiteDays(pg.db, rollupSite(hits, apps, calls, paid));
    const later = (await read()).filter((r) => r.day >= "2026-01-03");
    expect(later.map((r) => [r.day, r.channel, r.calls, r.paid])).toEqual([
      ["2026-01-03", "email", 1, 0],
      ["2026-01-03", "other", 1, 0],
      ["2026-01-03", "sms", 1, 0],
      ["2026-01-09", "sms", 0, 1],
    ]);
    const api = serveRecords(SEARCH_RECORDS, pg.db);
    const funnel = await api.list({ record: "marketing.funnel", view: "all", limit: 50 });
    expect(funnel.rows.find((r) => r.channel === "sms")).toMatchObject({
      forms: 1,
      calls: 1,
      paid: 1,
    });
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

  it("sessions read live from the export; opening one signs each chunk", async () => {
    const tables: Record<string, unknown[]> = {
      replays: [
        {
          id: 1,
          view: "vw1",
          visitor: "v3",
          page: "/",
          started: "2026-01-02T12:00:00.000Z",
          last: "2026-01-02T12:01:30.000Z",
          chunks: 2,
          bytes: 4096,
          w: 390,
          country: "US",
          capped: 0,
          first_touch: JSON.stringify({ utm_source: "sms" }),
        },
      ],
      applications: apps,
    };
    const fetch = async (url: string) => {
      const u = new URL(url);
      const table = u.searchParams.get("table") ?? "";
      const rows = u.searchParams.get("since") === "0" ? (tables[table] ?? []) : [];
      return new Response(JSON.stringify({ [table]: rows }), { status: 200 });
    };
    const record = sessionRecord({
      site: { baseUrl: "https://site.example", exportToken: "t", fetch },
      signGet: async (key) => `https://signed.example/${key}`,
    });
    const api = serveRecords([record], pg.db);
    const { rows } = await api.list({ record: "marketing.session", view: "applied", limit: 5 });
    expect(rows).toMatchObject([
      { id: "vw1", secs: 90, device: "phone", channel: "sms", applied: "demo", kb: 4 },
    ]);
    expect(await record.load?.(pg.db, "vw1")).toEqual({
      replay: {
        urls: [
          "https://signed.example/site/replays/vw1/0000.json",
          "https://signed.example/site/replays/vw1/0001.json",
        ],
      },
    });
  });

  it("heatmaps: a day re-read replaces its rows; opening a page signs its newest replay", async () => {
    const today = new Date().toISOString().slice(0, 10);
    let n = 0;
    const ev = (view: string, name: string, props: object): SiteEvent => ({
      id: ++n,
      ts: `${today}T12:00:00.000Z`,
      view,
      visitor: null,
      page: "/agencies",
      name,
      props: JSON.stringify(props),
    });
    const first = [
      ev("a", "click", { path: "#cta", fx: 0.5, fy: 0.5, b: "phone" }),
      ev("a", "scroll", { pct: 50, b: "phone" }),
    ];
    await writeHeatDays(pg.db, rollupHeat(first));
    const more = [...first, ev("b", "click", { path: "#cta", fx: 0.5, fy: 0.5, b: "phone" })];
    await writeHeatDays(pg.db, rollupHeat(more));

    const replays = [
      { view: "old", page: "/agencies", started: `${today}T01:00:00Z`, chunks: 3, w: 390 },
      { view: "new", page: "/agencies", started: `${today}T02:00:00Z`, chunks: 3, w: 400 },
      { view: "big", page: "/agencies", started: `${today}T03:00:00Z`, chunks: 3, w: 1500 },
    ].map((r, i) => ({
      id: i + 1,
      visitor: null,
      last: r.started,
      bytes: 1,
      country: "",
      capped: 0,
      ...r,
    }));
    const fetch = async (url: string) =>
      new Response(
        JSON.stringify({ replays: new URL(url).searchParams.get("since") === "0" ? replays : [] }),
      );
    const record = heatRecord({
      site: { baseUrl: "https://site.example", exportToken: "t", fetch },
      signGet: async (key) => `https://signed.example/${key}`,
    });
    const api = serveRecords([record], pg.db);
    const { rows } = await api.list({ record: "marketing.heat", view: "7d", limit: 5 });
    expect(rows).toMatchObject([
      { id: "7d:phone:/agencies", page: "/agencies", width: "phone", views: 1, clicks: 2, rage: 0 },
    ]);
    expect(await record.load?.(pg.db, "30d:phone:/agencies")).toEqual({
      heat: {
        cells: [{ path: "#cta", cell: 55, clicks: 2, rage: 0 }],
        bands: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
        snapshot: { url: "https://signed.example/site/replays/new/0000.json", w: 400 },
      },
    });
    // Without the export, the counts alone.
    const bare = await heatRecord().load?.(pg.db, "7d:phone:/agencies");
    expect(bare).toMatchObject({ heat: { snapshot: null } });
    expect(await record.load?.(pg.db, "1y:phone:/agencies")).toBeNull();

    // By day: one row per day, and one day's heat alone.
    const days = await api.list({ record: "marketing.heat", view: "day", limit: 5 });
    expect(days.rows).toMatchObject([
      {
        id: `${today}:phone:/agencies`,
        day: `${today}T00:00:00.000Z`,
        views: 1,
        clicks: 2,
        rage: 0,
      },
    ]);
    expect(await heatRecord().load?.(pg.db, `${today}:phone:/agencies`)).toMatchObject({
      heat: { cells: [{ path: "#cta", clicks: 2 }], bands: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0] },
    });
    expect(await heatRecord().load?.(pg.db, "2001-01-01:phone:/agencies")).toMatchObject({
      heat: { cells: [], bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    });
  });
});
