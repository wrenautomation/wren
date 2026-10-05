/**
 * The audit log on a migrated database: what each change leaves, who it names,
 * that the log cannot be edited, and that seals catch an edit made anyway.
 */
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AUDIT_SKIPPED,
  AUDIT_SKIPPED_SCHEMAS,
  AUDIT_TABLES,
  auditEvents,
  auditName,
  auditSeals,
  createDb,
  type DbHandle,
  installAudit,
  recentAuditEvents,
  sealAudit,
  setAuditActor,
  verifyAudit,
} from "../../src/index.js";
import { startTestPostgres, type TestPostgres } from "../../src/testing.js";

let pg: TestPostgres;
let named: DbHandle;

type Event = {
  id: number;
  op: string;
  row_key: Record<string, unknown> | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  db_user: string;
  app: string;
  actor: string | null;
};

/** Postgres's own message, from under drizzle's "Failed query" wrapper. */
async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : String(err);
  }
  throw new Error("expected a refusal");
}

const eventsOf = (table: string) =>
  pg.db.execute<Event>(
    sql`select id::float8 as id, op, row_key, old_values, new_values, db_user, app, actor
        from audit_events where table_name = ${table} order by id`,
  );

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.execute(sql`create table audit_probe (id int primary key, name text, n int)`);
  await pg.db.execute(sql`create table audit_pair (a int, b text, v int, primary key (b, a))`);
  await pg.db.execute(sql`create table audit_loose (x int, y text)`);
  await installAudit(pg.db);
  named = createDb(pg.url, { max: 1, app: "audit-test", actor: "ann@example.com" });
}, 120_000);
afterAll(async () => {
  await named.close();
  await pg.stop();
});

describe("which tables", () => {
  it("audits every table of every schema except the skipped ones and the log itself", async () => {
    const rows = await pg.db.execute<{
      schema: string;
      table: string;
      row: boolean;
      truncate: boolean;
    }>(sql`
      select n.nspname as "schema", c.relname as "table",
        exists(select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'audit_row') as "row",
        exists(select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'audit_truncate') as "truncate"
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and left(n.nspname, 3) <> 'pg_' and n.nspname <> 'information_schema'`);
    expect(rows.length).toBeGreaterThan(40);
    // Books, delivery and the Watch keep their own schemas; the migration journal is drizzle's; sign-in is auth's.
    expect(new Set(rows.map((r) => r.schema))).toEqual(
      new Set(["public", "books", "drizzle", "auth", "delivery", "watch"]),
    );
    for (const r of rows) {
      const name = auditName(r.schema, r.table);
      const want =
        !Object.hasOwn(AUDIT_SKIPPED, name) &&
        !Object.hasOwn(AUDIT_SKIPPED_SCHEMAS, r.schema) &&
        !AUDIT_TABLES.includes(name as never);
      expect({ table: name, row: r.row, truncate: r.truncate }).toEqual({
        table: name,
        row: want,
        truncate: want,
      });
    }
  });

  it("skips only tables and schemas that exist", async () => {
    const rows = await pg.db.execute<{ s: string; t: string }>(
      sql`select schemaname as s, tablename as t from pg_tables`,
    );
    const tables = new Set(rows.map((r) => auditName(r.s, r.t)));
    for (const table of Object.keys(AUDIT_SKIPPED)) expect(tables, table).toContain(table);
    const schemas = new Set(rows.map((r) => r.s));
    for (const schema of Object.keys(AUDIT_SKIPPED_SCHEMAS))
      expect(schemas, schema).toContain(schema);
  });

  it("names a table outside public by its schema", async () => {
    await pg.db.execute(sql`create schema audit_side`);
    await pg.db.execute(sql`create table audit_side.audit_probe (id int primary key, v text)`);
    expect(await installAudit(pg.db)).toEqual({ added: 1, removed: 0 });
    await pg.db.execute(sql`insert into audit_side.audit_probe values (1, 'a')`);
    await pg.db.execute(sql`truncate audit_side.audit_probe`);
    const events = await eventsOf("audit_side.audit_probe");
    expect(events.map((e) => [e.op, e.row_key])).toEqual([
      ["insert", { id: 1 }],
      ["truncate", null],
    ]);
    expect(await eventsOf("audit_probe")).toEqual([]);
  });

  it("changes nothing when installed again", async () => {
    expect(await installAudit(pg.db)).toEqual({ added: 0, removed: 0 });
  });

  it("puts the trigger back on a table it was taken off, with the key it has now", async () => {
    await pg.db.execute(sql`drop trigger audit_row on audit_probe`);
    await pg.db.execute(sql`drop trigger audit_truncate on audit_probe`);
    expect(await installAudit(pg.db)).toEqual({ added: 1, removed: 0 });
    const args = await pg.db.execute<{ args: Buffer }>(
      sql`select tgargs as args from pg_trigger where tgrelid = 'audit_pair'::regclass and tgname = 'audit_row'`,
    );
    // Primary key (b, a): the arguments follow the key's column order.
    expect(args[0]?.args.toString("utf8")).toBe("b\0a\0");
  });

  it("matches the typed tables to the installed ones", async () => {
    for (const table of [auditEvents, auditSeals]) {
      const config = getTableConfig(table);
      const cols = await pg.db.execute<{ name: string; type: string; nullable: boolean }>(sql`
        select column_name as name, data_type as type, is_nullable = 'YES' as nullable
        from information_schema.columns where table_schema = 'public' and table_name = ${config.name}
        order by ordinal_position`);
      expect(cols).toEqual(
        config.columns.map((c) => ({ name: c.name, type: c.getSQLType(), nullable: !c.notNull })),
      );
    }
  });
});

describe("what a change leaves", () => {
  it("logs an insert by its key only", async () => {
    await pg.db.execute(sql`insert into audit_probe values (1, 'one', 1)`);
    const [e] = await eventsOf("audit_probe");
    expect(e).toMatchObject({
      op: "insert",
      row_key: { id: 1 },
      old_values: null,
      new_values: null,
    });
  });

  it("logs only the columns an update changed, before and after", async () => {
    await pg.db.execute(sql`update audit_probe set n = 2 where id = 1`);
    const e = (await eventsOf("audit_probe")).at(-1);
    expect(e).toMatchObject({
      op: "update",
      row_key: { id: 1 },
      old_values: { n: 1 },
      new_values: { n: 2 },
    });
  });

  it("logs nothing for an update that changed nothing", async () => {
    const before = (await eventsOf("audit_probe")).length;
    await pg.db.execute(sql`update audit_probe set n = 2 where id = 1`);
    expect((await eventsOf("audit_probe")).length).toBe(before);
  });

  it("keys an update that changed the key by the old key", async () => {
    await pg.db.execute(sql`update audit_probe set id = 11, name = null where id = 1`);
    const e = (await eventsOf("audit_probe")).at(-1);
    expect(e).toMatchObject({
      op: "update",
      row_key: { id: 1 },
      old_values: { id: 1, name: "one" },
      new_values: { id: 11, name: null },
    });
  });

  it("logs a delete with the whole row", async () => {
    await pg.db.execute(sql`delete from audit_probe where id = 11`);
    const e = (await eventsOf("audit_probe")).at(-1);
    expect(e).toMatchObject({
      op: "delete",
      row_key: { id: 11 },
      old_values: { id: 11, name: null, n: 2 },
      new_values: null,
    });
  });

  it("keys a composite key by every column", async () => {
    await pg.db.execute(sql`insert into audit_pair values (1, 'x', 5)`);
    const [e] = await eventsOf("audit_pair");
    expect(e?.row_key).toEqual({ a: 1, b: "x" });
  });

  it("keeps the whole row of a table with no key", async () => {
    await pg.db.execute(sql`insert into audit_loose values (7, 'seven')`);
    const [e] = await eventsOf("audit_loose");
    expect(e).toMatchObject({ op: "insert", row_key: null, new_values: { x: 7, y: "seven" } });
  });

  it("logs a truncate once, with no data", async () => {
    await pg.db.execute(sql`insert into audit_loose values (8, 'eight')`);
    await pg.db.execute(sql`truncate audit_loose`);
    const e = (await eventsOf("audit_loose")).at(-1);
    expect(e).toMatchObject({ op: "truncate", row_key: null, old_values: null, new_values: null });
  });

  it("logs each row a statement touched", async () => {
    await pg.db.execute(
      sql`insert into audit_probe values (20, 'a', 0), (21, 'b', 0), (22, 'c', 0)`,
    );
    await pg.db.execute(sql`update audit_probe set n = n + 1 where id >= 20`);
    const updates = (await eventsOf("audit_probe")).filter(
      (e) => e.op === "update" && Number((e.row_key as { id: number }).id) >= 20,
    );
    expect(updates.map((e) => e.row_key)).toEqual([{ id: 20 }, { id: 21 }, { id: 22 }]);
  });

  it("logs nothing from a rolled-back transaction", async () => {
    const before = (await eventsOf("audit_probe")).length;
    await expect(
      pg.db.transaction(async (tx) => {
        await tx.execute(sql`insert into audit_probe values (30, 'gone', 0)`);
        throw new Error("roll back");
      }),
    ).rejects.toThrow("roll back");
    expect((await eventsOf("audit_probe")).length).toBe(before);
  });
});

describe("who", () => {
  it("names the login, the app and the actor the connection gave", async () => {
    await named.db.execute(sql`insert into audit_probe values (40, 'named', 0)`);
    const e = (await eventsOf("audit_probe")).at(-1);
    expect(e).toMatchObject({ db_user: "test", app: "audit-test", actor: "ann@example.com" });
  });

  it("lets a transaction name its own actor, for that transaction only", async () => {
    await named.db.transaction(async (tx) => {
      await setAuditActor(tx, "bob@example.com");
      await tx.execute(sql`update audit_probe set n = 1 where id = 40`);
    });
    await named.db.execute(sql`update audit_probe set n = 2 where id = 40`);
    const [bob, ann] = (await eventsOf("audit_probe")).slice(-2);
    expect(bob?.actor).toBe("bob@example.com");
    expect(ann?.actor).toBe("ann@example.com");
  });

  it("leaves the actor empty when nobody said", async () => {
    await pg.db.execute(sql`insert into audit_probe values (41, 'anon', 0)`);
    const e = (await eventsOf("audit_probe")).at(-1);
    expect(e?.actor).toBeNull();
  });
});

describe("append-only", () => {
  it.each([
    ["update", sql`update audit_events set actor = 'x'`],
    ["delete", sql`delete from audit_events`],
    ["truncate", sql`truncate audit_events`],
    ["update a seal", sql`update audit_seals set events = 0`],
    ["delete a seal", sql`delete from audit_seals`],
  ])("refuses %s, even to main's login", async (_what, statement) => {
    expect(await refusal(pg.db.execute(statement))).toMatch(/is append-only/);
  });
});

describe("seals", () => {
  it("seals every finished change once, and verifies", async () => {
    const seal = await sealAudit(pg.db);
    expect(seal?.events).toBeGreaterThan(0);
    expect(await sealAudit(pg.db)).toBeNull();
    const check = await verifyAudit(pg.db);
    expect(check).toMatchObject({ seals: 1, unsealed: 0, broken: null, lastHash: seal?.hash });
    const total = await pg.db.execute<{ n: number }>(sql`select count(*)::int n from audit_events`);
    expect(check.sealed).toBe(total[0]?.n);
  });

  it("waits for a slow transaction instead of sealing past it", async () => {
    const slow = createDb(pg.url, { max: 1 });
    let release = () => {};
    let began = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      began = r;
    });
    try {
      const pending = slow.db.transaction(async (tx) => {
        await tx.execute(sql`insert into audit_probe values (50, 'slow', 0)`);
        began();
        await gate;
      });
      await started;
      // Commits first, but its transaction began after the slow one's.
      await pg.db.execute(sql`insert into audit_probe values (51, 'fast', 0)`);
      await pg.db.execute(sql`insert into audit_pair values (2, 'y', 0)`);
      const first = await sealAudit(pg.db);
      expect(first).toBeNull();
      release();
      await pending;
      const second = await sealAudit(pg.db);
      expect(second?.events).toBe(3);
    } finally {
      release();
      await slow.close();
    }
    expect(await verifyAudit(pg.db)).toMatchObject({ seals: 2, unsealed: 0, broken: null });
  });

  it("verifies the same in any time zone", async () => {
    const check = await pg.db.transaction(async (tx) => {
      await tx.execute(sql`set local timezone = 'Asia/Kathmandu'`);
      return verifyAudit(tx);
    });
    expect(check.broken).toBeNull();
  });

  it("refuses to seal outside read committed", async () => {
    const refused = pg.db.transaction((tx) => tx.execute(sql`select * from audit_seal()`), {
      isolationLevel: "repeatable read",
    });
    expect(await refusal(refused)).toMatch(/needs READ COMMITTED/);
  });

  it("catches an event edited after sealing, and passes once it is put back", async () => {
    const [victim] = await pg.db.execute<{ id: number; actor: string | null }>(
      sql`select id::float8 as id, actor from audit_events where actor = 'ann@example.com' order by id limit 1`,
    );
    if (!victim) throw new Error("no event to edit");
    await pg.db.execute(sql`alter table audit_events disable trigger append_only`);
    try {
      await pg.db.execute(sql`update audit_events set actor = 'mallory' where id = ${victim.id}`);
      const check = await verifyAudit(pg.db);
      expect(check.broken?.problem).toBe("an event changed after it was sealed");
      await pg.db.execute(
        sql`update audit_events set actor = ${victim.actor} where id = ${victim.id}`,
      );
      expect((await verifyAudit(pg.db)).broken).toBeNull();
    } finally {
      await pg.db.execute(sql`alter table audit_events enable trigger append_only`);
    }
  });

  it("catches a deleted event, and a seal edited to hide it", async () => {
    await pg.db.execute(sql`alter table audit_events disable trigger append_only`);
    await pg.db.execute(sql`alter table audit_seals disable trigger append_only`);
    try {
      await pg.db.execute(sql`create temp table kept as select * from audit_events where id = 1`);
      await pg.db.execute(sql`delete from audit_events where id = 1`);
      const check = await verifyAudit(pg.db);
      expect(check.broken).toMatchObject({ seal: 1 });
      expect(check.broken?.problem).toMatch(/events now, \d+ when sealed/);
      await pg.db.execute(sql`update audit_seals set events = events - 1 where id = 1`);
      expect((await verifyAudit(pg.db)).broken?.problem).toBe(
        "an event changed after it was sealed",
      );
      await pg.db.execute(sql`update audit_seals set events = events + 1 where id = 1`);
      await pg.db.execute(sql`insert into audit_events overriding system value select * from kept`);
      expect((await verifyAudit(pg.db)).broken).toBeNull();
    } finally {
      await pg.db.execute(sql`alter table audit_events enable trigger append_only`);
      await pg.db.execute(sql`alter table audit_seals enable trigger append_only`);
    }
  });

  it("catches a seal that no longer follows the one before", async () => {
    await pg.db.execute(sql`insert into audit_probe values (60, 'later', 0)`);
    await sealAudit(pg.db);
    await pg.db.execute(sql`alter table audit_seals disable trigger append_only`);
    try {
      await pg.db.execute(sql`update audit_seals set prev_hash = null where id = 3`);
      expect((await verifyAudit(pg.db)).broken).toEqual({
        seal: 3,
        problem: "prev_hash is not the seal before's hash",
      });
    } finally {
      await pg.db.execute(
        sql`update audit_seals s set prev_hash = p.hash from audit_seals p where s.id = 3 and p.id = 2`,
      );
      await pg.db.execute(sql`alter table audit_seals enable trigger append_only`);
    }
    expect((await verifyAudit(pg.db)).broken).toBeNull();
  });
});

describe("reading it back", () => {
  it("lists the newest first, narrowed to a table", async () => {
    const rows = await recentAuditEvents(pg.db, { table: "audit_probe", limit: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBeGreaterThan(rows[1]?.id ?? 0);
    expect(rows.every((r) => r.tableName === "audit_probe")).toBe(true);
  });
});
