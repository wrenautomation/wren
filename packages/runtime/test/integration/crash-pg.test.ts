// Crash points (designs/2026-11-09-own-runtime.md, "Tests and lints first" 2): a crash at each
// boundary, then lease expiry and replay. Final result = the no-crash run; each effect runs 1-2 times.
import { startTestPostgres } from "@wren/db/testing";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as clients from "../../src/clients.js";
import * as restate from "../../src/index.js";
import {
  Crash,
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

const LEASE_MS = 400;
const hits = new Map<string, number>();
const hit = (k: string) => hits.set(k, (hits.get(k) ?? 0) + 1).get(k) ?? 0;
type R = { run: string };

const kid = restate.service({
  name: "CrashKid",
  handlers: {
    work: async (ctx: restate.Context, { run }: R) => {
      await ctx.run("k", () => hit(`${run}:k`));
      return `kid ${run}`;
    },
  },
});
const flow = restate.object({
  name: "CrashFlow",
  handlers: {
    go: async (ctx: restate.ObjectContext, { run }: R) => {
      await ctx.run("a", () => hit(`${run}:a`));
      ctx.set("s", 1);
      await ctx.sleep(20); // suspends: localWaitMs 0
      const k = await ctx.genericCall({
        service: "CrashKid",
        method: "work",
        parameter: Buffer.from(JSON.stringify({ run })),
        inputSerde: restate.serde.binary,
        outputSerde: restate.serde.json as restate.Serde<string>,
      });
      await ctx.run("b", () => hit(`${run}:b`));
      return { k, s: await ctx.get<number>("s") };
    },
  },
});

const POINTS = [
  "none",
  ...["a", "b", "k"].flatMap((n) =>
    ["before", "after-effect", "after-journal"].map((w) => `run:${n}:${w}`),
  ),
  "finish:before",
];

let armed = "none";
let wire = false; // prod's Lambda path: the box loads and finishes, the turn crosses as JSON
let fired = false;
let stop = async () => {};
let ingress: clients.Ingress;

beforeAll(async () => {
  const pg = await startTestPostgres();
  const sql = postgres(pg.url, { max: 8, onnotice: () => {} });
  await migrate(sql);
  const registry = new Registry([kid, flow]);
  await register(sql, registry);
  const crash = (point: string) => {
    if (!fired && point === armed) {
      fired = true;
      throw new Crash(point);
    }
  };
  const dispatcher = new Dispatcher({
    sql,
    concurrency: 4,
    pollMs: 50,
    leaseMs: LEASE_MS,
    run: (c) => {
      const o = { sql, registry, leaseMs: LEASE_MS, localWaitMs: 0, crash, log: () => {} };
      return wire
        ? remoteTurn(sql, c, LEASE_MS, async (ask) =>
            fromWire(toWire(await servedTurn(o, fromWire(toWire(ask))))),
          )
        : runTurn(o, c);
    },
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

describe.each([false, true])("pg crash points, wire %s", (w) => {
  let baseline: unknown;
  for (const point of POINTS) {
    it(point, async () => {
      wire = w;
      armed = point;
      fired = false;
      const run = `crash-${w ? "wire-" : ""}${point}`;
      const out = await ingress.objectClient(flow, run).go({ run });
      if (point === "none") baseline = out;
      else expect(fired).toBe(true);
      expect(JSON.stringify(out)).toBe(
        JSON.stringify({ ...(baseline as object), k: `kid ${run}` }),
      );
      for (const n of ["a", "b", "k"]) {
        const c = hits.get(`${run}:${n}`) ?? 0;
        expect(c, `${n} ran ${c}x`).toBeGreaterThanOrEqual(1);
        expect(c, `${n} ran ${c}x`).toBeLessThanOrEqual(
          point.startsWith(`run:${n}:after-effect`) ? 2 : 1,
        );
      }
    }, 30_000);
  }
});
