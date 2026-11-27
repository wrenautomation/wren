// Schedules make runs (wren designs/2026-11-27-central-queue.md, phase 2), and a locked pulled
// service runs one row per key at a time.
import { startTestPostgres } from "@wren/db/testing";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, putSchedule, schedulePass, serveDoor } from "../../src/pg/index.js";

let sql: postgres.Sql;
let base = "";
let stop = async () => {};
beforeAll(async () => {
  const pg = await startTestPostgres();
  sql = postgres(pg.url, { max: 6, onnotice: () => {} });
  await migrate(sql);
  const door = await serveDoor({
    sql,
    pull: { pulled: ["CommandRun"], leaseMs: 5_000, locked: ["CommandRun"] },
  });
  base = door.url;
  stop = async () => {
    await door.close();
    await sql.end({ timeout: 5 });
    await pg.stop();
  };
}, 60_000);
afterAll(() => stop());

const rt = async (op: string, body: unknown) => {
  const r = await fetch(`${base}/rt/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await r.json()) as Record<string, unknown>;
};
type Call = { id: string; attempt: number; input: string };
const take = async (max = 4) =>
  (await rt("claim", { services: ["CommandRun"], max })).calls as Call[];

const job = {
  name: "capture",
  cron: "15 10 * * *",
  tz: "America/Toronto",
  service: "CommandRun",
  handler: "run",
  input: {},
  why: "test",
};
const runs = () =>
  sql<{ id: string; key: string; idem_key: string; status: string }[]>`
    SELECT id, key, idem_key, status FROM rt.invocations WHERE service = 'CommandRun' ORDER BY created_at`;
const backTo = (iso: string) =>
  sql`UPDATE rt.schedules SET last_tick = ${new Date(iso)} WHERE name = 'capture'`;

describe("schedules", () => {
  it("a new schedule waits for its next tick", async () => {
    await rt("register", { services: [{ name: "CommandRun", handlers: [{ name: "run" }] }] });
    await putSchedule(sql, job);
    expect(await schedulePass(sql, { now: new Date() })).toEqual([]);
    expect(await runs()).toEqual([]);
  });

  it("a due tick makes one run keyed by the job; a second pass makes none", async () => {
    await backTo("2026-11-26T15:15:00Z");
    const now = new Date("2026-11-27T15:16:00Z");
    const [a, b] = await Promise.all([schedulePass(sql, { now }), schedulePass(sql, { now })]);
    expect([...(a ?? []), ...(b ?? [])].map((r) => r.outcome)).toEqual(["run"]);
    expect(await schedulePass(sql, { now })).toEqual([]);
    const [r] = await runs();
    expect(r).toMatchObject({ key: "capture", idem_key: "2026-11-27T15:15:00.000Z" });
    const [c] = await take();
    expect(JSON.parse(Buffer.from((c as Call).input, "base64").toString())).toEqual({
      job: "capture",
      tick: "2026-11-27T15:15:00.000Z",
    });
  });

  it("a tick while a run is open is skipped, not stacked", async () => {
    await backTo("2026-11-26T15:15:00Z");
    const out = await schedulePass(sql, { now: new Date("2026-11-27T15:16:00Z") });
    expect(out.map((r) => r.outcome)).toEqual(["open"]);
    expect(await runs()).toHaveLength(1);
  });

  it("a held schedule skips its tick", async () => {
    await backTo("2026-11-27T15:15:00Z");
    const out = await schedulePass(sql, {
      now: new Date("2026-11-28T15:16:00Z"),
      held: async () => "paused by test",
    });
    expect(out.map((r) => r.outcome)).toEqual(["held"]);
    expect(await runs()).toHaveLength(1);
  });

  it("a locked pulled service runs one row per key at a time", async () => {
    const [open] = await sql<
      Call[]
    >`SELECT id, attempt FROM rt.invocations WHERE service = 'CommandRun'`;
    await rt("finish", { id: open?.id, attempt: open?.attempt, value: "" });
    const send = (key: string, n: number) =>
      sql`INSERT INTO rt.invocations (id, service, handler, key, exclusive, input)
        VALUES (${`inv_lock_${key}_${n}`}, 'CommandRun', 'run', ${key}, true, ${Buffer.from("{}")})`;
    await send("a", 1);
    await send("a", 2);
    await send("b", 1);
    const got = await take();
    expect(got.map((c) => c.id).sort()).toEqual(["inv_lock_a_1", "inv_lock_b_1"]);
    await rt("finish", { id: "inv_lock_a_1", attempt: 1, value: "" });
    expect((await take()).map((c) => c.id)).toEqual(["inv_lock_a_2"]);
  });
});
