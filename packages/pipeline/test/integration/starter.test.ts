/**
 * The starter on a real Postgres (designs/2026-10-19-business-map.md, "Seeds"): an empty database
 * takes it as version 1 with the note "Starter"; a database that has a shape is left alone.
 */
import { TRIGGER_IDS } from "@wren/core/logic";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isMetro } from "../../src/metro.js";
import { starterShape, startShape } from "../../src/starter.js";
import { newestShape, saveShape, shapeVersionsOf } from "../../src/store.js";
import { asMetro, shape } from "../fixtures.js";

let empty: TestPostgres;
let used: TestPostgres;
beforeAll(async () => {
  [empty, used] = await Promise.all([startTestPostgres(), startTestPostgres()]);
});
afterAll(() => Promise.all([empty.stop(), used.stop()]));

const start = (pg: TestPostgres) => startShape(pg.db, { by: "t", triggers: TRIGGER_IDS });

describe("startShape", () => {
  it("saves the starter as version 1 with the note Starter", async () => {
    const v = await start(empty);
    expect(v).toMatchObject({ number: 1, note: "Starter", createdBy: "t", parent: null });
    expect(v?.body).toEqual(starterShape().body);
    expect(v && isMetro(v.body)).toBe(true);
    expect(v?.depths.source).toBe(0);
  });

  it("does nothing the second time", async () => {
    expect(await start(empty)).toBeNull();
    expect(await shapeVersionsOf(empty.db)).toHaveLength(1);
  });

  it("leaves a database that has another shape alone", async () => {
    await saveShape(used.db, {
      body: asMetro(shape()),
      note: "Mine",
      by: "t",
      triggers: TRIGGER_IDS,
    });
    expect(await start(used)).toBeNull();
    expect((await newestShape(used.db))?.note).toBe("Mine");
  });
});
