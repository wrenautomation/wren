import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, migrate } from "./index.js";

export interface TestPostgres extends DbHandle {
  url: string;
  stop(): Promise<void>;
}

interface Configurable<C> {
  withAutoRemove(on: boolean): C;
  withEntrypoint(entrypoint: string[]): C;
  withCommand(command: string[]): C;
}

/** A test container that cannot be left behind. Ryuk removes it when the test process dies, but
 *  Ryuk dies too when the Docker VM is starved or restarted. So Docker deletes the container and
 *  its volumes the moment it exits, and it kills itself after 30 minutes. `entrypoint` and
 *  `command` are the image's own, since the lifetime runs in front of them. */
export function selfRemoving<C extends Configurable<C>>(
  container: C,
  entrypoint: string[],
  command: string[] = [],
): C {
  (container as unknown as { hostConfig: { AutoRemove?: boolean } }).hostConfig.AutoRemove = true;
  return container
    .withAutoRemove(false) // Docker removes it; a second remove from testcontainers would throw
    .withEntrypoint(["timeout", "-s", "KILL", "30m", ...entrypoint])
    .withCommand(command);
}

/** Postgres that never waits on a disk: a throwaway test database needs no crash safety, and
 *  initdb plus every migration flushing to disk is most of a start on a loaded machine. */
const NO_DISK_WAITS = ["fsync=off", "synchronous_commit=off", "full_page_writes=off"].flatMap(
  (c) => ["-c", c],
);

/** Start Postgres 17 in Docker, run all migrations, return a handle. One per test file. CI pulls
 *  it from a mirror (`WREN_TEST_PG_IMAGE`): Docker Hub limits anonymous pulls per runner IP. Its
 *  data lives in memory and is never synced. */
export async function startTestPostgres(): Promise<TestPostgres> {
  const container: StartedPostgreSqlContainer = await selfRemoving(
    new PostgreSqlContainer(process.env.WREN_TEST_PG_IMAGE ?? "postgres:17")
      .withTmpFs({ "/var/lib/postgresql/data": "rw" })
      .withEnvironment({ POSTGRES_INITDB_ARGS: "--no-sync" }),
    ["docker-entrypoint.sh"],
    ["postgres", ...NO_DISK_WAITS],
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
