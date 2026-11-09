import type { Queryable } from "@wren/db";
import { selfRemoving, startTestPostgres } from "@wren/db/testing";
import * as restate from "@wren/runtime";
import { startPgTestEnvironment } from "@wren/runtime/pg";
import {
  RestateContainer,
  RestateTestEnvironment,
  type TestEnvironmentOptions,
} from "@wren/runtime/testing";
import { sql } from "drizzle-orm";
import { EXECUTOR, type ExecutorEvent } from "./executor.js";

/** Restate for one test file, sized for tests: one partition and a 64 MiB RocksDB take a container
 *  from about 630 MB to 230 MB. A custom container skips the helper's own replay and retry flags,
 *  so they are applied here. The services are reached through host.docker.internal, which skips
 *  testcontainers' sshd port-forwarding container. */
export function startTestRestate(options: TestEnvironmentOptions): Promise<RestateTestEnvironment> {
  if (process.env.WREN_TEST_RUNTIME === "pg") return startTestPg(options);
  return RestateTestEnvironment.start({
    serviceEndpointAccess: "docker-host",
    ...options,
    container: () => {
      const container = selfRemoving(new RestateContainer(), [
        "/usr/local/bin/restate-server",
      ]).withEnvironment({
        RESTATE_DEFAULT_NUM_PARTITIONS: "1",
        RESTATE_ROCKSDB_TOTAL_MEMORY_SIZE: "64MiB",
      });
      if (options.alwaysReplay) container.alwaysReplay();
      if (options.disableRetries) container.disableRetries();
      return container;
    },
  });
}

/** `WREN_TEST_RUNTIME=pg`: the same suite on the pg runtime (design doc "Tests and lints first"). */
async function startTestPg(options: TestEnvironmentOptions): Promise<RestateTestEnvironment> {
  const db = await startTestPostgres();
  const rt = await startPgTestEnvironment({
    url: db.url,
    services: options.services,
    ...(options.disableRetries ? { disableRetries: true } : {}),
  });
  return {
    ...rt,
    async stop() {
      await rt.stop();
      await db.stop();
    },
  } as unknown as RestateTestEnvironment;
}

/** An Executor that only records what parts emit, for a test whose service sends along a workflow. */
export function executorRecorder() {
  const emitted: {
    client: string | null;
    workflow: string;
    from: string;
    events: ExecutorEvent[];
  }[] = [];
  const service = restate.service({
    name: EXECUTOR.name,
    handlers: {
      emit: async (_ctx: restate.Context, req: (typeof emitted)[number]) => {
        emitted.push(req);
        return { arrived: 0, seen: 0, waiting: 0, failed: 0, out: 0 };
      },
    },
  });
  return { service, emitted };
}

/** A manual segment holding these people, by their `person` profile key (made if missing). */
export async function segmentOf(
  db: Queryable,
  personIds: readonly number[],
  name = "test",
): Promise<number> {
  const one = async (q: ReturnType<typeof sql>) =>
    ((await db.execute(q)) as unknown as Record<string, number>[])[0];
  const segment = Number(
    (
      await one(
        sql`INSERT INTO segments (name, kind, by) VALUES (${name}, 'manual', 'test') RETURNING id`,
      )
    )?.id,
  );
  for (const id of personIds) {
    const key = await one(
      sql`SELECT profile_id FROM profile_keys WHERE kind = 'person' AND value = ${String(id)}`,
    );
    const profile =
      key?.profile_id ??
      Number((await one(sql`INSERT INTO profiles DEFAULT VALUES RETURNING id`))?.id);
    if (!key)
      await db.execute(sql`INSERT INTO profile_keys (profile_id, kind, value, source)
        VALUES (${profile}, 'person', ${String(id)}, 'test')`);
    await db.execute(
      sql`INSERT INTO segment_members (segment_id, profile_id) VALUES (${segment}, ${profile})`,
    );
  }
  return segment;
}
