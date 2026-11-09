import type { Queryable } from "@wren/db";
import { startTestPostgres } from "@wren/db/testing";
import * as restate from "@wren/runtime";
import { type PgTestEnvironment, startPgTestEnvironment } from "@wren/runtime/pg";
import { sql } from "drizzle-orm";
import { EXECUTOR, type ExecutorEvent } from "./executor.js";

/** The runtime for one test file: its own database and door (designs/2026-11-09-own-runtime.md). */
export type TestRuntime = PgTestEnvironment;

export interface TestRuntimeOptions {
  services: readonly unknown[];
  /** A failed handler ends on its first error. */
  disableRetries?: boolean;
  /** Restate's flag; no effect on the pg runtime. */
  alwaysReplay?: boolean;
}

export async function startTestRuntime(options: TestRuntimeOptions): Promise<TestRuntime> {
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
  };
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
