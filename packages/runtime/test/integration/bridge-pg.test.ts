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
  setPgServices,
  takeState,
} from "../../src/pg/index.js";

const OBJECT = { type: "object", properties: {}, additionalProperties: {} };
const rs = restate.service({
  name: "Rs",
  handlers: {
    twice: async (_ctx: restate.Context, n: number) => n * 2,
    // as wren's NO_INPUT forms: Restate refuses an empty body sent with a content type
    bare: restate.handlers.handler(
      {
        input: restate.serde.schema({
          "~standard": {
            version: 1,
            vendor: "test",
            validate: (value: unknown) => ({ value }),
            jsonSchema: { input: () => OBJECT, output: () => OBJECT },
          },
        }),
        accept: "application/json",
      },
      async (_ctx: restate.Context): Promise<string> => "bare",
    ),
    slow: async (ctx: restate.Context): Promise<string> => {
      await ctx.sleep(60_000);
      return "late";
    },
    viaPg: async (ctx: restate.Context, name: string): Promise<string> =>
      ctx.serviceClient<typeof echo>({ name: "Echo" }).hi(name),
  },
});
/** Restate only, unknown to the pg registry: autobrowse's `sites` seen from wren. */
const outside = restate.service({
  name: "Outside",
  handlers: { shout: async (_ctx: restate.Context, s: string) => s.toUpperCase() },
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
    // no argument, as `content.platforms()`
    viaBare: async (ctx: restate.Context): Promise<string> =>
      (ctx.serviceClient(rs).bare as unknown as () => Promise<string>)(),
    // as `within`: wait a moment, then cancel the call and move on
    giveUp: async (ctx: restate.Context): Promise<string> => {
      const call = (
        ctx.serviceClient(rs).slow as unknown as () => restate.InvocationPromise<string>
      )();
      try {
        return await call.orTimeout(300);
      } catch (err) {
        if (!(err instanceof restate.TimeoutError)) throw err;
        ctx.invocation(await call.invocationId).cancel();
        return "gave up";
      }
    },
    viaOutside: async (ctx: restate.Context, s: string): Promise<string> =>
      ctx.serviceClient(outside).shout(s),
    inside: restate.handlers.handler(
      { ingressPrivate: true },
      async (_ctx: restate.Context): Promise<string> => "inside",
    ),
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
/** The door in front of Restate, as on the box (phase 4). */
let front: string;
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
      outside,
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
    run: (c) => bridgeTurn({ sql, ingress, leaseMs: 60_000, admin }, c),
    log,
  });
  await pgLane.start();
  await bridge.start();
  const reply = await replier({ sql, ingress, sweepMs: 1000, log });
  const door = await serveDoor({ sql });
  await setPgServices(sql, ["Echo", "Counter"], "test");
  const frontDoor = await serveDoor({
    sql,
    restate: ingress.url,
    renamed: { OldCounter: "Counter", Gone: "Absent" },
  });
  front = frontDoor.url;
  onRestate = clients.connect(ingress);
  onPg = clients.connect({ url: door.url });
  stop = async () => {
    await door.close();
    await frontDoor.close();
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

  it("a pg handler calls a Restate handler that takes no input", async () => {
    expect(await onPg.serviceClient(echo).viaBare()).toBe("bare");
  }, 30_000);

  it("a cancelled bridge row cancels its Restate call", async () => {
    expect(await onPg.serviceClient(echo).giveUp()).toBe("gave up");
    let rows: { status: string; completion_result: string | null }[] = [];
    for (let i = 0; i < 60; i++) {
      const res = await fetch(`${admin}/query`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          query: `SELECT status, completion_result FROM sys_invocation WHERE target = 'Rs/slow'`,
        }),
      });
      rows = ((await res.json()) as { rows: typeof rows }).rows;
      if (rows[0]?.status === "completed") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(rows).toEqual([{ status: "completed", completion_result: "failure" }]);
    const [row] = await sql<{ status: string; code: number }[]>`
      SELECT status, (error->>'code')::int AS code FROM rt.invocations
      WHERE service = 'Rs' AND handler = 'slow'`;
    expect(row).toEqual({ status: "done", code: 409 });
  }, 30_000);

  it("a pg handler calls a service pg never registered through a bridge row", async () => {
    expect(await onPg.serviceClient(echo).viaOutside("hey")).toBe("HEY");
    const [row] = await sql<{ exclusive: boolean; status: string }[]>`
      SELECT exclusive, status FROM rt.invocations WHERE service = 'Outside'`;
    expect(row).toEqual({ exclusive: false, status: "done" });
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

  it("box start takes Restate's stranded state into pg; a key pg holds stays pg's", async () => {
    const put = async (service: string, key: string, state: Record<string, string>) => {
      const new_state = Object.fromEntries(
        Object.entries(state).map(([k, v]) => [k, [...Buffer.from(v)]]),
      );
      const res = await fetch(`${admin}/services/${service}/state`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ object_key: key, new_state }),
      });
      expect(res.ok, await res.text()).toBe(true);
    };
    // under the old name: lands under the new one
    await put("OldCounter", "c3", { n: "4", note: '"x"' });
    expect(await takeState(sql, admin, "OldCounter", "Counter")).toEqual({
      moved: ["c3"],
      kept: [],
    });
    expect(await restateState("c3", "OldCounter")).toEqual([]);
    // pg already holds c4: Restate's older copy is not merged in, and is not cleared
    await sql`INSERT INTO rt.state (service, key, name, value) VALUES ('Counter', 'c4', 'n', '10')`;
    await put("Counter", "c4", { n: "1", stale: "1" });
    const r = await takeState(sql, admin, "Counter");
    expect(r.kept).toEqual(["c4"]);
    expect(new Set(r.moved)).toEqual(new Set(["c1", "c2"]));
    expect(await restateState("c1")).toEqual([]);
    expect(await restateState("c4")).toHaveLength(2);
    const c4 = await sql`SELECT name FROM rt.state WHERE service = 'Counter' AND key = 'c4'`;
    expect(c4.map((x) => x.name)).toEqual(["n"]);
    // the door serves pg direct: each moved key carries on from its value
    expect(await onPg.objectClient(counter, "c1").add(1)).toBe(9);
    expect(await onPg.objectClient(counter, "c3").add(1)).toBe(5);
    const [note] = await sql`SELECT convert_from(value, 'UTF8') v FROM rt.state
      WHERE service = 'Counter' AND key = 'c3' AND name = 'note'`;
    expect(note?.v).toBe('"x"');
    // nothing left to take
    expect(await takeState(sql, admin, "OldCounter", "Counter")).toEqual({ moved: [], kept: [] });
  }, 30_000);

  it("each proxy row is replied once", async () => {
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM rt.invocations WHERE reply IS NOT NULL AND replied_at IS NULL`;
    expect(rows[0]?.n).toBe(0);
  });
});

describe("the door in front of Restate", () => {
  const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${front}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body ?? null),
    });
  const rowsOf = async (service: string) =>
    (
      await sql<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM rt.invocations WHERE service = ${service} AND reply IS NULL`
    )[0]?.n ?? 0;

  it("health answers", async () => {
    const r = await fetch(`${front}/restate/health`);
    expect(r.status).toBe(200);
  });

  it("a pg service is served by pg, not by its Restate proxy", async () => {
    const before = await rowsOf("Echo");
    const r = await post("/Echo/hi", "cy");
    expect(await r.json()).toBe("hi cy 2");
    expect(await rowsOf("Echo")).toBe(before + 1);
  }, 30_000);

  it("a Restate service passes through, with its headers and status", async () => {
    const r = await post("/Rs/twice", 5);
    expect(r.status).toBe(200);
    expect(await r.json()).toBe(10);
    const missing = await post("/Nowhere/x", 1);
    expect(missing.status).toBe(404);
    expect(
      (
        await sql`SELECT 1 FROM rt.invocations WHERE service IN ('Rs', 'Nowhere') AND handler IN ('x') `
      ).length,
    ).toBe(0);
  }, 30_000);

  it("a Restate send passes through; its attach and idempotency hold", async () => {
    const r = await post("/Outside/shout/send?delay=1s", "yo", { "idempotency-key": "front-1" });
    expect(r.status).toBe(202);
    const { invocationId, status } = (await r.json()) as { invocationId: string; status: string };
    expect(status).toBe("Accepted");
    const again = await post("/Outside/shout/send?delay=1s", "yo", {
      "idempotency-key": "front-1",
    });
    expect(((await again.json()) as { invocationId: string }).invocationId).toBe(invocationId);
    const out = await fetch(`${front}/restate/invocation/${invocationId}/attach`);
    expect(await out.json()).toBe("YO");
  }, 30_000);

  it("a pg send with a delay waits; its attach answers from pg", async () => {
    const r = await post("/Echo/hi/send?delay=PT1S", "di");
    const { invocationId } = (await r.json()) as { invocationId: string };
    const [row] = await sql<
      { run_at: Date }[]
    >`SELECT run_at FROM rt.invocations WHERE id = ${invocationId}`;
    expect((row?.run_at.getTime() ?? 0) - Date.now()).toBeGreaterThan(200);
    const out = await fetch(`${front}/restate/invocation/${invocationId}/attach`);
    expect(await out.json()).toBe("hi di 2");
  }, 30_000);

  it("output answers 470 while a pg call runs; by idempotency key too", async () => {
    const r = await post("/Echo/hi/send?delay=2s", "ok", { "idempotency-key": "front-2" });
    const { invocationId } = (await r.json()) as { invocationId: string };
    for (const path of [invocationId, "Echo/hi/front-2"]) {
      const early = await fetch(`${front}/restate/invocation/${path}/output`);
      expect(early.status).toBe(470);
    }
    const byKey = await fetch(`${front}/restate/invocation/Echo/hi/front-2/attach`);
    expect(await byKey.json()).toBe("hi ok 2");
    const done = await fetch(`${front}/restate/invocation/${invocationId}/output`);
    expect(await done.json()).toBe("hi ok 2");
    // an object call by key and idempotency key
    await post("/Counter/c9/add", 4, { "idempotency-key": "front-3" });
    const obj = await fetch(`${front}/restate/invocation/Counter/c9/add/front-3/output`);
    expect(await obj.json()).toBe(4);
    // a Restate one by idempotency key passes through
    const rs = await fetch(`${front}/restate/invocation/Outside/shout/front-1/output`);
    expect(await rs.json()).toBe("YO");
  }, 30_000);

  it("an old name is served direct under the new one; an old name pg does not serve passes as it came", async () => {
    const before = await rowsOf("OldCounter");
    const r = await post("/OldCounter/c10/add", 6, { "idempotency-key": "front-4" });
    expect(await r.json()).toBe(6);
    const [row] = await sql<{ service: string; reply: unknown }[]>`
      SELECT service, reply FROM rt.invocations WHERE idem_key = 'front-4'`;
    expect(row).toEqual({ service: "Counter", reply: null });
    expect(await rowsOf("OldCounter")).toBe(before);
    const out = await fetch(`${front}/restate/invocation/OldCounter/c10/add/front-4/output`);
    expect(await out.json()).toBe(6);
    expect((await post("/Gone/x", 1)).status).toBe(404);
  }, 30_000);

  it("refuses a private handler and a bad delay", async () => {
    expect((await post("/Echo/inside")).status).toBe(400);
    expect((await post("/Echo/hi/send?delay=soon", "x")).status).toBe(400);
  });

  it("a Restate awakeable id passes through; a pg one stays", async () => {
    const r = await post("/restate/a/sign_1nope/resolve", "v");
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).not.toBe(502);
  });

  it("a service flipped back to Restate passes through once the door sees it", async () => {
    await setPgServices(sql, ["Counter"], "test-2");
    await new Promise((t) => setTimeout(t, 5_100));
    const before = await rowsOf("Echo");
    expect(await (await post("/Echo/hi", "fl")).json()).toBe("hi fl 2");
    // through Restate's proxy: a proxy row with a reply, no direct row
    expect(await rowsOf("Echo")).toBe(before);
    await setPgServices(sql, ["Echo", "Counter"], "test-3");
  }, 30_000);
});
