import { PgTransaction } from "drizzle-orm/pg-core";
import type { Db, Queryable, Tx } from "./index.js";

/**
 * Every transaction names its isolation level through one of these
 * (designs/2026-10-04-postgres-isolation.md). Given an open transaction, each
 * runs `fn` in a savepoint on it: the outer level wins, and an error the caller
 * catches undoes only `fn`'s writes, as a nested `.transaction` always did.
 */

/** Level 2, read committed: claims with SKIP LOCKED, guarded updates, appends, bulk units. */
export function atomic<T>(db: Queryable, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (db instanceof PgTransaction) return (db as Tx).transaction(fn);
  return (db as Db).transaction(fn, { isolationLevel: "read committed" });
}

/** Level 3, repeatable read, read only: several reads that must agree. Never aborts, never blocks a writer. */
export function snapshot<T>(db: Queryable, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (db instanceof PgTransaction) return (db as Tx).transaction(fn);
  return (db as Db).transaction(fn, { isolationLevel: "repeatable read", accessMode: "read only" });
}

const RETRYABLE = new Set(["40001", "40P01"]);
const TRIES = 5;

/** Postgres's SQLSTATE, on the error or the cause drizzle wraps it in. */
export function sqlState(err: unknown): string | undefined {
  for (let e = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * Level 4, serializable: a read decides a write. Retries a serialization
 * failure or deadlock up to 5 tries, so `fn` holds database work only.
 */
export async function serializable<T>(db: Queryable, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (db instanceof PgTransaction) return (db as Tx).transaction(fn);
  for (let attempt = 1; ; attempt++) {
    try {
      return await (db as Db).transaction(fn, { isolationLevel: "serializable" });
    } catch (err) {
      const code = sqlState(err);
      if (!code || !RETRYABLE.has(code) || attempt >= TRIES) throw err;
      console.warn(`serializable: ${code} on try ${attempt}, retrying`);
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 190));
    }
  }
}
