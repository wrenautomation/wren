/**
 * Adversarial cover for the per-client login: it must not escape its database,
 * touch the schema or the log, read server files, signal other backends, or
 * carry settings across a migrate. Tests marked "BUG" assert how the code
 * should behave, so they fail now and pass once the source is fixed. Tests
 * marked "leak" record what a login can legitimately see (design notes).
 */
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientAdminUrl,
  clientDatabaseName,
  clientDatabaseUrl,
  clientLoginPassword,
  createDatabase,
  createDb,
  type DbHandle,
  migrateClient,
  scramVerifier,
} from "../../src/index.js";
import { startTestPostgres, type TestPostgres } from "../../src/testing.js";

const ACME = clientDatabaseName("acme");
const BETA = clientDatabaseName("beta");

let pg: TestPostgres;
let acme: DbHandle;

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : String((err as Error).message ?? err);
  }
  throw new Error("expected a refusal");
}

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

/** Run one statement as the acme login on a fresh connection; return the error, or "ok". */
async function asAcme(text: string): Promise<string> {
  const c = postgres(clientDatabaseUrl(pg.url, ACME), { max: 1, onnotice: () => {} });
  try {
    await c.unsafe(text);
    return "ok";
  } catch (err) {
    return (err as Error).message;
  } finally {
    await c.end({ timeout: 1 });
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  pg = await startTestPostgres();
  for (const database of [ACME, BETA]) {
    await createDatabase(pg.db, database);
    await migrateClient(pg.url, database);
  }
  acme = createDb(clientDatabaseUrl(pg.url, ACME), { max: 2, app: "login-adv" });
}, 180_000);
afterAll(async () => {
  await acme.close();
  await pg.stop();
});

describe("escapes that must all be refused", () => {
  it.each([
    [
      "set role to superuser",
      "set role test",
      /permission denied to set role|must be (a member|able)/i,
    ],
    [
      "set session authorization",
      "set session authorization test",
      /permission denied|must be superuser/i,
    ],
    [
      "create a function",
      "create function public.adv_f() returns int language sql as 'select 1'",
      /permission denied for schema public/,
    ],
    ["create a table", "create table public.adv_x (x int)", /permission denied for schema public/],
    ["create a schema", "create schema advs", /permission denied for database/],
    ["create extension dblink", "create extension dblink", /permission denied|must be superuser/i],
    [
      "create extension pgcrypto",
      "create extension pgcrypto",
      /permission denied|must be superuser/i,
    ],
    [
      "copy to a program",
      "copy (select 1) to program 'id'",
      /must be superuser|pg_execute_server_program|permission denied/i,
    ],
    [
      "copy to a file",
      "copy (select 1) to '/tmp/adv.out'",
      /must be superuser|pg_write_server_files|permission denied/i,
    ],
    [
      "read a server file",
      "select pg_read_file('/etc/hostname')",
      /permission denied for function|must be superuser|pg_read_server_files/i,
    ],
    [
      "large-object import",
      "select lo_import('/etc/hostname')",
      /permission denied|must be superuser|pg_read_server_files/i,
    ],
    [
      "list a server directory",
      "select pg_ls_dir('.')",
      /permission denied for function|must be superuser|pg_read_server_files/i,
    ],
    [
      "alter default privileges",
      "alter default privileges for role test grant select on tables to test",
      /permission denied|must be a member/i,
    ],
    ["read pg_authid", "select * from pg_authid", /permission denied for (table|view) pg_authid/],
    ["read pg_shadow", "select * from pg_shadow", /permission denied for (table|view) pg_shadow/],
    [
      "write the migrations table",
      "insert into drizzle.__drizzle_migrations (hash, created_at) values ('x', 1)",
      /permission denied for table __drizzle_migrations/,
    ],
    [
      "wipe the migrations table",
      "delete from drizzle.__drizzle_migrations",
      /permission denied for table __drizzle_migrations/,
    ],
    [
      "forge a trigger on a real table",
      "create trigger adv_forged before insert on suppressions for each row execute function audit_row()",
      /permission denied|must be owner/i,
    ],
    [
      "turn a real table's audit off",
      "alter table suppressions disable trigger audit_row",
      /must be owner of (relation|table) suppressions/,
    ],
    [
      "create a temp table",
      "create temp table adv_tmp (x int)",
      /permission denied to create temporary tables/,
    ],
    [
      "restart a sequence",
      "alter sequence companies_id_seq restart",
      /must be owner of (relation|sequence) companies_id_seq/,
    ],
    [
      "truncate with restart identity",
      "truncate companies restart identity cascade",
      /must be owner of sequence/,
    ],
    [
      "signal another role's backend",
      "select pg_terminate_backend(pid) from pg_stat_activity where usename = 'test' and pid <> pg_backend_pid() limit 1",
      /permission denied|must be (a superuser|a member)/i,
    ],
    [
      "alter system",
      "alter system set work_mem = '1MB'",
      /permission denied|must be superuser|ALTER SYSTEM/i,
    ],
    [
      "skip triggers",
      "set session_replication_role = replica",
      /permission denied to set parameter/,
    ],
    [
      "change another role's password",
      `alter role ${BETA} password 'x'`,
      /permission denied|must have/i,
    ],
    [
      "grant itself createdb",
      "alter role current_user createdb",
      /permission denied|must have|superuser/i,
    ],
    ["create a database", "create database adv_db", /permission denied to create database/],
    ["create a role", "create role adv_role", /permission denied to create role/],
    [
      "publish every table",
      "create publication adv_pub for all tables",
      /permission denied|must be superuser/i,
    ],
    [
      "lock the read-only log",
      "do $$ begin lock table audit_events in access exclusive mode; end $$",
      /permission denied for (table|relation) audit_events/,
    ],
  ])("cannot %s", async (_what, text, why) => {
    expect(await asAcme(text)).toMatch(why);
  });

  it.each([
    ["audit_row", "select audit_row()"],
    ["audit_append_only", "select audit_append_only()"],
  ])("cannot call %s directly", async (_what, text) => {
    expect(await asAcme(text)).toMatch(/can only be called as triggers|permission denied/);
  });
});

describe("what its writes leave", () => {
  it("logs an ON DELETE CASCADE as the client login, even on tables added later", async () => {
    const admin = createDb(clientAdminUrl(pg.url, ACME), { max: 1, app: "wren-migrate" });
    try {
      await admin.db.execute(sql`create table adv_p (id int primary key, name text)`);
      await admin.db.execute(
        sql`create table adv_c (id int primary key, p int references adv_p on delete cascade, note text)`,
      );
    } finally {
      await admin.close();
    }
    await migrateClient(pg.url, ACME);
    await acme.db.execute(sql`insert into adv_p values (1, 'p')`);
    await acme.db.execute(sql`insert into adv_c values (10, 1, 'c')`);
    await acme.db.execute(sql`delete from adv_p where id = 1`);
    const evs = await acme.db.execute<{ t: string; op: string; u: string }>(sql`
      select table_name t, op, db_user u from audit_events
      where table_name in ('adv_p', 'adv_c') and op = 'delete' order by table_name`);
    expect(evs).toEqual([
      { t: "adv_c", op: "delete", u: ACME },
      { t: "adv_p", op: "delete", u: ACME },
    ]);
  });

  // BUG: sequences are granted UPDATE, which lets a client reset one with
  // setval; the design says a client cannot reset a sequence (clients.ts line 123).
  it("cannot reset a sequence, but can still draw from it", async () => {
    expect(
      await refusal(acme.db.execute(sql`select setval('companies_id_seq', 1, false)`)),
    ).toMatch(/permission denied/);
    const [n] = await acme.db.execute<{ v: number }>(
      sql`select nextval('companies_id_seq')::float8 v`,
    );
    expect(n?.v).toBeGreaterThan(0);
  });

  it("leak: app and actor are the connection's word; db_user is the true login", async () => {
    const forge = createDb(clientDatabaseUrl(pg.url, ACME), {
      max: 1,
      app: "wren-migrate",
      actor: "owner@acme.example",
    });
    try {
      await forge.db.execute(
        sql`insert into suppressions (kind, value, reason) values ('email', 'forge@x.example', 'manual')`,
      );
    } finally {
      await forge.close();
    }
    const [e] = await acme.db.execute<{ app: string; actor: string; u: string }>(sql`
      select app, actor, db_user u from audit_events
      where table_name = 'suppressions' order by id desc limit 1`);
    expect(e).toEqual({ app: "wren-migrate", actor: "owner@acme.example", u: ACME });
  });
});

describe("role settings must not cross a migrate", () => {
  // BUG: grantClientAccess resets the password but not the role's own settings.
  // A client can ALTER ROLE current_user SET ... and it survives the next
  // migrate (clients.ts grantClientAccess, line 112 has no RESET ALL).
  it("clears a login's own ALTER ROLE settings on the next migrate", async () => {
    const beta = postgres(clientDatabaseUrl(pg.url, BETA), { max: 1, onnotice: () => {} });
    try {
      await beta.unsafe(
        `alter role current_user set default_transaction_isolation = 'repeatable read'`,
      );
      await beta.unsafe(
        `alter role current_user in database "${BETA}" set default_transaction_read_only = on`,
      );
      // Placeholder GUCs may or may not be settable this way; either is fine here.
      try {
        await beta.unsafe(`alter role current_user set "wren.actor" = 'forged'`);
      } catch {
        /* refused is acceptable */
      }
    } finally {
      await beta.end({ timeout: 1 });
    }
    try {
      await migrateClient(pg.url, BETA);
      const settings = await pg.db.execute(sql`
        select s.setconfig from pg_db_role_setting s
        join pg_roles r on r.oid = s.setrole where r.rolname = ${BETA}`);
      expect(settings).toEqual([]);
    } finally {
      await pg.db.execute(sql.raw(`alter role "${BETA}" reset all`));
      await pg.db.execute(sql.raw(`alter role "${BETA}" in database "${BETA}" reset all`));
    }
  });
});

describe("what a login can legitimately see (design notes)", () => {
  it("leak: sees every database's and role's name", async () => {
    const dbs = await acme.db.execute<{ d: string }>(sql`select datname d from pg_database`);
    expect(dbs.map((r) => r.d)).toContain(BETA);
    const roles = await acme.db.execute<{ r: string }>(sql`select rolname r from pg_roles`);
    expect(roles.map((x) => x.r)).toContain(BETA);
  });

  it("leak: sees other backends' database and user, but not their query text", async () => {
    const sleeper = pg.db.execute(sql`select pg_sleep(1), 'adv-secret-marker' as m`);
    try {
      await delay(200);
      const rows = await acme.db.execute<{ query: string; usename: string; datname: string }>(sql`
        select query, usename, datname from pg_stat_activity
        where usename = 'test' and datname = 'test' and pid <> pg_backend_pid()`);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.query.includes("adv-secret-marker"))).toBe(false);
      expect(rows.every((r) => r.query === "<insufficient privilege>")).toBe(true);
      expect(rows.every((r) => r.usename === "test")).toBe(true);
    } finally {
      await sleeper;
    }
  });

  it("leak: can lock its own writable table in ACCESS EXCLUSIVE (a migrate-time stall)", async () => {
    await acme.db.transaction(async (tx) => {
      await tx.execute(sql`lock table suppressions in access exclusive mode`);
    });
  });
});

describe("the URL the login is built from", () => {
  it("keeps the host, port and query of main's URL", () => {
    const built = clientDatabaseUrl(
      "postgresql://test:test@db.example:5433/test?sslmode=require",
      ACME,
    );
    const u = new URL(built);
    expect(u.username).toBe(ACME);
    expect(u.hostname).toBe("db.example");
    expect(u.port).toBe("5433");
    expect(u.searchParams.get("sslmode")).toBe("require");
    expect(u.pathname).toBe(`/${ACME}`);
  });

  it("keeps an IPv6 host and port", () => {
    const u = new URL(clientDatabaseUrl("postgresql://test:test@[::1]:6543/test", ACME));
    expect(u.hostname).toBe("[::1]");
    expect(u.port).toBe("6543");
    expect(u.username).toBe(ACME);
  });

  it("keeps a multi-host URL's hosts", () => {
    const built = clientDatabaseUrl("postgresql://test:test@h1,h2:5432/test", ACME);
    expect(built).toContain("h1,h2");
  });

  it("works end to end with a special-character main password", async () => {
    const pw = `p@:/?#&+ é'"\\x%`;
    await pg.db.execute(
      sql.raw(`create role adv_main superuser login password '${scramVerifier(pw)}'`),
    );
    const base = new URL(pg.url);
    const advMainUrl = `postgresql://adv_main:${encodeURIComponent(pw)}@${base.host}/${base.pathname.slice(1)}`;
    const SPECIAL = clientDatabaseName("special");
    await createDatabase(pg.db, SPECIAL);
    await migrateClient(advMainUrl, SPECIAL);
    expect(await tryLogin(clientDatabaseUrl(advMainUrl, SPECIAL))).toBe("ok");
    // The client login's password is keyed on main's password: migrate under a
    // different main password, and only that main's derived URL still opens it.
    await migrateClient(pg.url, SPECIAL);
    expect(await tryLogin(clientDatabaseUrl(pg.url, SPECIAL))).toBe("ok");
    expect(await tryLogin(clientDatabaseUrl(advMainUrl, SPECIAL))).toMatch(
      /password authentication failed/,
    );
  });

  // BUG (latent): with no password in main's URL, the HMAC is keyed on the URL
  // string itself, so the client password is derivable from the URL and may
  // not match what postgres.js sends (from PGPASSWORD). It should refuse
  // (clients.ts clientLoginPassword, line 38).
  it("refuses to derive a login from a passwordless main URL", () => {
    const noPw = new URL(pg.url);
    noPw.password = "";
    expect(() => clientLoginPassword(noPw.toString(), ACME)).toThrow();
  });

  // A host-less main URL drops the user silently (the URL setters ignore it), so
  // the built URL would connect as main via env vars: refused instead.
  it("refuses a host-less main URL rather than connect as main", () => {
    expect(() => clientDatabaseUrl("postgresql://:pw@/test", ACME)).toThrow();
    expect(() => clientDatabaseUrl("postgresql:///test", ACME)).toThrow();
  });
});
