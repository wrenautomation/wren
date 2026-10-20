import { randomBytes } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { createDb, type DbHandle, migrate } from "./index.js";

export interface TestPostgres extends DbHandle {
  url: string;
  stop(): Promise<void>;
}

export interface TestPostgresOptions {
  /** Ask for a Postgres of your own, not a database on the run's shared one. A file needs this when
   *  it changes anything the whole server shares: roles, other databases, server settings, or a
   *  client database (`addClient`, `createDatabase`), whose names are fixed. */
  own?: boolean;
}

declare module "vitest" {
  export interface ProvidedContext {
    /** Admin URL of the run's shared Postgres. Set by `@wren/db/testing/global-setup`. */
    wrenTestPg: string;
  }
}

interface Configurable<C> {
  withAutoRemove(on: boolean): C;
  withEntrypoint(entrypoint: string[]): C;
  withCommand(command: string[]): C;
}

/** A test container that cannot be left behind. Ryuk removes it when the test process dies, but
 *  Ryuk dies too when the Docker VM is starved or restarted. So Docker deletes the container and
 *  its volumes the moment it exits, and it kills itself after `lifetime` (30 minutes unless a
 *  caller says more). `entrypoint` and `command` are the image's own, since the lifetime runs in
 *  front of them. */
export function selfRemoving<C extends Configurable<C>>(
  container: C,
  entrypoint: string[],
  command: string[] = [],
  lifetime = "30m",
): C {
  (container as unknown as { hostConfig: { AutoRemove?: boolean } }).hostConfig.AutoRemove = true;
  return container
    .withAutoRemove(false) // Docker removes it; a second remove from testcontainers would throw
    .withEntrypoint(["timeout", "-s", "KILL", lifetime, ...entrypoint])
    .withCommand(command);
}

/** Postgres that never waits on a disk: a throwaway test database needs no crash safety, and
 *  initdb plus every migration flushing to disk is most of a start on a loaded machine. */
const NO_DISK_WAITS = ["fsync=off", "synchronous_commit=off", "full_page_writes=off"].flatMap(
  (c) => ["-c", c],
);

/** Start an empty Postgres 17 in Docker. CI pulls it from a mirror (`WREN_TEST_PG_IMAGE`): Docker
 *  Hub limits anonymous pulls per runner IP. Its data lives in memory and is never synced. */
export function startPostgresContainer(
  maxConnections?: number,
  lifetime?: string,
): Promise<StartedPostgreSqlContainer> {
  return selfRemoving(
    new PostgreSqlContainer(process.env.WREN_TEST_PG_IMAGE ?? "postgres:17")
      .withTmpFs({ "/var/lib/postgresql/data": "rw" })
      .withEnvironment({ POSTGRES_INITDB_ARGS: "--no-sync" }),
    ["docker-entrypoint.sh"],
    [
      "postgres",
      ...NO_DISK_WAITS,
      ...(maxConnections ? ["-c", `max_connections=${maxConnections}`] : []),
    ],
    lifetime,
  ).start();
}

/** The database every test database is cloned from, migrated once per run. */
export const TEMPLATE_DATABASE = "wren_template";

/** The same server URL, pointed at another database. */
function urlFor(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Run statements on the server's admin database, one short connection. */
async function asAdmin<T>(adminUrl: string, run: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    return await run(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Create `wren_template` on an empty server, migrate it, then close it to everyone. A clone needs
 *  the template idle, so every connection is shut before it is marked a template. */
export async function migrateTemplate(adminUrl: string): Promise<void> {
  await asAdmin(adminUrl, (sql) => sql.unsafe(`CREATE DATABASE ${TEMPLATE_DATABASE}`));
  const handle = createDb(urlFor(adminUrl, TEMPLATE_DATABASE), { max: 2 });
  try {
    await migrate(handle.db);
  } finally {
    await handle.close();
  }
  await asAdmin(adminUrl, (sql) =>
    sql.unsafe(`ALTER DATABASE ${TEMPLATE_DATABASE} WITH IS_TEMPLATE true ALLOW_CONNECTIONS false`),
  );
}

/** The run's shared server, or undefined outside the shared vitest config (a script, a file run
 *  with another config). Vitest is imported here so a script never loads it. */
async function sharedServer(): Promise<string | undefined> {
  try {
    const { inject } = await import("vitest");
    return inject("wrenTestPg");
  } catch {
    return undefined;
  }
}

/** A new database cloned from the template on the shared server. */
async function cloneOnShared(adminUrl: string): Promise<TestPostgres> {
  const name = `t_${randomBytes(8).toString("hex")}`;
  await asAdmin(adminUrl, (sql) =>
    sql.unsafe(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DATABASE}`),
  );
  const url = urlFor(adminUrl, name);
  const handle = createDb(url, { max: 2 });
  return {
    ...handle,
    url,
    stop: async () => {
      await handle.close();
      await asAdmin(adminUrl, (sql) => sql.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
    },
  };
}

/** A container of its own, migrated: one start per call. */
async function startOwn(): Promise<TestPostgres> {
  const container = await startPostgresContainer();
  const url = container.getConnectionUri();
  const handle = createDb(url, { max: 2 });
  await migrate(handle.db);
  return {
    ...handle,
    url,
    stop: async () => {
      await handle.close();
      await container.stop();
    },
  };
}

/** A migrated, empty Postgres for one test file. Under the shared vitest config
 *  (`@wren/db/testing/vitest`) it is a clone of the run's template database, on the run's one
 *  server. Outside it, or with `{ own: true }`, it is a container of its own. */
export async function startTestPostgres(options: TestPostgresOptions = {}): Promise<TestPostgres> {
  const shared = options.own ? undefined : await sharedServer();
  return shared ? cloneOnShared(shared) : startOwn();
}

/** Delete every row in the given tables, children first. Cheaper than a new container per test. */
export async function truncate(db: DbHandle["db"], tables: string[]): Promise<void> {
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t}"`).join(", ");
  await db.execute(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

/** An object a test row names. A row that names a post or comment needs this first (its foreign key). */
export interface SeedObject {
  platform: string;
  ref: string;
  kind: "post" | "comment" | "group";
  post?: string | null;
}

/** `platform_objects` rows for rows a test writes straight to a table. Skips one already there. */
export async function seedObjects(
  db: DbHandle["db"],
  objects: readonly SeedObject[],
): Promise<void> {
  const seen = new Set<string>();
  const rows = objects.filter((o) => {
    const key = `${o.platform}\u0000${o.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!rows.length) return;
  await db.execute(sql`INSERT INTO platform_objects (platform, ref, kind, post)
    SELECT x.platform, x.ref, x.kind, x.post
    FROM jsonb_to_recordset(${JSON.stringify(rows.map((o) => ({ ...o, post: o.post ?? null })))}::jsonb)
      AS x(platform text, ref text, kind text, post text)
    ON CONFLICT DO NOTHING`);
}

/** The objects a `comments` row names: its post, itself, a parent comment and its answer. */
export function commentObjects(
  rows: ReadonlyArray<{
    platform: string;
    ref: string;
    post: string;
    parent?: string | null | undefined;
    answerRef?: string | null | undefined;
  }>,
): SeedObject[] {
  return rows.flatMap((c) => [
    { platform: c.platform, ref: c.post, kind: "post" as const },
    { platform: c.platform, ref: c.ref, kind: "comment" as const, post: c.post },
    ...(c.parent && c.parent !== c.post
      ? [{ platform: c.platform, ref: c.parent, kind: "comment" as const, post: c.post }]
      : []),
    ...(c.answerRef
      ? [{ platform: c.platform, ref: c.answerRef, kind: "comment" as const, post: c.post }]
      : []),
  ]);
}

/** The objects a list of our published posts names, by platform and published id. */
export function postObjects(
  rows: ReadonlyArray<{ platform: string; publishedId?: string | null | undefined }>,
): SeedObject[] {
  return rows.flatMap((d) =>
    d.publishedId ? [{ platform: d.platform, ref: d.publishedId, kind: "post" as const }] : [],
  );
}
