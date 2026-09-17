import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, migrate } from "./index.js";

export interface TestPostgres extends DbHandle {
  url: string;
  stop(): Promise<void>;
}

/** Start Postgres 17 in Docker, run all migrations, return a handle. One per test file. */
export async function startTestPostgres(): Promise<TestPostgres> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "postgres:17",
  ).start();
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

/** Delete every row in the given tables, children first. Cheaper than a new container per test. */
export async function truncate(db: DbHandle["db"], tables: string[]): Promise<void> {
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t}"`).join(", ");
  await db.execute(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
