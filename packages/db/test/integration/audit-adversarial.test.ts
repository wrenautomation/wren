/**
 * Adversarial cover for the audit log: keyless updates, disabled triggers,
 * partition truncates, a temp-table shadow of the log, odd data, forgery that
 * verify() must catch, and concurrency (two sealers, sealing under load, an
 * install waiting on a live writer). Tests marked "BUG" assert how the code
 * should behave, so they fail now and pass once the source is fixed.
 */
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  type Db,
  type DbHandle,
  installAudit,
  sealAudit,
  verifyAudit,
} from "../../src/index.js";
import { startTestPostgres, type TestPostgres } from "../../src/testing.js";

type Event = {
  id: number;
  table_name: string;
  op: string;
  row_key: Record<string, unknown> | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  db_user: string;
  app: string;
  actor: string | null;
};

let pg: TestPostgres;
let writer: DbHandle;
const handles: DbHandle[] = [];

/** Postgres's own message, from under drizzle's "Failed query" wrapper. */
async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : String((err as Error).message ?? err);
  }
  throw new Error("expected a refusal");
}

const events = (db: Db, table: string) =>
  db.execute<Event>(sql`
    select id::float8 as id, table_name, op, row_key, old_values, new_values, db_user, app, actor
    from audit_events where table_name = ${table} order by id`);

const maxId = async (db: Db): Promise<number> => {
  const [r] = await db.execute<{ m: number | null }>(
    sql`select max(id)::float8 as m from audit_events`,
  );
  return r?.m ?? 0;
};

const dbUrl = (name: string): string => {
  const u = new URL(pg.url);
  u.pathname = `/${name}`;
  return u.toString();
};

/** A fresh database with the audit layer and the given tables; a clean seal state. */
async function freshAudited(name: string, tables: string[], app = "adv"): Promise<DbHandle> {
  await pg.db.execute(sql.raw(`create database ${name}`));
  const h = createDb(dbUrl(name), { max: 4, app });
  handles.push(h);
  for (const t of tables) await h.db.execute(sql.raw(t));
  await installAudit(h.db);
  return h;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  pg = await startTestPostgres();
  const ddl = [
    "create table adv_parent (id int primary key, name text)",
    "create table adv_child (id int primary key, parent_id int references adv_parent on delete cascade on update cascade, note text)",
    "create table adv_upsert (id int primary key, v text, n int)",
    "create table adv_keyless (a int, b text)",
    `create table "Adv ""Odd"" Table" ("Id" text primary key, "it's" text, doc jsonb, raw bytea, amount numeric, ratio float8, seen timestamptz, gap interval, tags text[])`,
    "create table adv_part (id int, region text, v int, primary key (id, region)) partition by list (region)",
    "create table adv_part_east partition of adv_part for values in ('east')",
    "create table adv_off (id int primary key, v text)",
    "create table adv_pk (a int, b text, v int, primary key (a))",
    "create table adv_secret (id int primary key, v text)",
  ];
  for (const s of ddl) await pg.db.execute(sql.raw(s));
  await installAudit(pg.db);
  // A plain login that owns nothing, to act as a client would.
  await pg.db.execute(sql.raw("create role adv_writer login password 'adv-writer-pass'"));
  await pg.db.execute(
    sql.raw(
      "grant select, insert, update, delete, truncate on adv_parent, adv_child, adv_secret, adv_upsert to adv_writer",
    ),
  );
  await pg.db.execute(sql.raw("grant temporary on database test to adv_writer"));
  const wu = new URL(pg.url);
  wu.username = "adv_writer";
  wu.password = "adv-writer-pass";
  writer = createDb(wu.toString(), { max: 1, app: "adv-writer" });
}, 180_000);

afterAll(async () => {
  await writer.close();
  for (const h of handles) await h.close();
  await pg.stop();
});

describe("upsert and merge", () => {
  it("logs an insert, then a real update, and nothing for a no-op upsert", async () => {
    await pg.db.execute(sql`insert into adv_upsert values (1, 'a', 1)`);
    await pg.db.execute(
      sql`insert into adv_upsert values (1, 'b', 1) on conflict (id) do update set v = excluded.v`,
    );
    const before = (await events(pg.db, "adv_upsert")).length;
    await pg.db.execute(sql`insert into adv_upsert values (1, 'b', 1) on conflict (id) do nothing`);
    await pg.db.execute(
      sql`insert into adv_upsert values (1, 'b', 1) on conflict (id) do update set v = excluded.v`,
    );
    const evs = await events(pg.db, "adv_upsert");
    expect(evs.map((e) => e.op)).toEqual(["insert", "update"]);
    expect(evs[1]).toMatchObject({ old_values: { v: "a" }, new_values: { v: "b" } });
    expect(evs.length).toBe(before);
  });

  it("logs every row a MERGE touches", async () => {
    await pg.db.execute(sql`insert into adv_upsert values (2, 'x', 0), (3, 'y', 0)`);
    const before = await maxId(pg.db);
    await pg.db.execute(sql`
      merge into adv_upsert t
      using (values (2, 'x2'), (3, 'y2'), (4, 'z')) as s(id, v) on t.id = s.id
      when matched then update set v = s.v
      when not matched then insert (id, v, n) values (s.id, s.v, 0)`);
    const evs = (await events(pg.db, "adv_upsert")).filter((e) => e.id > before);
    expect(evs).toHaveLength(3);
    expect(evs.map((e) => e.op).sort()).toEqual(
      expect.arrayContaining(["insert", "update", "update"]),
    );
  });
});

describe("cascades run as the caller", () => {
  it("logs an ON DELETE CASCADE with the caller's login and app", async () => {
    await writer.db.execute(sql`insert into adv_parent values (10, 'p')`);
    await writer.db.execute(sql`insert into adv_child values (100, 10, 'c')`);
    const before = await maxId(pg.db);
    await writer.db.execute(sql`delete from adv_parent where id = 10`);
    const evs = (
      await pg.db.execute<Event>(sql`
        select id::float8 as id, table_name, op, db_user, app from audit_events
        where id > ${before} order by table_name`)
    ).map((e) => ({ table_name: e.table_name, op: e.op, db_user: e.db_user, app: e.app }));
    expect(evs).toEqual([
      { table_name: "adv_child", op: "delete", db_user: "adv_writer", app: "adv-writer" },
      { table_name: "adv_parent", op: "delete", db_user: "adv_writer", app: "adv-writer" },
    ]);
  });

  it("logs an ON UPDATE CASCADE of the key on the child as well", async () => {
    await writer.db.execute(sql`insert into adv_parent values (11, 'p')`);
    await writer.db.execute(sql`insert into adv_child values (110, 11, 'c')`);
    const before = await maxId(pg.db);
    await writer.db.execute(sql`update adv_parent set id = 12 where id = 11`);
    const tables = (
      await pg.db.execute<Event>(
        sql`select id::float8 as id, table_name from audit_events where id > ${before} order by id`,
      )
    ).map((e) => e.table_name);
    expect(tables).toContain("adv_child");
    expect(tables).toContain("adv_parent");
  });

  it("logs a TRUNCATE ... CASCADE on both the named and the pulled-in table", async () => {
    await writer.db.execute(sql`insert into adv_parent values (20, 'p')`);
    await writer.db.execute(sql`insert into adv_child values (200, 20, 'c')`);
    const before = await maxId(pg.db);
    await pg.db.execute(sql`truncate adv_parent cascade`);
    const evs = (
      await pg.db.execute<Event>(
        sql`select id::float8 as id, table_name, op from audit_events where id > ${before} and op = 'truncate' order by table_name`,
      )
    ).map((e) => e.table_name);
    expect(evs).toEqual(["adv_child", "adv_parent"]);
  });
});

describe("keeping the trigger list in step", () => {
  it("audits a table added after install, at the next install", async () => {
    await pg.db.execute(sql`create table adv_later (id int primary key, v text)`);
    expect(await installAudit(pg.db)).toEqual({ added: 1, removed: 0 });
    expect(await installAudit(pg.db)).toEqual({ added: 0, removed: 0 });
    await pg.db.execute(sql`insert into adv_later values (1, 'x')`);
    expect((await events(pg.db, "adv_later")).map((e) => e.op)).toEqual(["insert"]);
  });

  it("drops the triggers of a table just added to the skip list", async () => {
    // runs and documents are skipped; give them triggers by hand, then install takes them off.
    await pg.db.execute(
      sql`create trigger audit_row after insert or update or delete on runs for each row execute function audit_row()`,
    );
    await pg.db.execute(
      sql`create trigger audit_truncate after truncate on runs for each statement execute function audit_row()`,
    );
    await pg.db.execute(
      sql`create trigger audit_truncate after truncate on documents for each statement execute function audit_row()`,
    );
    expect(await installAudit(pg.db)).toEqual({ added: 0, removed: 2 });
    const left = await pg.db.execute<{ n: number }>(sql`
      select count(*)::int n from pg_trigger
      where tgrelid in ('runs'::regclass, 'documents'::regclass)
        and tgname in ('audit_row', 'audit_truncate')`);
    expect(left[0]?.n).toBe(0);
  });

  it("rewrites the trigger's key when the primary key changes", async () => {
    const argsOf = async () => {
      const [r] = await pg.db.execute<{ a: Buffer | null }>(
        sql`select tgargs a from pg_trigger where tgrelid = 'adv_pk'::regclass and tgname = 'audit_row'`,
      );
      return r?.a?.toString("utf8") ?? null;
    };
    expect(await argsOf()).toBe("a\0");
    await pg.db.execute(sql`alter table adv_pk drop constraint adv_pk_pkey`);
    await pg.db.execute(sql`alter table adv_pk add primary key (b, a)`);
    expect(await installAudit(pg.db)).toEqual({ added: 1, removed: 0 });
    expect(await argsOf()).toBe("b\0a\0");
    await pg.db.execute(sql`insert into adv_pk values (7, 'k', 1)`);
    expect((await events(pg.db, "adv_pk")).at(-1)?.row_key).toEqual({ a: 7, b: "k" });
  });

  // BUG: a keyless table logs only the changed columns on an update, so the row
  // it touched cannot be told apart. The design doc says a keyless table logs
  // whole rows (install.ts audit_row update branch, lines 62-69).
  it("keeps the whole old row of a keyless update", async () => {
    await pg.db.execute(sql`insert into adv_keyless values (1, 'x')`);
    await pg.db.execute(sql`update adv_keyless set b = 'y' where a = 1`);
    const e = (await events(pg.db, "adv_keyless")).at(-1);
    expect(e?.op).toBe("update");
    expect(e?.old_values).toEqual({ a: 1, b: "x" });
    expect(e?.new_values).toEqual({ a: 1, b: "y" });
  });
});

describe("re-enabling triggers turned off by hand", () => {
  // BUG: install checks a trigger's existence and args, never tgenabled, so a
  // trigger disabled by hand stays off (index.ts syncAuditTriggers, line 116).
  it("puts back a table's audit triggers that were disabled", async () => {
    await pg.db.execute(sql`alter table adv_off disable trigger user`);
    try {
      await installAudit(pg.db);
      const before = await maxId(pg.db);
      await pg.db.execute(sql`insert into adv_off values (1, 'a')`);
      await pg.db.execute(sql`truncate adv_off`);
      const evs = (await events(pg.db, "adv_off")).filter((e) => e.id > before);
      expect(evs.map((e) => e.op)).toEqual(["insert", "truncate"]);
    } finally {
      await pg.db.execute(sql`alter table adv_off enable trigger user`);
    }
  });

  // BUG: the same for the log's guard. Install only checks it exists, so a
  // disabled append_only stays off (index.ts installAudit, lines 75-80).
  it("re-arms a disabled append_only guard", async () => {
    await pg.db.execute(sql`alter table audit_seals disable trigger append_only`);
    try {
      await installAudit(pg.db);
      expect(await refusal(pg.db.execute(sql`delete from audit_seals where false`))).toMatch(
        /append-only/,
      );
    } finally {
      await pg.db.execute(sql`alter table audit_seals enable trigger append_only`);
    }
  });
});

describe("partitions", () => {
  it("logs an insert once, named by the partition, and covers a newly attached one", async () => {
    await pg.db.execute(sql`insert into adv_part values (1, 'east', 5)`);
    const east = await events(pg.db, "adv_part_east");
    expect(east.map((e) => e.op)).toEqual(["insert"]);
    await pg.db.execute(
      sql`create table adv_part_west partition of adv_part for values in ('west')`,
    );
    expect(await installAudit(pg.db)).toEqual({ added: 0, removed: 0 });
    await pg.db.execute(sql`insert into adv_part values (2, 'west', 6)`);
    expect((await events(pg.db, "adv_part_west")).map((e) => e.op)).toEqual(["insert"]);
  });

  it("logs a truncate of the whole partitioned table once per table it empties", async () => {
    await installAudit(pg.db);
    const before = await maxId(pg.db);
    await pg.db.execute(sql`truncate adv_part`);
    const evs = await pg.db.execute<Event>(
      sql`select id::float8 as id, table_name, op from audit_events where id > ${before} and op = 'truncate'`,
    );
    expect(evs.map((e) => e.table_name).sort()).toEqual([
      "adv_part",
      "adv_part_east",
      "adv_part_west",
    ]);
  });

  // BUG: truncating a partition directly is not logged. The parent's TRUNCATE
  // trigger is a statement trigger and is not cloned to partitions, and
  // partitions get no trigger of their own (index.ts lines 100, 123-127).
  it("logs a truncate of a partition on its own", async () => {
    await pg.db.execute(sql`insert into adv_part values (3, 'east', 7)`);
    const before = await maxId(pg.db);
    await pg.db.execute(sql`truncate adv_part_east`);
    const evs = await pg.db.execute<Event>(
      sql`select id::float8 as id, table_name, op from audit_events where id > ${before} and op = 'truncate'`,
    );
    expect(evs.map((e) => e.table_name)).toEqual(["adv_part_east"]);
  });
});

describe("the log cannot be shadowed", () => {
  // BUG (latent): audit_row is SECURITY DEFINER with search_path
  // "pg_catalog, public" and no pg_temp, so pg_temp is searched first. A login
  // with TEMP can shadow public.audit_events and swallow its own writes
  // (install.ts line 40). Prod clients lack TEMP; this login has it to show it.
  it("writes to the real log even when a temp audit_events exists", async () => {
    const wu = new URL(pg.url);
    wu.username = "adv_writer";
    wu.password = "adv-writer-pass";
    const raw = postgres(wu.toString(), { max: 1, onnotice: () => {} });
    try {
      await raw`create temp table audit_events (table_name text, op text, row_key jsonb, old_values jsonb, new_values jsonb)`;
      await raw`insert into adv_secret values (1, 's')`;
      const [real] = await pg.db.execute<{ n: number }>(
        sql`select count(*)::int n from public.audit_events where table_name = 'adv_secret'`,
      );
      expect(real?.n).toBe(1);
    } finally {
      await raw.end({ timeout: 1 });
    }
  });
});

describe("the connection's app cannot be overridden by the URL", () => {
  // BUG (minor): a URL query application_name is merged after createDb's app,
  // so it wins and the audit event's app is wrong (index.ts createDb line 36).
  it("keeps createDb's app over an application_name in the URL", async () => {
    const h = createDb(`${pg.url}?application_name=from-url`, { max: 1, app: "wren-worker" });
    handles.push(h);
    await h.db.execute(sql`insert into adv_secret values (2, 's2')`);
    const e = (await events(pg.db, "adv_secret")).find(
      (x) => (x.row_key as { id: number }).id === 2,
    );
    expect(e?.app).toBe("wren-worker");
  });
});

describe("odd data", () => {
  let odd: DbHandle;
  const big = `${"héllo \"quote\" 'apos' 日本語 \\ ".repeat(50_000)}end`;
  beforeAll(async () => {
    odd = await freshAudited("adv_odd", [
      `create table "Adv ""Odd"" Table" ("Id" text primary key, "it's" text, doc jsonb, raw bytea, amount numeric, ratio float8, seen timestamptz, gap interval, tags text[])`,
    ]);
  }, 120_000);

  it("logs, seals and verifies rows of every awkward type", async () => {
    await odd.db.execute(sql`
      insert into "Adv ""Odd"" Table" values ('k1', ${big}, '{"a":[1,null,"x"],"b":{}}'::jsonb,
        decode('00ff27225c', 'hex'), 1e30::numeric, 1.5e308::float8, 'infinity'::timestamptz,
        '1 year 2 mons 3 days 04:05:06'::interval, array['a', null, 'c'])`);
    await odd.db.execute(sql`
      insert into "Adv ""Odd"" Table" values ('k2', null, null, null, null, null, null, null, null)`);
    await odd.db.execute(sql`update "Adv ""Odd"" Table" set "it's" = 'changed' where "Id" = 'k2'`);
    await odd.db.execute(sql`delete from "Adv ""Odd"" Table" where "Id" = 'k1'`);
    const evs = await events(odd.db, 'Adv "Odd" Table');
    expect(evs.map((e) => e.op)).toEqual(["insert", "insert", "update", "delete"]);
    const seal = await sealAudit(odd.db);
    expect(seal?.events).toBe(4);
    expect(await verifyAudit(odd.db)).toMatchObject({ seals: 1, unsealed: 0, broken: null });
  });

  it("stores NaN and Infinity floats without breaking the log", async () => {
    await odd.db.execute(sql`
      insert into "Adv ""Odd"" Table" ("Id", ratio) values ('nan', 'NaN'::float8), ('inf', 'Infinity'::float8)`);
    const rows = await odd.db.execute<{ row_key: { Id: string } }>(sql`
      select row_key from audit_events where table_name = 'Adv "Odd" Table' and op = 'insert'
      and row_key->>'Id' in ('nan', 'inf')`);
    expect(rows).toHaveLength(2);
    expect((await sealAudit(odd.db))?.events).toBe(2);
    expect(await verifyAudit(odd.db)).toMatchObject({ broken: null, unsealed: 0 });
  });

  it("verifies the same whatever the reader's session settings", async () => {
    const base = await verifyAudit(odd.db);
    const check = await odd.db.transaction(async (tx) => {
      await tx.execute(sql`set local datestyle = 'German, DMY'`);
      await tx.execute(sql`set local extra_float_digits = '-3'`);
      await tx.execute(sql`set local bytea_output = 'escape'`);
      await tx.execute(sql`set local intervalstyle = 'iso_8601'`);
      await tx.execute(sql`set local timezone = 'Asia/Kathmandu'`);
      return verifyAudit(tx);
    });
    expect(check.broken).toBeNull();
    expect(check.lastHash).toBe(base.lastHash);
  });
});

describe("verify catches tampering", () => {
  let th: DbHandle;
  type Seal = { id: number; from_era: number; from_tx: number; through_tx: number; hash: string };
  let seals: Seal[] = [];

  class Undo extends Error {}
  /** Tamper inside a transaction (guards off via replica role), read the result, roll back. */
  async function tampered<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    let out: T | undefined;
    try {
      await th.db.transaction(async (tx) => {
        await tx.execute(sql`set local session_replication_role = replica`);
        out = await fn(tx as unknown as Db);
        throw new Undo();
      });
    } catch (e) {
      if (!(e instanceof Undo)) throw e;
    }
    return out as T;
  }

  beforeAll(async () => {
    th = await freshAudited("adv_tamper", ["create table t (id int primary key, v text)"]);
    for (let round = 0; round < 3; round++) {
      // Two separate transactions per seal, so each seal spans two distinct tx values.
      await th.db.execute(sql`insert into t values (${round * 2}, 'a')`);
      await th.db.execute(sql`insert into t values (${round * 2 + 1}, 'b')`);
      await sealAudit(th.db);
    }
    seals = await th.db.execute<Seal>(sql`
      select id::float8 as id, from_era, from_tx::float8 as from_tx, through_tx::float8 as through_tx,
        encode(hash, 'hex') as hash from audit_seals order by id`);
    expect(seals).toHaveLength(3);
    expect(await verifyAudit(th.db)).toMatchObject({ broken: null, unsealed: 0 });
  }, 120_000);

  it("catches a deleted middle seal", async () => {
    const check = await tampered(async (tx) => {
      await tx.execute(sql`delete from audit_seals where id = ${seals[1]?.id}`);
      return verifyAudit(tx);
    });
    expect(check.broken?.seal).toBe(seals[2]?.id);
    expect(check.broken?.problem).toMatch(/^starts at era \d+ tx/);
  });

  it("catches a deleted first seal", async () => {
    const check = await tampered(async (tx) => {
      await tx.execute(sql`delete from audit_seals where id = ${seals[0]?.id}`);
      return verifyAudit(tx);
    });
    expect(check.broken).toEqual({
      seal: seals[1]?.id,
      problem: `starts at era ${seals[1]?.from_era} tx ${seals[1]?.from_tx}, the seal before ended at era 0 tx 0`,
    });
  });

  it("cannot catch a deleted newest seal (only the out-of-band hash can)", async () => {
    const check = await tampered(async (tx) => {
      await tx.execute(sql`delete from audit_seals where id = ${seals[2]?.id}`);
      return verifyAudit(tx);
    });
    expect(check.broken).toBeNull();
    expect(check.lastHash).toBe(seals[1]?.hash);
    expect(check.unsealed).toBeGreaterThanOrEqual(2);
  });

  it("catches an event slipped into a sealed range", async () => {
    const check = await tampered(async (tx) => {
      await tx.execute(
        sql`insert into audit_events (tx, table_name, op) values (${seals[1]?.from_tx}, 't', 'insert')`,
      );
      return verifyAudit(tx);
    });
    expect(check.broken?.seal).toBe(seals[1]?.id);
    expect(check.broken?.problem).toMatch(/events now/);
  });

  it("catches two events with their tx swapped inside one seal", async () => {
    const check = await tampered(async (tx) => {
      const ids = await tx.execute<{ id: number; tx: number }>(sql`
        select id::float8 as id, tx::float8 as tx from audit_events
        where tx >= ${seals[0]?.from_tx} and tx < ${seals[0]?.through_tx} order by id limit 2`);
      const [a, b] = ids;
      if (!a || !b) throw new Error("need two events");
      await tx.execute(sql`update audit_events set tx = ${b.tx} where id = ${a.id}`);
      await tx.execute(sql`update audit_events set tx = ${a.tx} where id = ${b.id}`);
      return verifyAudit(tx);
    });
    expect(check.broken?.problem).toBe("an event changed after it was sealed");
  });

  it("catches two events with every column but id swapped", async () => {
    const check = await tampered(async (tx) => {
      const ids = await tx.execute<{ id: number }>(sql`
        select id::float8 as id from audit_events
        where tx >= ${seals[0]?.from_tx} and tx < ${seals[0]?.through_tx} order by id limit 2`);
      const [a, b] = ids;
      if (!a || !b) throw new Error("need two events");
      await tx.execute(sql`
        update audit_events x set tx = y.tx, at = y.at, table_name = y.table_name, op = y.op,
          row_key = y.row_key, old_values = y.old_values, new_values = y.new_values,
          db_user = y.db_user, app = y.app, actor = y.actor
        from audit_events y
        where (x.id = ${a.id} and y.id = ${b.id}) or (x.id = ${b.id} and y.id = ${a.id})`);
      return verifyAudit(tx);
    });
    expect(check.broken?.problem).toBe("an event changed after it was sealed");
  });

  it("catches an event moved past the last seal", async () => {
    const check = await tampered(async (tx) => {
      const [one] = await tx.execute<{ id: number }>(sql`
        select id::float8 as id from audit_events
        where tx >= ${seals[0]?.from_tx} and tx < ${seals[0]?.through_tx} order by id limit 1`);
      await tx.execute(sql`update audit_events set tx = 1000000000000 where id = ${one?.id}`);
      return verifyAudit(tx);
    });
    expect(check.broken?.seal).toBe(seals[0]?.id);
    expect(check.broken?.problem).toMatch(/events now/);
  });

  it("cannot catch an edited event re-chained through every later seal", async () => {
    const check = await tampered(async (tx) => {
      const [one] = await tx.execute<{ id: number }>(sql`
        select id::float8 as id from audit_events
        where tx >= ${seals[1]?.from_tx} and tx < ${seals[1]?.through_tx} order by id limit 1`);
      await tx.execute(sql`update audit_events set actor = 'mallory' where id = ${one?.id}`);
      // Re-chain seal 2 onward: each hash from its (new) events and the seal before's new hash.
      let prev = seals[0]?.hash ?? null;
      for (const s of seals) {
        if (s.id < (seals[1]?.id ?? 0)) continue;
        const [row] = await tx.execute<{ hash: string }>(sql`
          select encode(sha256(coalesce(decode(${prev}, 'hex'), ''::bytea)
            || coalesce(string_agg(audit_event_hash(e), ''::bytea order by e.tx, e.id), ''::bytea)), 'hex') as hash
          from audit_events e where e.tx >= ${s.from_tx} and e.tx < ${s.through_tx}`);
        await tx.execute(sql`
          update audit_seals set hash = decode(${row?.hash}, 'hex'),
            prev_hash = ${prev === null ? null : sql`decode(${prev}, 'hex')`} where id = ${s.id}`);
        prev = row?.hash ?? null;
      }
      return verifyAudit(tx);
    });
    expect(check.broken).toBeNull();
    expect(check.lastHash).not.toBe(seals[2]?.hash);
  });
});

describe("concurrency", () => {
  it("lets exactly one of two racing sealers make the seal", async () => {
    const h = await freshAudited("adv_seal2", ["create table t (id int primary key)"]);
    await h.db.execute(sql`insert into t values (1), (2), (3)`);
    const hold = postgres(dbUrl("adv_seal2"), { max: 1, onnotice: () => {} });
    try {
      await hold`select pg_advisory_lock(hashtext('wren audit seal'))`;
      const a = sealAudit(h.db);
      const b = sealAudit(h.db);
      await delay(500);
      await hold`select pg_advisory_unlock(hashtext('wren audit seal'))`;
      const results = await Promise.all([a, b]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(await verifyAudit(h.db)).toMatchObject({ seals: 1, unsealed: 0, broken: null });
    } finally {
      await hold.end({ timeout: 1 });
    }
  });

  it("seals cleanly under four concurrent writers", async () => {
    const h = await freshAudited(
      "adv_race",
      ["create table t (id int primary key, v int)"],
      "race",
    );
    let sealing = true;
    const loop = (async () => {
      while (sealing) {
        await sealAudit(h.db).catch(() => {});
        await delay(15);
      }
    })();
    const writers = Array.from({ length: 4 }, (_, w) =>
      (async () => {
        for (let i = 0; i < 30; i++) {
          const id = w * 1000 + i;
          try {
            await h.db.transaction(async (tx) => {
              await tx.execute(sql`insert into t values (${id}, ${i})`);
              if (i % 5 === 4) throw new Error("roll back");
            });
          } catch {
            /* rolled back on purpose */
          }
        }
      })(),
    );
    await Promise.all(writers);
    sealing = false;
    await loop;
    await sealAudit(h.db);
    const [n] = await h.db.execute<{ c: number }>(sql`select count(*)::int c from audit_events`);
    const check = await verifyAudit(h.db);
    expect(check.broken).toBeNull();
    expect(check.unsealed).toBe(0);
    expect(check.sealed).toBe(n?.c);
  }, 120_000);

  it("waits for a live writer before adding a trigger, then logs after commit", async () => {
    const h = await freshAudited("adv_busy", ["create table keep (id int primary key)"]);
    await h.db.execute(sql`create table busy (id int primary key)`);
    const raw = postgres(dbUrl("adv_busy"), { max: 1, onnotice: () => {} });
    const conn = await raw.reserve();
    try {
      await conn`begin`;
      await conn`insert into busy values (1)`;
      const install = installAudit(h.db);
      const settled = await Promise.race([
        install.then(() => "done"),
        delay(1000).then(() => "waiting"),
      ]);
      expect(settled).toBe("waiting");
      await conn`insert into keep values (1)`;
      await conn`insert into busy values (2)`;
      await conn`commit`;
      expect(await install).toMatchObject({ added: expect.any(Number) });
      await h.db.execute(sql`insert into busy values (3)`);
      expect((await events(h.db, "busy")).map((e) => e.op)).toEqual(["insert"]);
    } finally {
      conn.release();
      await raw.end({ timeout: 1 });
    }
  }, 120_000);

  it("runs two installs at once on a fresh database without doubling anything", async () => {
    await pg.db.execute(sql.raw("create database adv_fresh"));
    const h = createDb(dbUrl("adv_fresh"), { max: 4 });
    handles.push(h);
    await h.db.execute(sql`create table one (id int primary key)`);
    await Promise.all([installAudit(h.db), installAudit(h.db)]);
    const trig = await h.db.execute<{ t: string }>(
      sql`select tgname t from pg_trigger where tgrelid = 'one'::regclass and not tgisinternal order by tgname`,
    );
    expect(trig.map((t) => t.t)).toEqual(["audit_row", "audit_truncate"]);
    const guards = await h.db.execute<{ t: string; n: number }>(sql`
      select c.relname t, count(*)::int n from pg_trigger g join pg_class c on c.oid = g.tgrelid
      where g.tgname = 'append_only' group by c.relname order by c.relname`);
    expect(guards).toEqual([
      { t: "audit_eras", n: 1 },
      { t: "audit_events", n: 1 },
      { t: "audit_seals", n: 1 },
    ]);
  }, 120_000);

  it("holds the seal back for an open transaction in another database (cluster-wide horizon)", async () => {
    const h = await freshAudited("adv_horizon", ["create table t (id int primary key)"]);
    const other = postgres(dbUrl("postgres"), { max: 1, onnotice: () => {} });
    const conn = await other.reserve();
    try {
      await conn`begin`;
      await conn`select pg_current_xact_id()`;
      await h.db.execute(sql`insert into t values (1)`);
      expect(await sealAudit(h.db)).toBeNull();
      await conn`commit`;
      expect((await sealAudit(h.db))?.events).toBe(1);
    } finally {
      conn.release();
      await other.end({ timeout: 1 });
    }
  }, 120_000);
});

describe("a restored database whose tx counter has moved on", () => {
  // A restore onto another server: its transaction ids start again, far below
  // the old server's. The old server is simulated by an era of a made-up
  // cluster, with an event and a seal at a huge tx.
  it("still seals and verifies after a restore onto another server", async () => {
    const h = await freshAudited("adv_restored", ["create table r (id int primary key)"]);
    await h.db.execute(sql`alter table audit_events disable trigger append_only`);
    await h.db.execute(sql`alter table audit_seals disable trigger append_only`);
    try {
      const [old] = await h.db.execute<{ era: number }>(
        sql`insert into audit_eras (cluster, follows) values (42, 0) returning era`,
      );
      await h.db.execute(
        sql`insert into audit_events (era, tx, table_name, op, row_key) values (${old?.era}, 1000000000000, 'r', 'insert', '{"id":1}'::jsonb)`,
      );
      await h.db.execute(sql`
        insert into audit_seals (from_era, from_tx, through_era, through_tx, events, prev_hash, hash)
        select 0, 0, ${old?.era}, 1000000000001, count(*), null,
          sha256(coalesce(string_agg(audit_event_hash(e), ''::bytea order by e.era, e.tx, e.id), ''::bytea))
        from audit_events e`);
      // A second event from the old server, written after its last seal.
      await h.db.execute(
        sql`insert into audit_events (era, tx, table_name, op, row_key) values (${old?.era}, 1000000000002, 'r', 'insert', '{"id":9}'::jsonb)`,
      );
    } finally {
      await h.db.execute(sql`alter table audit_events enable trigger append_only`);
      await h.db.execute(sql`alter table audit_seals enable trigger append_only`);
    }
    expect(await verifyAudit(h.db)).toMatchObject({ broken: null, unsealed: 1 });
    await h.db.execute(sql`insert into r values (2)`);
    const [era] = await h.db.execute<{ n: number }>(sql`select count(*)::int n from audit_eras`);
    expect(era?.n).toBe(2);
    expect((await sealAudit(h.db))?.events).toBe(2);
    expect(await verifyAudit(h.db)).toMatchObject({ broken: null, unsealed: 0 });
  }, 120_000);
});
