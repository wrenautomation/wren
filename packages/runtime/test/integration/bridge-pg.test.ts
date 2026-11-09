// Two runtimes side by side (designs/2026-11-09-own-runtime.md, "Phase 3"): Restate → pg through a
// proxy and the replier, pg → Restate through a bridge row. Echo runs on pg; Rs runs on Restate.
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateContainer, RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { selfRemoving, startTestPostgres } from "@wren/db/testing";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as restate from "../../src/index.js";
import {
  bridgeTurn,
  Dispatcher,
  migrate,
  proxy,
  Registry,
  register,
  replier,
  returnState,
  runTurn,
  serveDoor,
} from "../../src/pg/index.js";

const rs = restate.service({
  name: "Rs",
  handlers: {
    twice: async (_ctx: restate.Context, n: number) => n * 2,
    viaPg: async (ctx: restate.Context, name: string): Promise<string> =>
      ctx.serviceClient<typeof echo>({ name: "Echo" }).hi(name),
  },
});
const echo = restate.service({
  name: "Echo",
  handlers: {
    hi: async (ctx: restate.Context, name: string) => {
      const n = await ctx.run("n", () => name.length);
      return `hi ${name} ${n}`;
    },
    none: async () => "none",
    boom: async (_ctx: restate.Context, _: unknown): Promise<string> => {
      throw new restate.TerminalError("nope", { errorCode: 409 });
    },
    viaRestate: async (ctx: restate.Context, n: number): Promise<number> =>
      ctx.serviceClient(rs).twice(n),
  },
});
const counter = restate.object({
  name: "Counter",
  handlers: {
    add: async (ctx: restate.ObjectContext, by: number) => {
      const n = ((await ctx.get<number>("n")) ?? 0) + by;
      ctx.set("n", n);
      return n;
    },
  },
});

let stop = async () => {};
let admin: string;
const restateState = async (key: string, service = "Counter") => {
  const res = await fetch(`${admin}/query`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      query: `SELECT key, value_utf8 FROM state WHERE service_name = '${service}' AND service_key = '${key}'`,
    }),
  });
  return ((await res.json()) as { rows: { key: string; value_utf8: string }[] }).rows;
};
let onRestate: ReturnType<typeof clients.connect>;
let onPg: ReturnType<typeof clients.connect>;
let sql: postgres.Sql;

beforeAll(async () => {
  const pg = await startTestPostgres();
  sql = postgres(pg.url, { max: 8, onnotice: () => {} });
  await migrate(sql);
  const registry = new Registry([echo, rs, counter]);
  await register(sql, registry);
  const env = await RestateTestEnvironment.start({
    services: [
      proxy(echo, () => sql),
      proxy(counter, () => sql),
      proxy(counter, () => sql, "OldCounter"),
      rs,
    ],
    serviceEndpointAccess: "docker-host",
    container: () =>
      selfRemoving(new RestateContainer(), ["/usr/local/bin/restate-server"]).withEnvironment({
        RESTATE_DEFAULT_NUM_PARTITIONS: "1",
        RESTATE_ROCKSDB_TOTAL_MEMORY_SIZE: "64MiB",
      }),
  });
  const ingress = { url: env.baseUrl() };
  admin = env.adminAPIBaseUrl();
  const log = () => {};
  const pgLane = new Dispatcher({
    sql,
    pollMs: 100,
    lane: { only: ["Echo", "Counter"] },
    run: (c) => runTurn({ sql, registry, log }, c),
    log,
  });
  const bridge = new Dispatcher({
    sql,
    pollMs: 100,
    lane: { except: ["Echo", "Counter"], lock: false },
    run: (c) => bridgeTurn({ sql, ingress, leaseMs: 60_000 }, c),
    log,
  });
  await pgLane.start();
  await bridge.start();
  const reply = await replier({ sql, ingress, sweepMs: 1000, log });
  const door = await serveDoor({ sql });
  onRestate = clients.connect(ingress);
  onPg = clients.connect({ url: door.url });
  stop = async () => {
    await door.close();
    await reply.stop();
    await pgLane.stop();
    await bridge.stop();
    await env.stop();
    await sql.end({ timeout: 5 });
    await pg.stop();
  };
}, 120_000);
afterAll(() => stop());

describe("restate ↔ pg", () => {
  it("a Restate client calls a pg service through its proxy", async () => {
    expect(await onRestate.serviceClient(echo).hi("ada")).toBe("hi ada 3");
  }, 30_000);

  it("a call with no input passes the proxy", async () => {
    expect(await onRestate.serviceClient(echo).none()).toBe("none");
  }, 30_000);

  it("a Restate handler calls a pg service", async () => {
    expect(await onRestate.serviceClient(rs).viaPg("bo")).toBe("hi bo 2");
  }, 30_000);

  it("a pg terminal error keeps its message and code on Restate", async () => {
    const err = await Promise.resolve(onRestate.serviceClient(echo).boom(null)).catch(
      (e: unknown) => e as Error,
    );
    expect(String((err as Error).message)).toContain("nope");
    expect(JSON.stringify(err)).toContain("409");
  }, 30_000);

  it("a pg handler calls a Restate service through a bridge row", async () => {
    expect(await onPg.serviceClient(echo).viaRestate(21)).toBe(42);
    const [row] = await sql<{ remote: string | null; status: string }[]>`
      SELECT remote, status FROM rt.invocations WHERE service = 'Rs' AND handler = 'twice'`;
    expect(row?.status).toBe("done");
    expect(row?.remote).toMatch(/^inv_/);
  }, 30_000);

  it("an exclusive proxy moves its key's Restate state to pg", async () => {
    const res = await fetch(`${admin}/services/Counter/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ object_key: "c1", new_state: { n: [...Buffer.from("5")] } }),
    });
    expect(res.ok, await res.text()).toBe(true);
    expect(await restateState("c1")).toEqual([{ key: "n", value_utf8: "5" }]);
    expect(await onRestate.objectClient(counter, "c1").add(2)).toBe(7);
    expect(await onRestate.objectClient(counter, "c1").add(1)).toBe(8);
    expect(await restateState("c1")).toEqual([]);
  }, 30_000);

  it("a renamed service: the old name's proxy moves its state and calls to the new one", async () => {
    const res = await fetch(`${admin}/services/OldCounter/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ object_key: "c2", new_state: { n: [...Buffer.from("3")] } }),
    });
    expect(res.ok, await res.text()).toBe(true);
    const old = onRestate.objectClient({ name: "OldCounter" } as unknown as typeof counter, "c2");
    expect(await old.add(1)).toBe(4);
    expect(await restateState("c2", "OldCounter")).toEqual([]);
    expect(await onRestate.objectClient(counter, "c2").add(1)).toBe(5);
    const rows = await sql`SELECT DISTINCT service FROM rt.invocations WHERE key = 'c2'`;
    expect(rows.map((r) => r.service)).toEqual(["Counter"]);
  }, 30_000);

  it("a flip back returns pg's state to Restate", async () => {
    expect(await returnState(sql, admin, "Counter")).toBe(2);
    expect(await restateState("c1")).toEqual([{ key: "n", value_utf8: "8" }]);
    const left = await sql`SELECT 1 FROM rt.state WHERE service = 'Counter'`;
    expect(left.length).toBe(0);
  }, 30_000);

  it("each proxy row is replied once", async () => {
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM rt.invocations WHERE reply IS NOT NULL AND replied_at IS NULL`;
    expect(rows[0]?.n).toBe(0);
  });
});
