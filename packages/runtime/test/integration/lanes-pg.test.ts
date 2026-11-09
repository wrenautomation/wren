// Lanes (designs/2026-11-09-own-runtime.md, "Phase 3"): which rows a dispatcher takes, and the
// build each row pins to on first claim.
import { startTestPostgres } from "@wren/db/testing";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../src/pg/index.js";
import {
  claim,
  type Lane,
  nextDue,
  release,
  renameService,
  setPgServices,
  submit,
} from "../../src/pg/store.js";

let sql: postgres.Sql;
let stop = async () => {};
beforeAll(async () => {
  const pg = await startTestPostgres();
  sql = postgres(pg.url, { max: 4, onnotice: () => {} });
  await migrate(sql);
  stop = async () => {
    await sql.end({ timeout: 5 });
    await pg.stop();
  };
}, 60_000);
afterAll(() => stop());

let n = 0;
const add = async (service: string, build: string | null = null) => {
  const id = `inv_lane${String(n++).padStart(22, "0")}`;
  await submit(sql, {
    id,
    service,
    handler: "h",
    key: null,
    input: new Uint8Array(),
    headers: {},
    idemKey: null,
    runAt: new Date(0),
  });
  if (build) await sql`UPDATE rt.invocations SET build = ${build} WHERE id = ${id}`;
  return id;
};
const take = (lane: Lane) => claim(sql, 50, 60_000, Date.now(), lane);

describe("lanes", () => {
  it("only / except split services", async () => {
    const a = await add("LaneA");
    const b = await add("LaneB");
    expect((await take({ only: [] })).length).toBe(0);
    expect(await nextDue(sql, { only: [] })).toBeNull();
    expect((await take({ only: ["LaneA"] })).map((c) => c.id)).toEqual([a]);
    expect((await take({ except: ["LaneA", "LaneC", "LaneD"] })).map((c) => c.id)).toEqual([b]);
  });

  it("the first claim pins the lane's build; a loose lane takes any build", async () => {
    const fresh = await add("LaneC");
    const old = await add("LaneC", "arn:1");
    const got = await take({ only: ["LaneC"], build: "arn:2" });
    expect(Object.fromEntries(got.map((c) => [c.id, c.build]))).toEqual({
      [fresh]: "arn:2",
      [old]: "arn:1",
    });
  });

  it("strict takes its own build and unpinned rows; fresh: false only its own", async () => {
    const mine = await add("LaneD", "b1");
    const other = await add("LaneD", "b0");
    const open = await add("LaneD");
    const closing = await take({ only: ["LaneD"], build: "b1", strict: true, fresh: false });
    expect(closing.map((c) => c.id)).toEqual([mine]);
    const live = await take({ only: ["LaneD"], build: "b2", strict: true });
    expect(live.map((c) => [c.id, c.build])).toEqual([[open, "b2"]]);
    const [row] = await sql<
      { status: string }[]
    >`SELECT status FROM rt.invocations WHERE id = ${other}`;
    expect(row?.status).toBe("pending");
  });
});

describe("rename", () => {
  it("open rows and state move to the new name, unpinned; done rows, clashing state and other services stay", async () => {
    const open = await add("OldName", "arn:1");
    const done = await add("OldName");
    await sql`UPDATE rt.invocations SET status = 'done' WHERE id = ${done}`;
    const other = await add("OtherName");
    await sql`INSERT INTO rt.state (service, key, name, value) VALUES
      ('OldName', 'k', 'a', '\\x01'), ('OldName', 'k', 'b', '\\x02'), ('NewName', 'k', 'b', '\\x03')`;
    await sql`INSERT INTO rt.handlers (service, handler, object, exclusive) VALUES ('OldName', 'h', true, true)`;
    expect(await renameService(sql, "OldName", "NewName", 60_000)).toEqual({ rows: 1, state: 1 });
    const rows = await sql<{ id: string; service: string; build: string | null }[]>`
      SELECT id, service, build FROM rt.invocations WHERE id IN (${open}, ${done}, ${other}) ORDER BY id`;
    expect(rows).toEqual([
      { id: open, service: "NewName", build: null },
      { id: done, service: "OldName", build: null },
      { id: other, service: "OtherName", build: null },
    ]);
    const state =
      await sql`SELECT service, name, value FROM rt.state WHERE key = 'k' ORDER BY service, name`;
    expect(state.map((r) => `${r.service}.${r.name}=${r.value[0]}`)).toEqual([
      "NewName.a=1",
      "NewName.b=3",
      "OldName.b=2",
    ]);
    expect((await sql`SELECT 1 FROM rt.handlers WHERE service = 'OldName'`).length).toBe(0);
    // held: an older slot's bridge can't take it before it sees it was superseded
    expect((await take({ only: ["NewName"] })).length).toBe(0);
    const later = await claim(sql, 50, 60_000, Date.now() + 61_000, { only: ["NewName"] });
    expect(later.map((c) => c.id)).toEqual([open]);
    expect(await renameService(sql, "OldName", "NewName")).toEqual({ rows: 0, state: 0 });
  });
});

describe("pg services", () => {
  it("a bridge lane with skipPg leaves the newest box's pg services alone", async () => {
    const onPg = await add("MovedSvc");
    const onRestate = await add("StaysSvc");
    await setPgServices(sql, ["MovedSvc"], "build-2");
    const got = (await take({ except: ["OtherSvc"], lock: false, skipPg: true })).map((c) => c.id);
    expect(got).toContain(onRestate);
    expect(got).not.toContain(onPg);
    await setPgServices(sql, [], "build-3");
    expect((await take({ only: ["MovedSvc"], skipPg: true })).map((c) => c.id)).toEqual([onPg]);
  });

  it("release gives a claim back unrun: pending, no failure, due after the delay; a stale attempt is refused", async () => {
    const id = await add("Throttled");
    const [c] = await take({ only: ["Throttled"] });
    expect(c?.id).toBe(id);
    expect(await release(sql, id, (c?.attempt ?? 0) + 1, 0)).toBe(false);
    expect(await release(sql, id, c?.attempt ?? 0, 60_000)).toBe(true);
    const [row] =
      await sql`SELECT status, failures, lease_until FROM rt.invocations WHERE id = ${id}`;
    expect(row).toMatchObject({ status: "pending", failures: 0, lease_until: null });
    expect((await take({ only: ["Throttled"] })).length).toBe(0);
    expect((await claim(sql, 5, 60_000, Date.now() + 50_000, { only: ["Throttled"] })).length).toBe(
      0,
    );
    await sql`UPDATE rt.invocations SET run_at = now() WHERE id = ${id}`;
    const [again] = await take({ only: ["Throttled"] });
    expect(again?.attempt).toBe((c?.attempt ?? 0) + 1);
  });
});
