// The conformance suite on the Postgres runtime: door + dispatcher + executor in this process.
import { startTestPostgres } from "@wren/db/testing";
import postgres from "postgres";
import * as clients from "../../src/clients.js";
import * as sdk from "../../src/index.js";
import {
  Dispatcher,
  fromWire,
  migrate,
  Registry,
  register,
  remoteTurn,
  runTurn,
  serveDoor,
  servedTurn,
  toWire,
} from "../../src/pg/index.js";
import { conformance, type Status } from "./conformance/scenarios.js";

// "pg wire": prod's Lambda path, the box loads and finishes, the turn gets and returns JSON
for (const wire of [false, true])
  conformance(wire ? "pg wire" : "pg", { sdk, clients }, async (services) => {
    const pg = await startTestPostgres();
    const sql = postgres(pg.url, { max: 12, onnotice: () => {} });
    await migrate(sql);
    const registry = new Registry(services);
    await register(sql, registry);
    const dispatcher = new Dispatcher({
      sql,
      concurrency: 16,
      pollMs: 200,
      run: (c) =>
        wire
          ? remoteTurn(sql, c, 10_000, async (ask) =>
              fromWire(toWire(await servedTurn({ sql, registry }, fromWire(toWire(ask))))),
            )
          : runTurn({ sql, registry, leaseMs: 10_000 }, c),
    });
    await dispatcher.start();
    const door = await serveDoor({ sql });
    return {
      ingress: clients.connect({ url: door.url }),
      missingId: "inv_00000000000000000000000000",
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
