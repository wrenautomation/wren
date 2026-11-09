// A loop on the Postgres runtime (designs/2026-11-09-own-runtime.md, "Phase 3") seen through the
// same admin SQL as Restate: the watchdog's health, a dead letter's failure and journal, kill, resume.
import { startTestPostgres } from "@wren/db/testing";
import type * as restate from "@wren/runtime";
import * as clients from "@wren/runtime/clients";
import {
  Dispatcher,
  migrate,
  postgres,
  Registry,
  register,
  runTurn,
  serveDoor,
} from "@wren/runtime/pg";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runtimeAdmin } from "../../src/console.js";
import { journalOf, pausedUnder } from "../../src/dead-letters.js";
import { loopHealth } from "../../src/loop-watch.js";
import { makeLoopObject, type PassOutcome, setLastPass } from "../../src/restate/loop.js";

const HOUR = 3_600_000;
const tock = makeLoopObject("Tock", async (ctx: restate.ObjectContext) => {
  const outcome: PassOutcome<{ n: number }> = {
    stats: { n: 1 },
    error: null,
    failures: 0,
    delayMs: HOUR,
    now: new Date(await ctx.date.now()).toISOString(),
  };
  await setLastPass(ctx, outcome);
  return outcome;
});

let sql: postgres.Sql;
let admin: ReturnType<typeof runtimeAdmin>;
let door: ReturnType<typeof clients.connect>;
let stop = async () => {};

beforeAll(async () => {
  const pg = await startTestPostgres();
  sql = postgres(pg.url, { max: 6, onnotice: () => {} });
  await migrate(sql);
  const registry = new Registry([tock] as never);
  await register(sql, registry);
  const log = () => {};
  const lane = new Dispatcher({
    sql,
    pollMs: 100,
    lane: { only: ["Tock"] },
    run: (c) => runTurn({ sql, registry, log }, c),
    log,
  });
  await lane.start();
  const d = await serveDoor({ sql });
  door = clients.connect({ url: d.url });
  // its own client: drizzle swaps the client's date serializers
  const main = postgres(pg.url, { max: 2, onnotice: () => {} });
  admin = runtimeAdmin(drizzle(main));
  stop = async () => {
    await d.close();
    await lane.stop();
    await main.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
    await pg.stop();
  };
}, 60_000);
afterAll(() => stop());

/** A paused call with a failed step, under a suspended parent waiting on it. */
async function pausedChild() {
  const [p] = await sql<{ id: string }[]>`
    INSERT INTO rt.invocations (id, service, handler, input, status, run_at)
    VALUES ('inv_parent' || md5(random()::text), 'Svc', 'outer', '', 'suspended', 'infinity')
    RETURNING id`;
  const parent = p?.id as string;
  await sql`INSERT INTO rt.journal (invocation_id, seq, kind, name) VALUES (${parent}, 0, 'call', 'Svc/inner')`;
  const [c] = await sql<{ id: string }[]>`
    INSERT INTO rt.invocations (id, service, handler, input, status, parent_id, parent_seq, failures, last_failure)
    VALUES ('inv_child' || md5(random()::text), 'Svc', 'inner', '', 'paused', ${parent}, 0, 3,
      '{"message":"boom","code":500}')
    RETURNING id`;
  const child = c?.id as string;
  await sql`INSERT INTO rt.journal (invocation_id, seq, kind, name, done, error)
    VALUES (${child}, 0, 'run', 'fetch', true, '{"message":"timed \\"out\\"","code":500}')`;
  return { parent, child };
}

describe("rt admin", () => {
  it("a running pg loop is alive with its next pass queued", async () => {
    await door.objectClient(tock, "k1").start(null);
    await expect
      .poll(
        async () => (await loopHealth(admin.query, new Date())).find((h) => h.id === "Tock/k1"),
        {
          timeout: 15_000,
        },
      )
      .toMatchObject({ health: "alive", why: "next pass queued" });
    const [h] = (await loopHealth(admin.query, new Date())).filter((x) => x.id === "Tock/k1");
    expect(Date.parse(h?.nextAt ?? "")).toBeGreaterThan(Date.now() + HOUR / 2);
  }, 30_000);

  it("a paused call: its failure, its journal, the parent that waits", async () => {
    const { parent, child } = await pausedChild();
    expect(await pausedUnder(admin.query)(parent)).toBe("Svc/inner: [500] boom");
    const journal = await journalOf(admin.query, child);
    expect(journal).toEqual([
      { index: 0, type: "run", name: "fetch", failure: '[500] timed "out"' },
    ]);
    const rows = await admin.query(
      `SELECT id, invoked_by, invoked_by_target, modified_at FROM sys_invocation WHERE id = '${child}'`,
    );
    expect(rows[0]).toMatchObject({ invoked_by: "service", invoked_by_target: "Svc/outer" });
    expect(Number.isNaN(Date.parse(String(rows[0]?.modified_at)))).toBe(false);
  });

  it("resume runs a paused call again; kill ends it and wakes its parent", async () => {
    const { parent, child } = await pausedChild();
    await admin.patch(`/invocations/${child}/resume?deployment=latest`);
    const [r] = await sql<{ status: string; failures: number }[]>`
      SELECT status, failures FROM rt.invocations WHERE id = ${child}`;
    expect(r).toEqual({ status: "pending", failures: 0 });
    await admin.patch(`/invocations/${child}/kill`);
    const [k] = await sql<
      { status: string }[]
    >`SELECT status FROM rt.invocations WHERE id = ${child}`;
    expect(k?.status).toBe("killed");
    const [j] = await sql<{ done: boolean; error: { code: number } }[]>`
      SELECT done, error FROM rt.journal WHERE invocation_id = ${parent} AND seq = 0`;
    expect(j).toMatchObject({ done: true, error: { code: 409 } });
    const [p] = await sql<
      { status: string }[]
    >`SELECT status FROM rt.invocations WHERE id = ${parent}`;
    expect(p?.status).toBe("pending");
  });

  it("a query only Restate answers gives no pg rows; an id pg doesn't hold goes to Restate", async () => {
    expect(await admin.query("SELECT id FROM sys_deployment")).toEqual([]);
    await expect(admin.patch("/invocations/inv_nothere/kill")).rejects.toThrow(/no runtime holds/);
  });
});
