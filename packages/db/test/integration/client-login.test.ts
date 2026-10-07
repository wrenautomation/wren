/**
 * Each client database is reached through its own login, which can open that
 * database and no other, write its tables, read (never write) its audit log,
 * and change nothing about the schema or the triggers.
 */
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AUDIT_TABLES,
  clientAdminUrl,
  clientDatabaseName,
  clientDatabaseUrl,
  createDatabase,
  createDb,
  type DbHandle,
  migrateClient,
  sealAudit,
  verifyAudit,
} from "../../src/index.js";
import { startTestPostgres, type TestPostgres } from "../../src/testing.js";

const ACME = clientDatabaseName("acme");
const BETA = clientDatabaseName("beta");

let pg: TestPostgres;
let acme: DbHandle;

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

/** Connect with this URL and run one query; the error text when refused. */
async function tryLogin(url: string): Promise<string> {
  const client = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  try {
    await client`select 1`;
    return "ok";
  } catch (err) {
    return (err as Error).message;
  } finally {
    await client.end({ timeout: 1 });
  }
}

/** Acme's login and password, pointed at another database. */
function acmeAt(database: string): string {
  const url = new URL(clientDatabaseUrl(pg.url, ACME));
  url.pathname = `/${database}`;
  return url.toString();
}

beforeAll(async () => {
  pg = await startTestPostgres();
  for (const database of [ACME, BETA]) {
    await createDatabase(pg.db, database);
    await migrateClient(pg.url, database);
  }
  acme = createDb(clientDatabaseUrl(pg.url, ACME), { max: 1, app: "login-test" });
}, 180_000);
afterAll(async () => {
  await acme.close();
  await pg.stop();
});

describe("the login", () => {
  it("opens its own database as itself", async () => {
    const [who] = await acme.db.execute<{ u: string; d: string }>(
      sql`select current_user as u, current_database() as d`,
    );
    expect(who).toEqual({ u: ACME, d: ACME });
  });

  it("has no power beyond logging in", async () => {
    const [role] = await pg.db.execute(sql`
      select rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls, rolcanlogin
      from pg_roles where rolname = ${ACME}`);
    expect(role).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolinherit: false,
      rolreplication: false,
      rolbypassrls: false,
      rolcanlogin: true,
    });
  });

  it.each([
    ["another client's database", BETA],
    ["main", "test"],
    ["postgres", "postgres"],
    ["template1", "template1"],
  ])("cannot open %s", async (_what, database) => {
    expect(await tryLogin(acmeAt(database))).toMatch(/permission denied for database/);
  });

  it("may connect to its own database only", async () => {
    const rows = await pg.db.execute<{ d: string }>(sql`
      select datname as d from pg_database
      where datallowconn and has_database_privilege(${ACME}, datname, 'CONNECT')`);
    expect(rows.map((r) => r.d)).toEqual([ACME]);
  });

  it("refuses a wrong password, and one client's password as another", async () => {
    const wrong = new URL(clientDatabaseUrl(pg.url, ACME));
    wrong.password = "nope";
    expect(await tryLogin(wrong.toString())).toMatch(/password authentication failed/);
    const swapped = new URL(clientDatabaseUrl(pg.url, BETA));
    swapped.password = new URL(clientDatabaseUrl(pg.url, ACME)).password;
    expect(await tryLogin(swapped.toString())).toMatch(/password authentication failed/);
  });

  it("keeps working after another migrate", async () => {
    await migrateClient(pg.url, ACME);
    expect(await tryLogin(clientDatabaseUrl(pg.url, ACME))).toBe("ok");
    expect(await tryLogin(clientAdminUrl(pg.url, ACME))).toBe("ok");
  });

  it("refuses a database name that is not a client's", () => {
    expect(() => clientDatabaseUrl(pg.url, "test")).toThrow(/expected wren_client_<id>/);
    expect(() => clientDatabaseUrl(pg.url, 'wren_client_x"; drop')).toThrow(/expected/);
  });
});

describe("inside its database", () => {
  it("may read and write every table but the audit log, which it may only read", async () => {
    const client = postgres(clientAdminUrl(pg.url, ACME), { max: 1 });
    try {
      const inside = await client<{ t: string; r: boolean; w: boolean }[]>`
        select tablename as t,
          has_table_privilege(${ACME}, format('%I.%I', schemaname, tablename), 'SELECT') as r,
          has_table_privilege(${ACME}, format('%I.%I', schemaname, tablename), 'INSERT') as w
        from pg_tables where schemaname = 'public'`;
      expect(inside.length).toBeGreaterThan(40);
      for (const row of inside) {
        const log = (AUDIT_TABLES as readonly string[]).includes(row.t);
        expect({ t: row.t, r: row.r, w: row.w }).toEqual({ t: row.t, r: true, w: !log });
      }
    } finally {
      await client.end();
    }
  });

  it("may read and write its calendar's and mail's tables, never Wren's own schemas", async () => {
    const client = postgres(clientAdminUrl(pg.url, ACME), { max: 1 });
    try {
      const rows = await client<{ s: string; t: string; w: boolean }[]>`
        select schemaname as s, tablename as t,
          has_table_privilege(${ACME}, format('%I.%I', schemaname, tablename), 'SELECT, INSERT') as w
        from pg_tables where schemaname in ('calendar', 'auth', 'books', 'watch')`;
      expect(rows.some((r) => r.s === "calendar")).toBe(true);
      expect(rows.some((r) => r.s === "watch")).toBe(true);
      for (const r of rows)
        expect({ t: `${r.s}.${r.t}`, w: r.w }).toEqual({
          t: `${r.s}.${r.t}`,
          w: r.s === "calendar" || r.s === "watch",
        });
    } finally {
      await client.end();
    }
    await acme.db.execute(sql`insert into calendar.bookings (calendar, start, "end", name, email, zone)
      values ('acme', now() + interval '1 day', now() + interval '1 day 30 minutes', 'Ann', 'a@x.test', 'UTC')`);
    const [n] = await acme.db.execute<{ n: number }>(
      sql`select count(*)::int n from calendar.booking_records`,
    );
    expect(n?.n).toBe(1);
  });

  it("has no grant on main's tables", async () => {
    const rows = await pg.db.execute<{ t: string }>(sql`
      select tablename as t from pg_tables where schemaname = 'public'
        and has_table_privilege(${ACME}, format('%I.%I', schemaname, tablename), 'SELECT, INSERT')`);
    expect(rows).toEqual([]);
  });

  it("writes, and its writes are logged as its own", async () => {
    await acme.db.execute(
      sql`insert into clients (id, name, database) values ('x', 'X', 'wren_client_x')`,
    );
    await acme.db.execute(sql`update clients set name = 'Y' where id = 'x'`);
    const events = await acme.db.execute<{ op: string; db_user: string; app: string }>(
      sql`select op, db_user, app from audit_events where table_name = 'clients' order by id`,
    );
    expect(events).toEqual([
      { op: "insert", db_user: ACME, app: "login-test" },
      { op: "update", db_user: ACME, app: "login-test" },
    ]);
  });

  it.each([
    ["insert an event", sql`insert into audit_events (table_name, op) values ('x', 'insert')`],
    ["update an event", sql`update audit_events set actor = 'x'`],
    ["delete events", sql`delete from audit_events`],
    ["truncate the log", sql`truncate audit_events`],
    [
      "forge a seal",
      sql`insert into audit_seals (from_tx, through_tx, events, hash) values (0, 1, 0, '\\x00')`,
    ],
    ["move the log's ids", sql`select setval('audit_events_id_seq', 1)`],
    ["burn the log's ids", sql`select nextval('audit_events_id_seq')`],
  ])("cannot %s", async (_what, statement) => {
    expect(await refusal(acme.db.execute(statement))).toMatch(/permission denied/);
  });

  it.each([
    ["turn a trigger off", sql`alter table clients disable trigger audit_row`, /must be owner/],
    ["drop a trigger", sql`drop trigger audit_row on clients`, /must be owner/],
    ["alter a table", sql`alter table clients add column z int`, /must be owner/],
    [
      "replace the trigger function",
      sql`create or replace function audit_row() returns trigger language plpgsql as $$ begin return null; end $$`,
      /must be owner|permission denied/,
    ],
    ["create a table", sql`create table mine (x int)`, /permission denied for schema public/],
    [
      "create a temp table",
      sql`create temp table mine (x int)`,
      /permission denied to create temporary tables/,
    ],
    [
      "skip triggers",
      sql`set session_replication_role = replica`,
      /permission denied to set parameter/,
    ],
    [
      "restart a table's ids",
      sql`truncate imports restart identity cascade`,
      /must be owner of sequence/,
    ],
  ])("cannot %s", async (_what, statement, why) => {
    expect(await refusal(acme.db.execute(statement))).toMatch(why);
  });

  it("truncates a table, keeping the ids going", async () => {
    await acme.db.execute(
      sql`insert into imports (source_type, source_ref, stats) values ('csv', 'a.csv', '{}')`,
    );
    await acme.db.execute(sql`truncate imports cascade`);
    const [row] = await acme.db.execute<{ n: number }>(sql`select count(*)::int n from imports`);
    expect(row?.n).toBe(0);
  });

  it("reads the migrations table", async () => {
    const [row] = await acme.db.execute<{ n: number }>(
      sql`select count(*)::int n from drizzle.__drizzle_migrations`,
    );
    expect(row?.n).toBeGreaterThan(20);
  });

  it("seals and verifies its own log", async () => {
    const seal = await sealAudit(acme.db);
    expect(seal?.events).toBeGreaterThan(0);
    expect(await verifyAudit(acme.db)).toMatchObject({ seals: 1, unsealed: 0, broken: null });
  });
});
