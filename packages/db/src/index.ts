import { existsSync } from "node:fs";
import { MIGRATIONS as AERIE, migrateAerie } from "@wrenautomation/aerie/migrations";
import { MIGRATIONS as VIREO } from "@wrenautomation/vireo/migrations";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { installAudit } from "./audit/index.js";

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
// bundled (Lambda, box): build-lambda copies vireo's SQL beside ours; else the package's own
const VIREO_BUNDLED = new URL("../vireo-drizzle", import.meta.url).pathname;
const VIREO_FOLDER = existsSync(VIREO_BUNDLED) ? VIREO_BUNDLED : VIREO.migrationsFolder;
// Aerie's too (`aerie-drizzle`)
const AERIE_BUNDLED = new URL("../aerie-drizzle", import.meta.url).pathname;
const AERIE_FOLDER = existsSync(AERIE_BUNDLED) ? AERIE_BUNDLED : AERIE.migrationsFolder;

interface DbOptions {
  max?: number;
  idleSeconds?: number;
  /** The connection's application_name, kept on every audit event: `wren-worker`, `wren-cli:<command>`. */
  app?: string;
  /** Who is acting, kept on every audit event (`wren.actor`); a transaction may set its own. */
  actor?: string;
  /** The agent chat and turn behind the writes (`wren.chat`, `wren.turn`): designs/2026-11-11-agent-panel.md. */
  chat?: string | undefined;
  turn?: string | undefined;
}

/**
 * One pool per process. `max` is small on purpose: the worker and CLI are the
 * only clients and Restate serializes writes per key already.
 */
export function createDb(databaseUrl: string, opts: DbOptions = {}): DbHandle {
  // postgres.js lets a URL's application_name win over `connection`; the caller's app is the audited one.
  const url = opts.app
    ? databaseUrl.replace(/([?&])application_name=[^&]*(&|$)/, (_, sep, end) => (end ? sep : ""))
    : databaseUrl;
  // A process killed mid-transaction (a Lambda timeout) frees its locks within 10 min, not when TCP notices.
  // ponytail: 10 min because research stage units hold their transaction across a fetch or an LLM
  // call (claude-code waits up to 5 min); move that I/O out of the transaction, then drop to 2 min.
  const connection: Record<string, string> = { idle_in_transaction_session_timeout: "10min" };
  // Postgres keeps 63 bytes of a name; cut here so the stored one is predictable.
  if (opts.app) connection.application_name = opts.app.slice(0, 63);
  if (opts.actor) connection["wren.actor"] = opts.actor;
  if (opts.chat) connection["wren.chat"] = opts.chat;
  if (opts.turn) connection["wren.turn"] = opts.turn;
  const client = postgres(url, {
    max: opts.max ?? 4,
    prepare: false,
    onnotice: () => {},
    ...(opts.idleSeconds ? { idle_timeout: opts.idleSeconds } : {}),
    connection,
  });
  return { db: drizzle(client), close: () => client.end({ timeout: 5 }) };
}

const cached = new Map<string, DbHandle>();

/**
 * One pool per database for the life of the process: two connections at most,
 * each closed after a quiet minute, so a client nobody is touching holds none.
 * For processes that serve many client databases (worker, portal API).
 */
export function cachedDb(databaseUrl: string, opts: Pick<DbOptions, "app"> = {}): Db {
  const id = `${opts.app ?? ""} ${databaseUrl}`;
  let handle = cached.get(id);
  if (!handle) {
    handle = createDb(databaseUrl, { max: 2, idleSeconds: 60, ...opts });
    cached.set(id, handle);
  }
  return handle.db;
}

/** Apply every migration in packages/db/drizzle, then the audit layer (triggers follow the tables). Idempotent. */
export async function migrate(db: Db): Promise<void> {
  // vireo (variants) keeps its own journal; first, since folders.filed points at vireo.subjects
  await drizzleMigrate(db, { ...VIREO, migrationsFolder: VIREO_FOLDER });
  // Aerie keeps its own journal; as role `aerie` where it exists, so the Mac's aerie login keeps its tables
  await migrateAerie(db, { role: "aerie", folder: AERIE_FOLDER });
  await drizzleMigrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  await installAudit(db);
}

export * from "./audit/index.js";
export * from "./clients.js";
export * from "./isolation.js";
export * from "./listen.js";
