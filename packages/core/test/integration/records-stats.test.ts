/**
 * `recordsStats` and a type whose rows come from code (`rows`), against a real Postgres:
 * the period so far against the same stretch before, by zone, summed or counted, and every
 * bad ask refused. The fixed `now` is Tuesday 2026-03-10 15:00 UTC.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PortalRefusal } from "../../src/portal.js";
import { date, defineRecord, money, name, number, status, text } from "../../src/records.js";
import { type Mask, type RecordsApi, serveRecords } from "../../src/records-serve.js";

const NOW = new Date("2026-03-10T15:00:00Z");

const event = defineRecord({
  id: "test.event",
  name: { one: "event", many: "events" },
  view: "st_events",
  key: "id",
  title: "who",
  fields: {
    who: name(),
    kind: status({ a: { label: "A", tone: "good" }, b: { label: "B", tone: "warn" } }),
    amt: money(undefined, { currency: "cur" }),
    cur: text("Currency"),
    n: number(),
    at: date(),
  },
  views: [
    { id: "all", label: "All", at: "at" },
    { id: "b", label: "B", where: { kind: "b" }, at: "at" },
  ],
  related: [{ record: "test.tally", by: "event_id" }],
});

let calls = 0;
const tally = defineRecord({
  id: "test.tally",
  name: { one: "tally", many: "tallies" },
  rows: async () => {
    calls++;
    return [
      { who: "Ann Doe", state: "on", hits: 3, last: new Date("2026-03-09T12:00:00Z"), event_id: 2 },
      { who: "Bo Roe", state: "off", hits: 12, last: null, event_id: 4 },
      { who: "Cy Poe", state: "on", hits: 7, last: new Date("2026-03-10T01:00:00Z"), event_id: 2 },
    ];
  },
  key: "who",
  title: "who",
  fields: {
    who: name(),
    state: status({ on: { label: "On", tone: "good" }, off: { label: "Off", tone: "neutral" } }),
    hits: number(),
    last: date(),
  },
  views: [
    { id: "on", label: "On", where: { state: "on" }, sort: "-hits", at: "last" },
    { id: "all", label: "All", sort: "hits" },
  ],
  related: [{ record: "test.event", by: "who" }],
});

let pg: TestPostgres;
let api: RecordsApi;
let demo: RecordsApi;
const mask: Mask = <T>(v: T): T => JSON.parse(JSON.stringify(v).replaceAll("Doe", "D.")) as T;

beforeAll(async () => {
  pg = await startTestPostgres();
  // [at, kind, amt, cur]: this week so far is 03-04 00:00 to now; the week before, cut to the
  // same 6 days 15 hours, is 02-25 00:00 to 03-03 15:00.
  const rows: [string, string, number, string][] = [
    ["2026-03-04T01:00:00Z", "b", 10, "USD"],
    ["2026-03-10T03:00:00Z", "a", 1, "USD"], // Chicago's yesterday (22:00 CDT on the 9th)
    ["2026-03-10T10:00:00Z", "b", 2, "USD"],
    ["2026-03-10T14:59:00Z", "a", 4, "USD"],
    ["2026-03-10T16:00:00Z", "a", 100, "USD"], // later today: not yet
    ["2026-02-25T00:00:00Z", "a", 5, "USD"],
    ["2026-03-03T14:00:00Z", "a", 6, "USD"],
    ["2026-03-03T16:00:00Z", "a", 100, "USD"], // past the same elapsed stretch
    ["2026-03-09T06:00:00Z", "a", 7, "EUR"], // Chicago's prior day, a second currency
  ];
  await pg.db.execute(sql`create table st_events_t (id int, who text, kind text, amt numeric,
    cur text, n int, at timestamptz)`);
  for (const [i, [at, kind, amt, cur]] of rows.entries())
    await pg.db.execute(sql`insert into st_events_t values
      (${i + 1}, ${i % 2 ? "Ann Doe" : "Bo Roe"}, ${kind}, ${amt}, ${cur}, 1, ${at}::timestamptz)`);
  await pg.db.execute(sql`create view st_events as select * from st_events_t`);
  api = serveRecords([event, tally], pg.db);
  demo = serveRecords([event, tally], pg.db, mask);
});
afterAll(() => pg.stop());

const refused = async (p: Promise<unknown>, status = 400) => {
  const err = await p.then(
    () => "answered",
    (e: unknown) => e,
  );
  if (!(err instanceof PortalRefusal)) throw new Error(`not a refusal: ${String(err)}`);
  expect(err.status).toBe(status);
};
const ask = { record: "test.event", view: "all", period: 7 } as const;
const usd = { cur: "USD" };

describe("recordsStats", () => {
  it("counts this week so far against the same stretch of last week, by day", async () => {
    const s = await api.stats({ ...ask, where: usd }, NOW);
    expect([s.value, s.prior, s.currency]).toEqual([4, 2, null]);
    expect(s.series.map((d) => d.at.slice(0, 10))).toEqual([
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
    ]);
    expect(s.series.map((d) => d.value)).toEqual([1, 0, 0, 0, 0, 0, 3]);
  });

  it("sums a money field and names its currency; mixed currencies are refused", async () => {
    const s = await api.stats({ ...ask, where: usd, sum: "amt" }, NOW);
    expect([s.value, s.prior, s.currency]).toEqual([17, 11, "USD"]);
    expect(s.series.at(-1)?.value).toBe(7);
    await refused(api.stats({ ...ask, sum: "amt" }, NOW));
  });

  it("an empty prior period is zero, and the series still covers every day", async () => {
    const s = await api.stats({ ...ask, view: "b" }, NOW);
    expect([s.value, s.prior]).toEqual([2, 0]);
    expect(s.series).toHaveLength(7);
  });

  it("today, by the asker's zone: Chicago's day began at 05:00 UTC", async () => {
    const utc = await api.stats({ ...ask, where: usd, period: 1 }, NOW);
    expect([utc.value, utc.prior]).toEqual([3, 0]);
    const chi = await api.stats({ ...ask, period: 1, zone: "America/Chicago" }, NOW);
    expect([chi.value, chi.prior]).toEqual([2, 1]);
    expect(chi.series).toEqual([{ at: "2026-03-10T05:00:00.000Z", value: 2 }]);
  });

  it("a month so far against last month's first nine days and fifteen hours", async () => {
    const s = await api.stats({ ...ask, where: usd, period: "month" }, NOW);
    expect([s.value, s.prior, s.series.length]).toEqual([6, 0, 10]);
  });

  it("refuses what it can't answer", async () => {
    await refused(api.stats({ record: "test.event", period: 7 }, NOW)); // no date
    await refused(api.stats({ ...ask, at: "n" }, NOW));
    await refused(api.stats({ ...ask, sum: "who" }, NOW));
    for (const period of [0, 93, 1.5, "week", null])
      await refused(api.stats({ ...ask, period: period as 7 }, NOW));
    await refused(api.stats({ ...ask, zone: "Mars/Base" }, NOW));
    await refused(api.stats({ ...ask, view: "nope" }, NOW));
    await refused(api.stats({ ...ask, record: "nope" }, NOW), 404);
  });

  it("the demo counts too, but never filters by a name", async () => {
    expect((await demo.stats({ ...ask, where: usd }, NOW)).value).toBe(4);
    await refused(demo.stats({ ...ask, where: { who: "Ann Doe" } }, NOW));
  });
});

describe("a type whose rows come from code", () => {
  it("filters, sorts, pages and counts like a view, read once per serve", async () => {
    calls = 0;
    const fresh = serveRecords([event, tally], pg.db);
    const page = await fresh.list({ record: "test.tally", view: "on", limit: 1 });
    expect(page.rows).toMatchObject([{ id: "Cy Poe", hits: 7, state: "on" }]);
    expect([page.total, page.counts]).toEqual([2, { on: 2, all: 3 }]);
    const next = await fresh.list({ record: "test.tally", view: "on", cursor: page.next ?? "" });
    expect(next.rows.map((r) => r.id)).toEqual(["Ann Doe"]);
    const all = await fresh.list({ record: "test.tally", view: "all" });
    expect(all.rows.map((r) => r.hits)).toEqual([3, 7, 12]);
    expect(calls).toBe(1);
  });

  it("gets one, with what points at it either way", async () => {
    const one = await api.get({ record: "test.tally", id: "Ann Doe" });
    expect(one.row).toMatchObject({ last: "2026-03-09T12:00:00.000Z" });
    expect(one.related).toEqual([{ record: "test.event", count: 4 }]);
    // A column no field shows, read because events point at tallies by it.
    const e = await api.get({ record: "test.event", id: "2" });
    expect(e.related).toEqual([{ record: "test.tally", count: 2 }]);
    const of = await api.list({ record: "test.tally", of: { record: "test.event", id: 2 } });
    expect(of.rows.map((r) => r.id)).toEqual(["Ann Doe", "Cy Poe"]);
    await refused(api.get({ record: "test.tally", id: "Nobody" }), 404);
  });

  it("has stats like any type", async () => {
    const s = await api.stats({ record: "test.tally", view: "on", period: 1 }, NOW);
    expect([s.value, s.prior]).toEqual([1, 1]);
  });
});
