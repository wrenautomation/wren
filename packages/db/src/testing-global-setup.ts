/**
 * Vitest global setup for an integration run: one Postgres for the whole run, not one per test
 * file. It migrates a template database once; each file then clones it (`startTestPostgres`).
 * Files run side by side on this server, so a file that changes anything the whole server shares
 * asks for a server of its own: `startTestPostgres({ own: true })`.
 */
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import type { TestProject } from "vitest/node";
import { migrateTemplate, startPostgresContainer, TEMPLATE_DATABASE } from "./testing.js";

/** Files at once (`--maxWorkers`) times the connections one file holds open. A full run peaked at
 *  6 connections on one server with 4 files at once (sampled every 5 s). 200 fits 12 files with 16 connections each;
 *  idle slots cost almost no memory, and a file that runs out of them fails. */
const MAX_CONNECTIONS = 200;

/** The server serves a whole package run, not one file: it outlives the usual 30 minutes. */
const LIFETIME = "90m";

/** A call that takes the shared server: `startTestPostgres()` without `{ own: true }`. */
const SHARED_CALL = /startTestPostgres\((?!\s*\{\s*own:\s*true)/;

/** True when some test file takes the shared server. A package whose tests need none (video)
 *  starts no server. A helper file's call is not seen: a test that needs the server and does not
 *  find it gets a container of its own, so this only decides whether the server is worth starting. */
async function wantsPostgres(project: TestProject): Promise<boolean> {
  const { testFiles } = await project.globTestFiles();
  for (const file of testFiles) if (SHARED_CALL.test(await readFile(file, "utf8"))) return true;
  return false;
}

/** What a file left on the shared server that the next file will meet: any database or login
 *  besides the server's own and the clones. It means that file needs `{ own: true }`. */
async function leftovers(adminUrl: string): Promise<string[]> {
  const sql = postgres(adminUrl, { max: 1, prepare: false });
  try {
    const dbs = await sql<{ name: string }[]>`
      select datname as name from pg_database
      where datname not in ('postgres', 'template0', 'template1', 'test', ${TEMPLATE_DATABASE})
        and datname not like 't\_%'`;
    const roles = await sql<{ name: string }[]>`
      select rolname as name from pg_roles where rolname not like 'pg\_%' and rolname <> 'test'`;
    return [...dbs.map((d) => `database ${d.name}`), ...roles.map((r) => `role ${r.name}`)];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export default async function setup(project: TestProject): Promise<(() => Promise<void>) | void> {
  if (!(await wantsPostgres(project))) return;
  const container = await startPostgresContainer(MAX_CONNECTIONS, LIFETIME);
  const adminUrl = container.getConnectionUri();
  try {
    await migrateTemplate(adminUrl);
  } catch (err) {
    await container.stop();
    throw err;
  }
  project.provide("wrenTestPg", adminUrl);
  return async () => {
    try {
      const left = await leftovers(adminUrl);
      if (left.length > 0)
        throw new Error(
          `A test file left ${left.join(", ")} on the shared Postgres. Files that change what the whole server shares need startTestPostgres({ own: true }).`,
        );
    } finally {
      await container.stop();
    }
  };
}
