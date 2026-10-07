/**
 * What is the signed-in person's own (`mine`), against a real Postgres: a view kept to them, a
 * type kept to them, and `rows` told who reads. Nobody signed in reads none of it.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PortalRequest } from "../../src/portal.js";
import { actor, date, defineRecord, type Me, status, text } from "../../src/records.js";
import { meOf, serveRecords } from "../../src/records-serve.js";

const ANN: Me = { email: "ann@example.test", team: true };
const BO: Me = { email: "bo@example.test", team: true };

const STATE = status({
  open: { label: "Open", tone: "warn" },
  done: { label: "Done", tone: "good" },
});

/** Shared rows with an owner: everyone sees them all, "Mine" is each person's own. */
const task = defineRecord({
  id: "test.task",
  app: "work",
  channel: null,
  name: { one: "task", many: "tasks" },
  view: "mine_tasks",
  key: "id",
  title: "what",
  fields: { what: text(), owner: text(), state: STATE, at: date() },
  views: [
    { id: "all", label: "All", at: "at" },
    { id: "mine", label: "Mine", where: { state: "open" }, mine: "owner", at: "at" },
  ],
});

let asked: (Me | null | undefined)[] = [];
/** One person's rows only: the type is `mine`, and `rows` hears who reads. */
const ping = defineRecord({
  id: "test.ping",
  app: "work",
  channel: null,
  name: { one: "ping", many: "pings" },
  rows: async (_db, me) => {
    asked.push(me);
    // As a careless source would: everyone's rows. The type keeps the reader's.
    return [
      { id: "p1", who: "ann@example.test", what: "Look", at: "2026-03-09T12:00:00Z" },
      { id: "p2", who: "ANN@example.test", what: "Again", at: "2026-03-10T12:00:00Z" },
      { id: "p3", who: "bo@example.test", what: "Yours", at: "2026-03-10T12:00:00Z" },
    ];
  },
  mine: "who",
  key: "id",
  title: "what",
  fields: { what: text(), who: actor(), at: date() },
  views: [{ id: "all", label: "All", at: "at" }],
});

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.execute(sql`create table mine_tasks_t (id int, what text, owner text, state text,
    at timestamptz)`);
  await pg.db.execute(sql`insert into mine_tasks_t values
    (1, 'Call', 'ann@example.test', 'open', now()),
    (2, 'Write', 'Ann@Example.test', 'open', now()),
    (3, 'Ship', 'ann@example.test', 'done', now()),
    (4, 'Plan', 'bo@example.test', 'open', now()),
    (5, 'Wait', 'Team', 'open', now())`);
  await pg.db.execute(sql`create view mine_tasks as select * from mine_tasks_t`);
});
afterAll(() => pg.stop());

describe("a mine view", () => {
  it("lists and counts the reader's own rows, any case", async () => {
    const page = await serveRecords([task], pg.db, undefined, undefined, ANN).list({
      record: task.id,
      view: "mine",
    });
    expect(page.rows.map((r) => r.what).sort()).toEqual(["Call", "Write"]);
    expect(page.total).toBe(2);
    expect(page.counts).toEqual({ all: 5, mine: 2 });
    const bo = await serveRecords([task], pg.db, undefined, undefined, BO).list({
      record: task.id,
      view: "mine",
    });
    expect(bo.counts).toEqual({ all: 5, mine: 1 });
  });

  it("is empty for nobody, and leaves other views whole", async () => {
    const page = await serveRecords([task], pg.db).list({ record: task.id, view: "mine" });
    expect(page.total).toBe(0);
    expect(page.counts).toEqual({ all: 5, mine: 0 });
  });

  it("counts by period for the reader only", async () => {
    const s = await serveRecords([task], pg.db, undefined, undefined, ANN).stats({
      record: task.id,
      view: "mine",
      period: 7,
    });
    expect(s.value).toBe(2);
  });
});

describe("a mine type", () => {
  it("keeps every read to the reader, and tells rows who reads", async () => {
    asked = [];
    const api = serveRecords([ping], pg.db, undefined, undefined, ANN);
    const page = await api.list({ record: ping.id, view: "all" });
    expect(page.rows.map((r) => r.id).sort()).toEqual(["p1", "p2"]);
    expect(asked).toEqual([ANN]);
    await expect(api.get({ record: ping.id, id: "p3" })).rejects.toThrow(/no such ping/);
    expect((await api.get({ record: ping.id, id: "p1" })).row.what).toBe("Look");
  });

  it("has no rows for nobody", async () => {
    const page = await serveRecords([ping], pg.db).list({ record: ping.id, view: "all" });
    expect(page.total).toBe(0);
  });
});

describe("meOf", () => {
  const req = (r: Partial<PortalRequest>) => ({ viewer: { demo: true }, ...r }) as PortalRequest;
  it("is the signed-in address, lowercased; nobody for the demo and View as", () => {
    expect(meOf(req({ viewer: { email: " Ann@Example.test ", operator: true } }))).toEqual(ANN);
    expect(meOf(req({ viewer: { email: "c@client.test" } }))).toEqual({
      email: "c@client.test",
      team: false,
    });
    expect(meOf(req({}))).toBeNull();
    expect(meOf(req({ viewer: { email: "ann@example.test" }, viewAs: "c@client.test" }))).toBe(
      null,
    );
  });
});

describe("declaring mine", () => {
  it("refuses a field that isn't text or an actor", () => {
    expect(() =>
      defineRecord({
        id: "test.bad",
        app: "work",
        channel: null,
        name: { one: "bad", many: "bads" },
        view: "x",
        key: "id",
        title: "what",
        fields: { what: text(), at: date() },
        views: [{ id: "all", label: "All", mine: "at" }],
      }),
    ).toThrow(/not a text or actor field/);
  });
});
