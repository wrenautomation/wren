// Waited rows first (designs/2026-11-09-own-runtime.md, "Group 4"): which rows a caller waits on,
// and a dispatcher that runs those first and caps the rest.
import { startTestPostgres } from "@wren/db/testing";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as clients from "../../src/clients.js";
import * as sdk from "../../src/index.js";
import { Dispatcher, migrate, Registry, register, runTurn, serveDoor } from "../../src/pg/index.js";
import { submit } from "../../src/pg/store.js";

const back = sdk.service({
  name: "WaitBack",
  handlers: {
    work: async (_ctx: sdk.Context, _run: string) => "ok",
  },
});
const front = sdk.service({
  name: "WaitFront",
  handlers: {
    /** One call, one send, one delayed send: each child's caller_waits by how it was made. */
    fan: async (ctx: sdk.Context, run: string) => {
      ctx.serviceSendClient(back).work(`${run}:send`);
      ctx.serviceSendClient(back).work(`${run}:later`, sdk.rpc.sendOpts({ delay: 60_000 }));
      return ctx.serviceClient(back).work(`${run}:call`);
    },
  },
});

let sql: postgres.Sql;
let stop = async () => {};
let ingress: clients.Ingress;
beforeAll(async () => {
  const pg = await startTestPostgres();
  sql = postgres(pg.url, { max: 8, onnotice: () => {} });
  await migrate(sql);
  const registry = new Registry([front, back] as never);
  await register(sql, registry);
  const dispatcher = new Dispatcher({
    sql,
    concurrency: 8,
    pollMs: 200,
    lane: { only: ["WaitFront", "WaitBack"] },
    run: (c) => runTurn({ sql, registry, leaseMs: 10_000 }, c),
  });
  await dispatcher.start();
  const door = await serveDoor({ sql });
  ingress = clients.connect({ url: door.url });
  stop = async () => {
    await door.close();
    await dispatcher.stop();
    await sql.end({ timeout: 5 });
    await pg.stop();
  };
}, 60_000);
afterAll(() => stop());

/** caller_waits of the row whose input is this JSON string. */
const waits = async (input: string) => {
  const rows = await sql<{ caller_waits: boolean }[]>`
    SELECT caller_waits FROM rt.invocations WHERE convert_from(input, 'UTF8') = ${JSON.stringify(input)}`;
  expect(rows.length, input).toBe(1);
  return rows[0]?.caller_waits;
};

describe("caller_waits", () => {
  it("a door call waits, and so does its call child; sends and delayed sends do not", async () => {
    expect(await ingress.serviceClient(front).fan("a")).toBe("ok");
    expect(await waits("a")).toBe(true);
    expect(await waits("a:call")).toBe(true);
    expect(await waits("a:send")).toBe(false);
    expect(await waits("a:later")).toBe(false);
  });

  it("a door send waits on nothing, so neither does its call child", async () => {
    await ingress.serviceSendClient(front).fan("b");
    for (let i = 0; i < 100; i++) {
      const [r] = await sql<{ n: number }[]>`
        SELECT count(*)::int n FROM rt.invocations
        WHERE convert_from(input, 'UTF8') = ${JSON.stringify("b:call")} AND status = 'done'`;
      if (r?.n) break;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    expect(await waits("b")).toBe(false);
    expect(await waits("b:call")).toBe(false);
  });
});

describe("background cap", () => {
  it("waited rows start first; the rest never pass the cap, and wait for a slot", async () => {
    const gates = new Map<string, () => void>();
    const running = new Set<string>();
    let maxBackground = 0;
    const order: string[] = [];
    const kinds = new Map<string, boolean>();
    const d = new Dispatcher({
      sql,
      concurrency: 3,
      background: 1,
      pollMs: 100,
      lane: { only: ["CapSvc"] },
      run: async (c) => {
        order.push(c.id);
        running.add(c.id);
        const bg = [...running].filter((id) => kinds.get(id) === false).length;
        maxBackground = Math.max(maxBackground, bg);
        await new Promise<void>((ok) => gates.set(c.id, ok));
        running.delete(c.id);
        await sql`UPDATE rt.invocations SET status = 'done', holds = false WHERE id = ${c.id}`;
      },
    });
    let n = 0;
    const add = async (callerWaits: boolean) => {
      const id = `inv_cap${String(n++).padStart(23, "0")}`;
      kinds.set(id, callerWaits);
      await submit(sql, {
        id,
        service: "CapSvc",
        handler: "h",
        key: null,
        input: new Uint8Array(),
        headers: {},
        idemKey: null,
        runAt: new Date(Date.now() - 10_000 + n),
        callerWaits,
      });
      return id;
    };
    // background rows are older: by run_at alone they would go first
    const bgRows = [await add(false), await add(false), await add(false)];
    const waited = [await add(true), await add(true)];
    const until = async (f: () => boolean) => {
      for (let i = 0; i < 100 && !f(); i++) await new Promise((ok) => setTimeout(ok, 30));
      expect(f()).toBe(true);
    };
    await d.start();
    await until(() => running.size === 3);
    expect(new Set(order.slice(0, 2))).toEqual(new Set(waited));
    expect([...running].filter((id) => !kinds.get(id))).toHaveLength(1);
    // a waited row that comes later takes a waited row's slot before any background row
    const late = await add(true);
    gates.get(waited[0] as string)?.();
    await until(() => running.has(late));
    expect([...running].filter((id) => !kinds.get(id))).toHaveLength(1);
    // free every slot: the background rows drain one at a time
    for (let i = 0; i < 10 && order.length < 6; i++) {
      for (const [id, ok] of gates) if (running.has(id)) ok();
      await new Promise((ok) => setTimeout(ok, 150));
    }
    for (const [id, ok] of gates) if (running.has(id)) ok();
    await until(() => running.size === 0 && order.length === 6);
    expect(new Set(order)).toEqual(new Set([...bgRows, ...waited, late]));
    expect(maxBackground).toBe(1);
    await d.stop();
  });
});
