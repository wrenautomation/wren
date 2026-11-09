// Lambda turns (designs/2026-11-09-own-runtime.md, "Lambda turns"): the box loads and finishes,
// Lambda runs the handler. Each ask and reply crosses as JSON, as the invoke does.
import { startTestPostgres } from "@wren/db/testing";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as clients from "../../src/clients.js";
import * as sdk from "../../src/index.js";
import {
  Dispatcher,
  migrate,
  Registry,
  register,
  remoteTurn,
  runTurn,
  serveDoor,
  servedTurn,
  type TurnAsk,
  type TurnReply,
} from "../../src/pg/index.js";

const BIG = 4_000_000; // base64 of 4 MB is over WIRE_MAX

const store = sdk.object({
  name: "WireStore",
  handlers: {
    put: async (ctx: sdk.ObjectContext, size: number) => {
      ctx.set("blob", "x".repeat(size));
      return "put";
    },
    /** reads state the turn was loaded with, does one step, sets more */
    bump: async (ctx: sdk.ObjectContext) => {
      const n = ((await ctx.get<number>("n")) ?? 0) + 1;
      const at = await ctx.run("at", () => n * 10);
      ctx.set("n", n);
      return { n, at, blob: ((await ctx.get<string>("blob")) ?? "").length };
    },
    /** leaves the blob unread, so the outcome stays small */
    count: async (ctx: sdk.ObjectContext) => {
      const n = ((await ctx.get<number>("n")) ?? 0) + 1;
      ctx.set("n", n);
      return n;
    },
    huge: async (_ctx: sdk.ObjectContext) => "y".repeat(BIG),
    fail: async (_ctx: sdk.ObjectContext) => {
      throw new sdk.TerminalError("no", { errorCode: 409 });
    },
  },
});

type Mode = "wire" | "old";
let mode: Mode = "wire";
const seen: { ask: TurnAsk; reply: TurnReply | string }[] = [];
let sql: postgres.Sql;
let ingress: clients.Ingress;
let stop = async () => {};

beforeAll(async () => {
  const pg = await startTestPostgres();
  sql = postgres(pg.url, { max: 8, onnotice: () => {} });
  await migrate(sql);
  const registry = new Registry([store] as never);
  await register(sql, registry);
  const dispatcher = new Dispatcher({
    sql,
    concurrency: 4,
    pollMs: 100,
    run: (c) =>
      remoteTurn(sql, c, 10_000, async (sent) => {
        const ask = JSON.parse(JSON.stringify(sent)) as TurnAsk;
        // an old Lambda build: ignores loaded and defer, loads and finishes, answers its status
        const reply =
          mode === "old"
            ? await runTurn({ sql, registry, leaseMs: ask.leaseMs }, ask)
            : await servedTurn({ sql, registry }, ask);
        seen.push({ ask, reply });
        return JSON.parse(JSON.stringify(reply));
      }),
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

const last = () => seen[seen.length - 1] as { ask: TurnAsk; reply: TurnReply | string };

describe("Lambda turns", () => {
  it("the box sends the loaded turn and writes the outcome; state and steps survive", async () => {
    mode = "wire";
    const a = ingress.objectClient(store, "a");
    expect(await a.bump()).toEqual({ n: 1, at: 10, blob: 0 });
    expect(last().ask.loaded).toBeDefined();
    expect((last().reply as TurnReply).finish).toBeDefined();
    expect(await a.bump()).toEqual({ n: 2, at: 20, blob: 0 });
  });

  it("a refusal keeps its code across the wire", async () => {
    mode = "wire";
    await expect(ingress.objectClient(store, "f").fail()).rejects.toThrow(/no/);
    const [r] = await sql<{ status: string; error: { code: number } }[]>`
      SELECT status, error FROM rt.invocations WHERE service = 'WireStore' AND handler = 'fail'`;
    expect(r?.status).toBe("done");
    expect(r?.error.code).toBe(409);
  });

  it("an old Lambda build finishes the turn itself", async () => {
    mode = "old";
    const o = ingress.objectClient(store, "old");
    expect(await o.bump()).toEqual({ n: 1, at: 10, blob: 0 });
    expect(typeof last().reply).toBe("string");
    expect(await o.bump()).toEqual({ n: 2, at: 20, blob: 0 });
  });

  it("state too big for the invoke: Lambda loads it", async () => {
    mode = "wire";
    const b = ingress.objectClient(store, "big");
    await b.put(BIG);
    expect(await b.count()).toBe(1);
    expect(last().ask.loaded).toBeUndefined();
    expect((last().reply as TurnReply).finish).toBeDefined();
    // a read of it is journaled: too big for the reply, so Lambda writes that outcome
    expect(await b.bump()).toEqual({ n: 2, at: 20, blob: BIG });
    expect(last().reply).toEqual({ status: "done" });
  }, 30_000);

  it("a result too big for the reply: Lambda writes the outcome", async () => {
    mode = "wire";
    const out = await ingress.objectClient(store, "huge").huge();
    expect(out.length).toBe(BIG);
    expect(last().reply).toEqual({ status: "done" });
  }, 30_000);
});
