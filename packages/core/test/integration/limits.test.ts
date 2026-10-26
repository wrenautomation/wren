/**
 * Limits on Postgres: the code's default holds until a row says otherwise; the Wren-wide row is
 * everyone's new default; a client's own row holds for that client only where the spend is its
 * own. A shared or Wren-only limit refuses a client row.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clients } from "../../src/clients/schema.js";
import {
  bucketOf,
  type LimitDef,
  limitOf,
  limitsView,
  setLimit,
  unsetLimit,
} from "../../src/limits.js";

const OWN: LimitDef = {
  name: "test.own",
  unit: "reads",
  why: "test",
  perDay: 40,
  burst: 10,
  scope: "client",
};
const POOL: LimitDef = { ...OWN, name: "test.pool", scope: "shared" };
const DAILY: LimitDef = { ...OWN, name: "test.daily", burst: null };
const DEFS = [OWN, POOL, DAILY];

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([{ id: "acme", name: "Acme", database: "wren_client_acme" }]);
});
afterAll(() => pg.stop());

describe("limits", () => {
  it("default, then Wren-wide, then the client's own", async () => {
    expect(await limitOf(pg.db, "acme", OWN)).toEqual({ perDay: 40, burst: 10 });
    await setLimit(pg.db, DEFS, { client: null, name: OWN.name, perDay: 80, by: "op" });
    // No burst given: the default's share of a day.
    expect(await limitOf(pg.db, null, OWN)).toEqual({ perDay: 80, burst: 20 });
    expect(await limitOf(pg.db, "acme", OWN)).toEqual({ perDay: 80, burst: 20 });
    const set = await setLimit(pg.db, DEFS, {
      client: "acme",
      name: OWN.name,
      perDay: 5,
      burst: 5,
      by: "op",
    });
    expect(set).toEqual({ before: null, after: { perDay: 5, burst: 5 } });
    expect(await limitOf(pg.db, "acme", OWN)).toEqual({ perDay: 5, burst: 5 });
    expect(await limitOf(pg.db, null, OWN)).toEqual({ perDay: 80, burst: 20 });
    const [view] = await limitsView(pg.db, "acme", [OWN]);
    expect(view).toMatchObject({ from: "client", wren: { perDay: 80 }, client: { perDay: 5 } });
    expect(await unsetLimit(pg.db, DEFS, { client: "acme", name: OWN.name })).toEqual({
      before: { perDay: 5, burst: 5 },
    });
    expect(await limitOf(pg.db, "acme", OWN)).toEqual({ perDay: 80, burst: 20 });
  });

  it("a shared limit takes the Wren-wide row only", async () => {
    await expect(
      setLimit(pg.db, DEFS, { client: "acme", name: POOL.name, perDay: 1, by: "op" }),
    ).rejects.toThrow("set it Wren-wide");
    await expect(unsetLimit(pg.db, DEFS, { client: "acme", name: POOL.name })).rejects.toThrow(
      "set it Wren-wide",
    );
    await setLimit(pg.db, DEFS, { client: null, name: POOL.name, perDay: 100, by: "op" });
    expect(await bucketOf(pg.db, "acme", POOL)).toEqual({ perDay: 100, burst: 25 });
  });

  it("a daily count has no burst; a bad number is refused", async () => {
    await expect(
      setLimit(pg.db, DEFS, { client: null, name: DAILY.name, perDay: 9, burst: 3, by: "op" }),
    ).rejects.toThrow("no burst");
    await setLimit(pg.db, DEFS, { client: null, name: DAILY.name, perDay: 9, by: "op" });
    expect(await limitOf(pg.db, null, DAILY)).toEqual({ perDay: 9, burst: null });
    expect(await bucketOf(pg.db, null, DAILY)).toEqual({ perDay: 9, burst: 9 });
    await expect(
      setLimit(pg.db, DEFS, { client: null, name: OWN.name, perDay: 1.5, by: "op" }),
    ).rejects.toThrow("whole number");
    await expect(
      setLimit(pg.db, DEFS, { client: null, name: "test.none", perDay: 1, by: "op" }),
    ).rejects.toThrow("no limit named");
  });
});
