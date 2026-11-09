// Lanes (designs/2026-11-09-own-runtime.md, "Phase 3"): which rows a dispatcher takes, and the
// build each row pins to on first claim.
import { startTestPostgres } from "@wren/db/testing";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../src/pg/index.js";
import { claim, type Lane, nextDue, submit } from "../../src/pg/store.js";

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
