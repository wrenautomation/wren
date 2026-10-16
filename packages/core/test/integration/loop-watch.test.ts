/**
 * `LoopWatch` against a real Restate: a loop whose next call was killed is dead, woken once and
 * told once; a loop whose pass waits on a call Restate paused is stuck, told once and left alone.
 */
import * as restate from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { restateAdmin } from "../../src/console.js";
import { restateAdminPatch } from "../../src/dead-letters.js";
import {
  type Incident,
  LOOP_WATCH_KEY,
  type LoopHealth,
  type LoopWatchPass,
  loopHealth,
  makeLoopWatch,
} from "../../src/loop-watch.js";
import { makeLoopObject, type PassOutcome, setLastPass } from "../../src/restate/loop.js";
import { startTestRestate } from "../../src/testing.js";

const HOUR = 3_600_000;
const pass = async (ctx: restate.ObjectContext): Promise<PassOutcome<{ n: number }>> => {
  const outcome: PassOutcome<{ n: number }> = {
    stats: { n: 1 },
    error: null,
    failures: 0,
    // Due at once: a lost next call is dead as soon as the grace is up.
    delayMs: HOUR,
    now: new Date((await ctx.date.now()) - 2 * HOUR).toISOString(),
  };
  await setLastPass(ctx, outcome);
  return outcome;
};
const tick = makeLoopObject("Tick", pass);

/** A call that fails every try: Restate pauses it after one. */
const flaky = restate.service({
  name: "Flaky",
  handlers: {
    run: restate.handlers.handler(
      { retryPolicy: { maxAttempts: 1, onMaxAttempts: "pause" } },
      async (_ctx: restate.Context): Promise<void> => {
        throw new Error("down");
      },
    ),
  },
});
type FlakyApi = { run: (ctx: restate.Context) => Promise<void> };
const blocked = makeLoopObject("Blocked", async (ctx: restate.ObjectContext) => {
  await ctx.serviceClient<FlakyApi>({ name: "Flaky" }).run();
  return pass(ctx);
});

const notes: { title: string; body: string }[] = [];
const notifier = {
  name: "test",
  notify: async (title: string, body = "") => {
    notes.push({ title, body });
    return true;
  },
};

let env: RestateTestEnvironment;
let pg: TestPostgres;
const ingress = () => clients.connect(ingressOf({ restateIngressUrl: env.baseUrl() }));
const admin = () => restateAdmin(env.adminAPIBaseUrl());
type Watch = ReturnType<typeof makeLoopWatch>;
const watch = () => ingress().objectClient<Watch>({ name: "LoopWatch" }, LOOP_WATCH_KEY);
const check = () => watch().sync() as Promise<PassOutcome<LoopWatchPass>>;

beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [
      tick,
      flaky,
      blocked,
      makeLoopWatch({ main: pg.db, admin: async (q) => admin()(q), notifier }),
    ],
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});

/** Admin SQL lags the ingress a little: read until `ok` holds. */
async function until<T>(read: () => Promise<T>, ok: (t: T) => boolean): Promise<T> {
  for (let i = 0; ; i++) {
    const t = await read();
    if (ok(t) || i > 100) return t;
    await new Promise((r) => setTimeout(r, 100));
  }
}
const healthOf = (id: string) => async () =>
  (await loopHealth(admin(), new Date())).find((h) => h.id === id);
const is = (health: LoopHealth["health"]) => (h: LoopHealth | undefined) => h?.health === health;

describe("LoopWatch", () => {
  it("wakes a loop whose next call was killed, and tells it once", async () => {
    const t = ingress().objectClient<typeof tick>({ name: "Tick" }, "a");
    await t.start();
    await until(healthOf("Tick/a"), (h) => h?.nextAt != null);
    const [next] = await admin()(
      `SELECT id FROM sys_invocation WHERE target_service_name = 'Tick' AND status = 'scheduled'`,
    );
    await restateAdminPatch(env.adminAPIBaseUrl())(`/invocations/${String(next?.id)}/kill`);
    expect((await until(healthOf("Tick/a"), is("dead")))?.health).toBe("dead");

    notes.length = 0;
    const first = await check();
    expect(first.stats?.restart).toEqual([{ service: "Tick", key: "a" }]);
    expect(notes.map((n) => n.title)).toEqual(["1 loop had stopped: woken"]);
    expect((await until(healthOf("Tick/a"), is("alive")))?.health).toBe("alive");
    // The incident stays open, quiet, until the loop has been healthy an hour.
    const second = await check();
    expect(second.stats?.restart).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(second.stats?.incidents["Tick/a"]).toMatchObject<Partial<Incident>>({ restarts: 1 });
  });

  it("names a loop stuck behind a paused call, once, and never wakes it", async () => {
    const b = ingress().objectClient<typeof blocked>({ name: "Blocked" }, "b");
    await b.start();
    const stuck = await until(healthOf("Blocked/b"), is("stuck"));
    expect(stuck).toMatchObject({ health: "stuck", blocker: { target: "Flaky/run" } });

    notes.length = 0;
    const first = await check();
    expect(first.stats?.restart).toEqual([]);
    expect(notes.map((n) => n.title)).toEqual(["1 loop stuck behind a call"]);
    expect(notes[0]?.body).toContain("Blocked/b: waits on Flaky/run, paused");
    await check();
    expect(notes).toHaveLength(1);
  });
});
