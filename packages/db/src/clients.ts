/**
 * Client databases. Each client's data lives in its own database on the main
 * server, migrated from the same folder as main, and reached through its own
 * login: the role named like the database, which can open that database and no
 * other. The registry (`clients` table, owned by @wren/core) names them; this
 * file only knows how to reach, create, migrate and lock them, so @wren/db
 * stays a leaf.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { AUDIT_TABLES } from "./audit/index.js";
import { createDb, type Db, migrate } from "./index.js";

/** A client id: lowercase, starts with a letter, at most 40 characters. */
export const CLIENT_ID = /^[a-z][a-z0-9_]{0,39}$/;
/** A client database name, which is also its login's name. */
export const CLIENT_DATABASE = /^wren_client_[a-z][a-z0-9_]{0,39}$/;

/** `wren_client_<id>`. Refuses an id that is not a plain identifier. */
export function clientDatabaseName(id: string): string {
  if (!CLIENT_ID.test(id)) throw new Error(`client id ${JSON.stringify(id)}: use a-z, 0-9, _`);
  return `wren_client_${id}`;
}

function checkedDatabase(database: string): string {
  if (!CLIENT_DATABASE.test(database))
    throw new Error(`client database ${JSON.stringify(database)}: expected wren_client_<id>`);
  return database;
}

/**
 * The client login's password: derived from main's, never stored. Whoever holds
 * main's URL can already do anything, so this adds no secret; it only gives each
 * client database a login of its own. Main's password changes: the next migrate
 * sets every client's again. Main's URL must carry a password: without one there
 * is nothing secret to derive from.
 */
export function clientLoginPassword(mainUrl: string, database: string): string {
  const url = new URL(mainUrl);
  if (!url.password)
    throw new Error("main's database URL has no password; client logins derive theirs from it");
  return createHmac("sha256", decodeURIComponent(url.password))
    .update(`wren client login:${checkedDatabase(database)}`)
    .digest("hex");
}

/** The client's own login on its own database. Everything that reads or writes client data uses this. */
export function clientDatabaseUrl(mainUrl: string, database: string): string {
  const url = new URL(mainUrl);
  url.pathname = `/${checkedDatabase(database)}`;
  url.username = database;
  url.password = clientLoginPassword(mainUrl, database);
  // A URL without a host drops the user silently, and would connect as main.
  if (url.username !== database)
    throw new Error("main's database URL has no host; a client login needs one");
  return url.toString();
}

/** Main's login on a client database: for migrations and grants only. */
export function clientAdminUrl(mainUrl: string, database: string): string {
  const url = new URL(mainUrl);
  url.pathname = `/${checkedDatabase(database)}`;
  return url.toString();
}

/**
 * What Postgres stores for a SCRAM-SHA-256 password. Sent instead of the password
 * itself, so the plaintext never appears in SQL (or in a server log of it).
 */
export function scramVerifier(password: string, salt = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  const b64 = (b: Buffer) => b.toString("base64");
  return `SCRAM-SHA-256$${iterations}:${b64(salt)}$${b64(storedKey)}:${b64(serverKey)}`;
}

/** CREATE DATABASE unless it exists, closed to every other login at once. Runs on main; needs CREATEDB. */
export async function createDatabase(main: Db, database: string): Promise<boolean> {
  checkedDatabase(database);
  const found = await main.execute(sql`select 1 from pg_database where datname = ${database}`);
  if (found.length > 0) return false;
  await main.execute(sql.raw(`CREATE DATABASE "${database}"`));
  await main.execute(sql.raw(`REVOKE CONNECT, TEMPORARY ON DATABASE "${database}" FROM PUBLIC`));
  return true;
}

/** Every registered client database. Empty when the registry table is not there yet. */
export async function clientDatabases(main: Db): Promise<string[]> {
  const table = await main.execute<{ t: string | null }>(
    sql`select to_regclass('clients')::text t`,
  );
  if (!table[0]?.t) return [];
  const rows = await main.execute<{ database: string }>(
    sql`select database from clients order by id`,
  );
  return rows.map((r) => r.database);
}

/**
 * Make the client's login and give it its database, run on that database as
 * main. Idempotent; every migrate runs it, so new tables are granted too.
 * - The role: LOGIN and nothing else; it owns nothing, so it cannot alter a
 *   table or turn a trigger off. Its password is set again each time, and any
 *   setting it gave itself (`ALTER ROLE ... SET`) is cleared.
 * - PUBLIC may connect to no database; the role only to its own.
 * - Inside: read and write every table, draw from every sequence (never reset
 *   one); the audit tables are read-only and their sequences closed; the
 *   migrations table is readable (`wren db check`).
 */
export async function grantClientAccess(admin: Db, mainUrl: string, database: string) {
  const role = checkedDatabase(database);
  const verifier = scramVerifier(clientLoginPassword(mainUrl, database));
  const run = (text: string) => admin.execute(sql.raw(text));
  const found = await admin.execute(sql`select 1 from pg_roles where rolname = ${role}`);
  const attrs = "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS";
  if (found.length === 0) await run(`CREATE ROLE "${role}" ${attrs}`);
  await run(`ALTER ROLE "${role}" ${attrs} PASSWORD '${verifier}'`);
  const settings = await admin.execute<{ database: string | null }>(sql`
    select d.datname as database from pg_db_role_setting s
    left join pg_database d on d.oid = s.setdatabase
    where s.setrole = (select oid from pg_roles where rolname = ${role})`);
  for (const { database: on } of settings)
    await run(
      `ALTER ROLE "${role}"${on ? ` IN DATABASE "${on.replaceAll('"', '""')}"` : ""} RESET ALL`,
    );
  const databases = await admin.execute<{ name: string }>(
    sql`select datname as name from pg_database where datallowconn`,
  );
  for (const { name } of databases)
    await run(`REVOKE CONNECT, TEMPORARY ON DATABASE "${name.replaceAll('"', '""')}" FROM PUBLIC`);
  await run(`GRANT CONNECT ON DATABASE "${role}" TO "${role}"`);
  await run(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await run(
    `GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO "${role}"`,
  );
  // USAGE covers nextval; UPDATE would also allow setval, rewinding ids.
  await run(`REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM "${role}"`);
  await run(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);
  const log = AUDIT_TABLES.join(", ");
  await run(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ${log} FROM "${role}"`);
  const sequences = await admin.execute<{ name: string }>(sql`
    select pg_get_serial_sequence(a.attrelid::regclass::text, a.attname)::text as name
    from pg_attribute a
    where a.attrelid = any(${`{${log}}`}::regclass[]) and a.attidentity <> ''`);
  for (const { name } of sequences) await run(`REVOKE ALL ON SEQUENCE ${name} FROM "${role}"`);
  await run(`GRANT USAGE ON SCHEMA drizzle TO "${role}"`);
  await run(`GRANT SELECT ON drizzle.__drizzle_migrations TO "${role}"`);
}

/**
 * Apply the migrations to one client database as main, grant its login, then
 * prove the login opens it: a deploy that cannot reach a client fails here.
 */
export async function migrateClient(mainUrl: string, database: string): Promise<void> {
  const admin = createDb(clientAdminUrl(mainUrl, database), { max: 1, app: "wren-migrate" });
  try {
    await migrate(admin.db);
    await grantClientAccess(admin.db, mainUrl, database);
  } finally {
    await admin.close();
  }
  const own = createDb(clientDatabaseUrl(mainUrl, database), { max: 1, app: "wren-migrate" });
  try {
    await own.db.execute(sql`select 1`);
  } finally {
    await own.close();
  }
}
