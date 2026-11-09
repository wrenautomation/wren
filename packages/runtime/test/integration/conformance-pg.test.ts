// The conformance suite on the Postgres runtime: door + dispatcher + executor in this process.
import { startTestPostgres } from "@wren/db/testing";
import postgres from "postgres";
import * as clients from "../../src/clients.js";
import * as sdk from "../../src/index.js";
import { Dispatcher, migrate, Registry, register, runTurn, serveDoor } from "../../src/pg/index.js";
import { conformance, type Status } from "./conformance/scenarios.js";

conformance("pg", { sdk, clients }, async (services) => {
  const pg = await startTestPostgres();
  const sql = postgres(pg.url, { max: 12, onnotice: () => {} });
  await migrate(sql);
  const registry = new Registry(services);
  await register(sql, registry);
  const dispatcher = new Dispatcher({
    sql,
    concurrency: 16,
    pollMs: 200,
    run: (c) => runTurn({ sql, registry, leaseMs: 10_000 }, c),
  });
  await dispatcher.start();
  const door = await serveDoor({ sql });
  return {
    ingress: clients.connect({ url: door.url }),
    async status(id: string): Promise<Status> {
      const [r] = await sql<
        { status: string }[]
      >`SELECT status FROM rt.invocations WHERE id = ${id}`;
      return r?.status === "done" ? "completed" : r?.status === "paused" ? "paused" : "other";
    },
    stop: async () => {
      await door.close();
      await dispatcher.stop();
      await sql.end({ timeout: 5 });
      await pg.stop();
    },
  };
});
