/**
 * `serveRecords` against a real Postgres and a synthetic view: paging that never repeats or
 * skips a row whatever the ties and nulls, every hostile input refused or bound (never run),
 * and the demo mask over list, get and export. Anything but an answer or a PortalRefusal would
 * be a raw error, which Restate retries forever.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PortalRefusal } from "../../src/portal.js";
import {
  company,
  date,
  defineRecord,
  link,
  money,
  name,
  number,
  percent,
  rate,
  status,
  text,
  verdict,
} from "../../src/records.js";
import { type ListAsk, type Mask, type RecordsApi, serveRecords } from "../../src/records-serve.js";

const STATES = {
  open: { label: "Open", tone: "good" },
  held: { label: "Held", tone: "warn" },
  shut: { label: "Shut", tone: "neutral" },
} as const;

const item = defineRecord({
  id: "test.item",
  name: { one: "item", many: "items" },
  view: "rec_items",
  key: "id",
  title: "nm",
  subtitle: "note",
  fields: {
    nm: name("Name"),
    firm: company(undefined, { domain: "firm_domain" }),
    state: status(STATES),
    n: number(),
    amt: money(undefined, { currency: "cur" }),
    pct: percent(),
    hits: rate("tries"),
    seen: date(),
    verdict: verdict(),
    url: link(),
    note: text(),
  },
  views: [
    { id: "open", label: "Open", where: { state: ["open"] }, sort: "-n" },
    { id: "byName", label: "By name", sort: "nm" },
    { id: "all", label: "All" },
  ],
  related: [{ record: "test.kid", by: "item" }],
  activity: { view: "rec_log", by: "item" },
  load: async (db, id) => {
    const [r] = await db.execute<{ secret: string }>(
      sql`select 'note about ' || nm secret from rec_items where id::text = ${id}`,
    );
    return r ?? null;
  },
});
const kid = defineRecord({
  id: "test.kid",
  name: { one: "kid", many: "kids" },
  view: "rec_kids",
  key: "id",
  title: "what",
  fields: { what: text(), item: number() },
  views: [{ id: "all", label: "All" }],
});
const TYPES = [item, kid];
const N = 250;

let pg: TestPostgres;
let api: RecordsApi;
/** The demo's mask, as the portal's would: the surname "Doe" and the firm "Acme" hidden. */
const mask: Mask = <T>(v: T): T =>
  JSON.parse(JSON.stringify(v).replaceAll("Doe", "D.").replaceAll("Acme", "Sample firm")) as T;
let demo: RecordsApi;

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.execute(sql`
    create table rec_items_t as
    select i id,
      case when i % 5 = 0 then 'Jane Doe ' || i else 'Sam Roe ' || i end nm,
      case when i % 3 = 0 then 'Acme' else 'Other Co' end firm, 'firm' || (i % 3) || '.example' firm_domain,
      (array['open','held','shut'])[1 + i % 3] state,
      case when i % 11 = 0 then null else i % 7 end n,
      (i % 4) * 100.5 amt, 'USD' cur, (i % 10) / 10.0 pct, i % 4 hits, 4 tries,
      case when i % 13 = 0 then null else timestamptz '2026-01-01' + (i % 6) * interval '1 day' end seen,
      (array['valid','risky','invalid','catch_all'])[1 + i % 4] verdict,
      'https://x.example/' || i url, 'note ' || (i % 9) || case when i % 5 = 0 then ' Doe' else '' end note
    from generate_series(1, ${N}) i`);
  await pg.db.execute(sql`create view rec_items as select * from rec_items_t`);
  await pg.db.execute(sql`create view rec_kids as
    select i id, 'kid ' || i what, 1 + i % 10 item from generate_series(1, 30) i`);
  await pg.db.execute(sql`create view rec_log as
    select 5 item, timestamptz '2026-02-01' at, 'sent' kind, 'Hello Jane Doe' what`);
  api = serveRecords(TYPES, pg.db);
  demo = serveRecords(TYPES, pg.db, mask);
});
afterAll(() => pg.stop());

/** Resolves, or refuses with a PortalRefusal of this status: never a raw error. */
const refused = async (p: Promise<unknown>, status = 400) => {
  const err = await p.then(
    () => "answered",
    (e: unknown) => e,
  );
  if (!(err instanceof PortalRefusal)) throw new Error(`not a refusal: ${String(err)}`);
  expect(err.status).toBe(status);
};

/** Every page of an ask, three rows at a time. */
async function walk(serve: RecordsApi, ask: Omit<ListAsk, "cursor" | "limit">) {
  const ids: (string | number)[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 200; i++) {
    const page = await serve.list({ ...ask, limit: 3, ...(cursor ? { cursor } : {}) });
    ids.push(...page.rows.map((r) => r.id));
    if (!page.next) return { ids, total: page.total };
    cursor = page.next;
  }
  throw new Error("paging never ended");
}

describe("paging", () => {
  for (const sort of [undefined, "n", "-n", "seen", "-seen", "state", "-state", "nm", "-hits"])
    it(`every row once, in order, sorted by ${sort ?? "key"}`, async () => {
      const { ids, total } = await walk(api, { record: "test.item", ...(sort ? { sort } : {}) });
      expect(total).toBe(N);
      expect(new Set(ids).size).toBe(N);
      const one = await api.list({ record: "test.item", limit: 200, ...(sort ? { sort } : {}) });
      expect(ids.slice(0, 200)).toEqual(one.rows.map((r) => r.id));
    });

  it("a view filters, sorts and counts", async () => {
    const page = await api.list({ record: "test.item", view: "open", limit: 200 });
    expect(page.rows.every((r) => r.state === "open")).toBe(true);
    expect(page.counts).toEqual({ open: page.total, byName: N, all: N });
    const ns = page.rows.map((r) => r.n).filter((n) => n !== null) as number[];
    expect(ns).toEqual([...ns].sort((a, b) => b - a));
  });

  it("caps the limit", async () => {
    expect((await api.list({ record: "test.item", limit: 10_000 })).rows).toHaveLength(200);
    await refused(api.list({ record: "test.item", limit: 0 }));
    await refused(api.list({ record: "test.item", limit: 2.5 }));
  });

  it("a page marker from another sort is refused", async () => {
    const page = await api.list({ record: "test.item", sort: "n", limit: 3 });
    await refused(api.list({ record: "test.item", sort: "-n", cursor: page.next ?? "" }));
  });

  it("cells come typed", async () => {
    const r = (await api.get({ record: "test.item", id: "3" })).row;
    expect(r.firm).toEqual({ name: "Acme", domain: "firm0.example" });
    expect(r.amt).toEqual({ amount: 301.5, currency: "USD" });
    expect(r.hits).toEqual({ n: 3, of: 4 });
    expect(r.seen).toBe("2026-01-04T00:00:00.000Z");
  });
});

describe("hostile input", () => {
  const evil = `x"; drop table rec_items_t; --`;
  const asks: [string, ListAsk][] = [
    ["a field name", { record: "test.item", where: { [evil]: "1" } }],
    ["a column outside the type", { record: "test.item", where: { firm_domain: "x" } }],
    ["an op", { record: "test.item", where: { n: { [evil]: 1 } as never } }],
    ["an op the kind lacks", { record: "test.item", where: { n: { contains: "1" } as never } }],
    ["a sort", { record: "test.item", sort: `n; ${evil}` }],
    ["a sort on a field that doesn't sort", { record: "test.item", sort: "url" }],
    ["a view", { record: "test.item", view: evil }],
    ["a state outside the set", { record: "test.item", where: { state: evil } }],
    ["a number that isn't", { record: "test.item", where: { n: evil } }],
    ["a date that isn't", { record: "test.item", where: { seen: { gte: evil } } }],
    ["a cursor", { record: "test.item", cursor: evil }],
    [
      "a forged cursor",
      { record: "test.item", sort: "n", cursor: forged(["n", false, evil, "1"]) },
    ],
    ["a related record not declared", { record: "test.item", of: { record: "test.kid", id: 1 } }],
    ["a long search", { record: "test.item", q: "x".repeat(101) }],
    ["a search that isn't text", { record: "test.item", q: { $ne: 1 } as never }],
    ["a where that isn't an object", { record: "test.item", where: "1=1" as never }],
    ["a huge in list", { record: "test.item", where: { state: Array(101).fill("open") } }],
  ];
  for (const [what, ask] of asks)
    it(`refuses ${what}`, async () => {
      await refused(api.list(ask));
      // Export reads every page at once: it takes no cursor.
      if (!ask.cursor) await refused(api.export(ask));
    });

  it("an unknown record is 404 on every handler", async () => {
    for (const record of ["test.nope", "__proto__", "toString", evil]) {
      await refused(api.list({ record }), 404);
      await refused(api.get({ record, id: 1 }), 404);
      await refused(api.export({ record }), 404);
    }
  });

  it("an id that isn't one is 404, never raw", async () => {
    for (const id of [evil, { a: 1 }, null, "x".repeat(300), 1.5])
      await refused(api.get({ record: "test.item", id: id as never }), 404);
    await refused(api.get({ record: "test.item", id: 9999 }), 404);
  });

  it("search and contains bind the text, wildcards included", async () => {
    for (const q of ["%", "_", "\\", `' or 1=1 --`]) {
      expect((await api.list({ record: "test.item", q })).total).toBe(0);
      expect(
        (await api.list({ record: "test.item", where: { note: { contains: q } } })).total,
      ).toBe(0);
    }
    // "Jane Doe 5", "Jane Doe 50", "Jane Doe 55"
    expect((await api.list({ record: "test.item", q: "jane doe 5" })).total).toBe(3);
  });

  it("the table is still there", async () => {
    const [r] = await pg.db.execute<{ n: number }>(sql`select count(*)::int n from rec_items_t`);
    expect(r?.n).toBe(N);
  });
});

describe("the demo", () => {
  const leaks = (v: unknown) => /Doe|Acme/.test(JSON.stringify(v));

  it("masks every row, detail, activity and CSV cell", async () => {
    const page = await demo.list({ record: "test.item", limit: 200 });
    expect(page.rows.length).toBe(200);
    expect(leaks(page.rows)).toBe(false);
    const one = await demo.get({ record: "test.item", id: 5 });
    expect(one.row.nm).toBe("Jane D. 5");
    expect(leaks(one)).toBe(false);
    expect(one.activity?.[0]?.what).toBe("Hello Jane D.");
    const csv = await demo.export({ record: "test.item" });
    expect(csv.rows).toBe(N);
    expect(leaks(csv.csv)).toBe(false);
    expect((await api.export({ record: "test.item" })).csv).toContain("Jane Doe");
  });

  it("never filters, sorts or searches what could name someone", async () => {
    await refused(demo.list({ record: "test.item", where: { nm: { contains: "Doe" } } }));
    await refused(demo.list({ record: "test.item", where: { firm: "Acme" } }));
    await refused(demo.list({ record: "test.item", where: { note: { contains: "D" } } }));
    await refused(demo.list({ record: "test.item", sort: "nm" }));
    await refused(demo.list({ record: "test.item", sort: "note" }));
    await refused(demo.list({ record: "test.item", q: "Jane" }));
    await refused(demo.export({ record: "test.item", where: { firm: ["Acme"] } }));
  });

  it("a value the mask would rewrite matches nothing", async () => {
    // i = 5 mod 45: 5, 50, 95, 140, 185, 230
    expect((await api.list({ record: "test.item", where: { note: "note 5 Doe" } })).total).toBe(6);
    expect((await demo.list({ record: "test.item", where: { note: "note 5 Doe" } })).total).toBe(0);
  });

  it("a view that sorts by name pages by key instead, and its markers carry no name", async () => {
    const { ids } = await walk(demo, { record: "test.item", view: "byName" });
    expect(new Set(ids).size).toBe(N);
    const page = await demo.list({ record: "test.item", view: "byName", limit: 3 });
    expect(Buffer.from(page.next ?? "", "base64url").toString()).not.toMatch(/Doe|Roe/);
  });

  it("says so in the types", () => {
    const [meta] = demo.types();
    const f = (k: string) => meta?.fields.find((x) => x.key === k);
    expect(f("nm")).toMatchObject({ ops: [], sortable: false, searchable: false });
    expect(f("note")).toMatchObject({ ops: ["eq", "in", "empty"], sortable: false });
    expect(f("n")).toMatchObject({ sortable: true });
    expect(api.types()[0]?.fields.find((x) => x.key === "nm")?.searchable).toBe(true);
  });
});

function forged(c: unknown[]) {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}
