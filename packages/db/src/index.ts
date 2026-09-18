import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export type Db = ReturnType<typeof drizzle>;
/** A transaction handle; has the same query API as `Db`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything a query can run on. Library code takes this so callers pick the transaction scope. */
export type Queryable = Db | Tx;

export interface DbHandle {
  db: Db;
  /** Close the pool. Call once at process exit. */
  close(): Promise<void>;
}

const MIGRATIONS_FOLDER = new URL("../drizzle", import.meta.url).pathname;

/**
 * One pool per process. `max` is small on purpose: the worker and CLI are the
 * only clients and Restate serializes writes per key already.
 */
export function createDb(databaseUrl: string, opts: { max?: number } = {}): DbHandle {
  const client = postgres(databaseUrl, { max: opts.max ?? 4, prepare: false });
  return { db: drizzle(client), close: () => client.end({ timeout: 5 }) };
}

/** Apply every migration in packages/db/drizzle. Idempotent. */
export async function migrate(db: Db): Promise<void> {
  await drizzleMigrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
