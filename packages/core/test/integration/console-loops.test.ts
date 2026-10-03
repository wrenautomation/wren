/**
 * ConsolePortal's loops against a real Restate: `loops` reads every object with a `running` key
 * through the admin SQL, with its next scheduled call, and `setLoop` stops and starts one. A loop
 * the read didn't list, or a viewer who isn't Wren's team, is refused.
 */
import type * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import type { Db } from "@wren/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type LoopRow, makeConsolePortal, restateAdmin } from "../../src/console.js";
import { LAST, makeLoopObject, type PassOutcome } from "../../src/restate/loop.js";

const HOUR = 3_600_000;
const tick = makeLoopObject("Tick", async (ctx: restate.ObjectContext) => {
  const outcome: PassOutcome<{ n: number }> = {
    stats: { n: 1 },
    error: null,
    failures: 0,
    delayMs: HOUR,
    now: new Date(await ctx.date.now()).toISOString(),
  };
  ctx.set(LAST, outcome);
  return outcome;
});
type Tick = typeof tick;
type Console = ReturnType<typeof makeConsolePortal>;

const operator = { viewer: { email: "op@example.test", operator: true } };
let env: RestateTestEnvironment;
const ingress = () => clients.connect({ url: env.baseUrl() });
const consolePortal = () => ingress().serviceClient<Console>({ name: "ConsolePortal" });
const tickOf = (key: string) => ingress().objectClient<Tick>({ name: "Tick" }, key);

beforeAll(async () => {
  env = await RestateTestEnvironment.start({
    services: [
      tick,
      makeConsolePortal({
        main: {} as Db,
        views: [],
        admin: async (query) => restateAdmin(env.adminAPIBaseUrl())(query),
      }),
    ],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
});

/** Admin SQL reads lag the ingress a little: ask until `ok` holds. */
async function loopsUntil(ok: (loops: LoopRow[]) => boolean): Promise<LoopRow[]> {
  for (let i = 0; ; i++) {
    const loops = await consolePortal().loops(operator);
    if (ok(loops) || i > 50) return loops;
    await new Promise((r) => setTimeout(r, 100));
  }
}
const one = (loops: LoopRow[], key: string) => loops.find((l) => l.key === key);

describe("ConsolePortal loops", () => {
  it("lists a running loop with its last pass and next call, then stops and starts it", async () => {
    await tickOf("a").start();
    let loops = await loopsUntil((l) => one(l, "a")?.nextAt != null);
    const a = one(loops, "a");
    expect(a).toMatchObject({ service: "Tick", running: true, failures: 0, error: null });
    expect(Date.parse(a?.nextAt ?? "") - Date.parse(a?.lastAt ?? "")).toBeGreaterThan(HOUR - 5000);

    expect(
      await consolePortal().setLoop({ ...operator, service: "Tick", key: "a", run: false }),
    ).toMatchObject({ key: "a", running: false });
    expect((await tickOf("a").status()).running).toBe(false);

    await consolePortal().setLoop({ ...operator, service: "Tick", key: "a", run: true });
    expect((await tickOf("a").status()).running).toBe(true);
    loops = await loopsUntil((l) => one(l, "a")?.running === true);
    expect(one(loops, "a")?.running).toBe(true);
  });

  it("refuses a loop the read didn't list, and anyone but Wren's team", async () => {
    await expect(
      consolePortal().setLoop({ ...operator, service: "Tick", key: "never", run: true }),
    ).rejects.toThrow("no such loop");
    await expect(
      consolePortal().setLoop({
        viewer: { email: "amy@acme.test" },
        service: "Tick",
        key: "a",
        run: false,
      }),
    ).rejects.toThrow("that's for Wren's team");
    await expect(consolePortal().loops({ viewer: { demo: true } })).rejects.toThrow(
      "that's for Wren's team",
    );
    expect((await tickOf("a").status()).running).toBe(true);
  });
});
