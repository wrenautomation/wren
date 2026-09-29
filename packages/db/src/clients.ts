/**
 * Client databases. Each client's data lives in its own database on the main
 * server, migrated from the same folder as main. The registry (`clients` table,
 * owned by @wren/core) names them; this file only knows how to reach, create and
 * migrate them, so @wren/db stays a leaf.
 */
import { sql } from "drizzle-orm";
import { createDb, type Db, migrate } from "./index.js";

/** A client id: lowercase, starts with a letter, at most 40 characters. */
export const CLIENT_ID = /^[a-z][a-z0-9_]{0,39}$/;

/** `wren_client_<id>`. Refuses an id that is not a plain identifier. */
export function clientDatabaseName(id: string): string {
  if (!CLIENT_ID.test(id)) throw new Error(`client id ${JSON.stringify(id)}: use a-z, 0-9, _`);
  return `wren_client_${id}`;
}

/** Main's URL with the database swapped. Same host, same login, no new secret. */
export function clientDatabaseUrl(mainUrl: string, database: string): string {
  const url = new URL(mainUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/** CREATE DATABASE unless it exists. Runs on main; needs CREATEDB. */
export async function createDatabase(main: Db, database: string): Promise<boolean> {
  const found = await main.execute(sql`select 1 from pg_database where datname = ${database}`);
  if (found.length > 0) return false;
  await main.execute(sql.raw(`CREATE DATABASE "${database}"`));
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

/** Apply the migrations to one client database. */
export async function migrateClient(mainUrl: string, database: string): Promise<void> {
  const handle = createDb(clientDatabaseUrl(mainUrl, database), { max: 1 });
  try {
    await migrate(handle.db);
  } finally {
    await handle.close();
  }
}
