/**
 * An agent chat's Changes and Undo on a real Postgres (`../../src/agent-changes.ts`): writes tagged
 * with chat and turn, undo of update, insert and delete, refusals, and a turn undone child first.
 * Synthetic rows throughout.
 */
import { createDb, type Db, installAudit } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agentChanges,
  chatOwner,
  NO_KEY,
  recordsOfTables,
  STALE,
  UNDONE,
  undoEvent,
  undoTurn,
} from "../../src/agent-changes.js";

let pg: TestPostgres;
const handles: { close: () => Promise<void> }[] = [];
/** A connection as the agent of `chat`, on `turn`: what the CLI opens under the relay. */
const agent = (chat: string, turn: string): Db => {
  const h = createDb(pg.url, { max: 1, actor: "claude-code:ann@example.com", chat, turn });
  handles.push(h);
  return h.db;
};
const BY = "ann@example.com";

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.execute(sql`create table undo_parent (
    id int generated always as identity primary key, name text, n int,
    twice int generated always as (n * 2) stored)`);
  await pg.db.execute(sql`create table undo_child (
    id int primary key, parent int references undo_parent (id), body text)`);
  await pg.db.execute(sql`create table undo_loose (x int, y text)`);
  await installAudit(pg.db);
}, 120_000);
afterAll(async () => {
  for (const h of handles) await h.close();
  await pg.stop();
});

const idsOf = async (chat: string) => (await agentChanges(pg.db, chat)).map((l) => l.id);
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: Error) => e.message,
  );

describe("tags", () => {
  it("keeps the chat and turn on the agent's writes, and none on others", async () => {
    await agent("tag", "t1").execute(sql`insert into undo_parent (name, n) values ('Tag', 1)`);
    await pg.db.execute(sql`insert into undo_parent (name, n) values ('Plain', 1)`);
    const rows = (await pg.db.execute(sql`
      select chat, turn from audit_events where table_name = 'undo_parent'
      order by id desc limit 2`)) as unknown as { chat: string | null; turn: string | null }[];
    expect(rows).toEqual([
      { chat: null, turn: null },
      { chat: "tag", turn: "t1" },
    ]);
    expect(await chatOwner(pg.db, "tag")).toBe(BY);
  });
});

describe("undo one line", () => {
  it("puts an update's before back, once", async () => {
    const [p] = (await pg.db.execute(
      sql`insert into undo_parent (name, n) values ('Before', 1) returning id`,
    )) as unknown as { id: number }[];
    await agent("up", "t1").execute(
      sql`update undo_parent set name = 'After', n = 2 where id = ${p?.id}`,
    );
    const [line] = await agentChanges(pg.db, "up");
    expect(line).toMatchObject({ op: "update", turn: "t1", undone: false, keyed: true });
    await undoEvent(pg.db, { chat: "up", event: line?.id ?? "", by: BY });
    const [now] = (await pg.db.execute(
      sql`select name, n, twice from undo_parent where id = ${p?.id}`,
    )) as unknown as unknown[];
    expect(now).toEqual({ name: "Before", n: 1, twice: 2 });
    expect((await agentChanges(pg.db, "up"))[0]?.undone).toBe(true);
    expect(await idsOf("up")).toEqual([line?.id]);
    expect(await refusal(undoEvent(pg.db, { chat: "up", event: line?.id ?? "", by: BY }))).toBe(
      UNDONE,
    );
  });

  it("refuses an update when a second writer changed it since", async () => {
    const [p] = (await pg.db.execute(
      sql`insert into undo_parent (name, n) values ('One', 1) returning id`,
    )) as unknown as { id: number }[];
    await agent("stale", "t1").execute(
      sql`update undo_parent set name = 'Two' where id = ${p?.id}`,
    );
    await pg.db.execute(sql`update undo_parent set name = 'Three' where id = ${p?.id}`);
    const [line] = await agentChanges(pg.db, "stale");
    expect(await refusal(undoEvent(pg.db, { chat: "stale", event: line?.id ?? "", by: BY }))).toBe(
      STALE,
    );
  });

  it("deletes an insert, and puts a delete back with its identity key", async () => {
    const a = agent("ins", "t1");
    const [p] = (await a.execute(
      sql`insert into undo_parent (name, n) values ('New', 3) returning id`,
    )) as unknown as { id: number }[];
    const [ins] = await agentChanges(pg.db, "ins");
    await undoEvent(pg.db, { chat: "ins", event: ins?.id ?? "", by: BY });
    expect(await pg.db.execute(sql`select 1 from undo_parent where id = ${p?.id}`)).toHaveLength(0);

    const [q] = (await pg.db.execute(
      sql`insert into undo_parent (name, n) values ('Gone', 4) returning id`,
    )) as unknown as { id: number }[];
    await agent("del", "t1").execute(sql`delete from undo_parent where id = ${q?.id}`);
    const [del] = await agentChanges(pg.db, "del");
    await undoEvent(pg.db, { chat: "del", event: del?.id ?? "", by: BY });
    const [back] = (await pg.db.execute(
      sql`select id, name, n, twice from undo_parent where id = ${q?.id}`,
    )) as unknown as unknown[];
    expect(back).toEqual({ id: q?.id, name: "Gone", n: 4, twice: 8 });
  });

  it("refuses a table with no key", async () => {
    await agent("loose", "t1").execute(sql`insert into undo_loose values (1, 'x')`);
    const [line] = await agentChanges(pg.db, "loose");
    expect(line?.keyed).toBe(false);
    expect(await refusal(undoEvent(pg.db, { chat: "loose", event: line?.id ?? "", by: BY }))).toBe(
      NO_KEY,
    );
  });

  it("refuses a line of another chat", async () => {
    await agent("mine", "t1").execute(sql`insert into undo_parent (name, n) values ('M', 1)`);
    const [line] = await agentChanges(pg.db, "mine");
    expect(
      await refusal(undoEvent(pg.db, { chat: "theirs", event: line?.id ?? "", by: BY })),
    ).toMatch(/no such change/);
  });
});

describe("undo a turn", () => {
  it("undoes the child before the parent", async () => {
    const a = agent("fam", "t1");
    const [p] = (await a.execute(
      sql`insert into undo_parent (name, n) values ('Mum', 1) returning id`,
    )) as unknown as { id: number }[];
    await a.execute(sql`insert into undo_child values (${(p?.id ?? 0) + 1000}, ${p?.id}, 'Kid')`);
    await a.execute(sql`update undo_parent set n = 5 where id = ${p?.id}`);
    const out = await undoTurn(pg.db, { chat: "fam", turn: "t1", by: BY });
    expect(out.refused).toBeUndefined();
    expect(out.undone).toHaveLength(3);
    expect(await pg.db.execute(sql`select 1 from undo_parent where id = ${p?.id}`)).toHaveLength(0);
    expect((await agentChanges(pg.db, "fam")).every((l) => l.undone)).toBe(true);
  });

  it("stops at the first refusal and names the line", async () => {
    const a = agent("halt", "t1");
    const [p] = (await a.execute(
      sql`insert into undo_parent (name, n) values ('Kept', 1) returning id`,
    )) as unknown as { id: number }[];
    await pg.db.execute(
      sql`insert into undo_child values (${(p?.id ?? 0) + 2000}, ${p?.id}, 'Other')`,
    );
    const [line] = await agentChanges(pg.db, "halt");
    const out = await undoTurn(pg.db, { chat: "halt", turn: "t1", by: BY });
    expect(out).toEqual({ undone: [], refused: { event: line?.id, why: STALE } });
  });

  it("leaves the seal chain whole", async () => {
    const [v] = (await pg.db.execute(sql`select problem from audit_verify()`)) as unknown as {
      problem: string | null;
    }[];
    expect(v?.problem ?? null).toBeNull();
  });
});

describe("records of tables", () => {
  it("follows a view through the views under it to each table", async () => {
    await pg.db.execute(sql`create schema if not exists feed`);
    await pg.db.execute(sql`create view feed.parent_base as select id, name from undo_parent`);
    await pg.db.execute(sql`create view feed.parent_records as
      select b.id, b.name, c.body from feed.parent_base b left join undo_child c on c.parent = b.id`);
    const fed = await recordsOfTables(pg.db, [
      { id: "test.parent", view: "feed.parent_records" },
      { id: "test.loose" },
      { id: "test.gone", view: "feed.no_such_view" },
    ]);
    expect(Object.fromEntries(fed)).toEqual({
      undo_parent: ["test.parent"],
      undo_child: ["test.parent"],
    });
  });
});
