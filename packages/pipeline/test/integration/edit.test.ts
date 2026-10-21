/**
 * Small shape edits on a real Postgres (designs/2026-10-19-business-map.md): the CLI's add-node,
 * connect and remove read the newest body, change it and save the next version. Every stored body
 * is metro now (HELD, C1 part 4), so a graph edit has nothing to edit: a metro newest is refused
 * with `ON_METRO`, and a graph newest (a database from before) saves a graph body, which is
 * refused with `CONVERT_FIRST`. The graph edits themselves are tested on the pure layer
 * (`src/edit.test.ts`). Synthetic data only.
 */
import { resolveProfile } from "@wren/core/profiles";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { edgeOf, editShape, ON_METRO, openOn, withNode } from "../../src/edit.js";
import type { ShapeNode } from "../../src/model.js";
import { journeys } from "../../src/schema.js";
import { CONVERT_FIRST, Refused, saveShape } from "../../src/store.js";
import { asMetro, seedGraph, shape, TRIGGERS } from "../fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const won: ShapeNode = { id: "won", kind: "step", name: "Won", action: "other", advance: [] };
const person = async (email: string) =>
  (await resolveProfile(pg.db, [{ kind: "email", value: email }], "test"))?.id as number;
const edit = (db: TestPostgres["db"], change: Parameters<typeof editShape>[1]["change"]) =>
  editShape(db, { change, note: "t", by: "t", triggers: TRIGGERS });
const reasons = (p: Promise<unknown>) =>
  p.then(
    () => [] as string[],
    (e) => (e instanceof Refused ? e.errors : Promise.reject(e)),
  );

describe("editShape", () => {
  it("refuses while no shape exists", async () => {
    await expect(edit(pg.db, (b) => b)).rejects.toThrow(/no shape yet/);
  });

  it("refuses a graph edit on a metro newest version", async () => {
    await saveShape(pg.db, { body: asMetro(shape()), note: "v1", by: "t", triggers: TRIGGERS });
    expect(
      await reasons(edit(pg.db, (b) => withNode(b, won, [edgeOf("standard", "won")]))),
    ).toEqual([ON_METRO]);
  });

  it("refuses a graph newest version: the edit is a graph body, and a graph body is refused", async () => {
    const own = await startTestPostgres();
    try {
      await seedGraph(own.db, shape());
      expect(
        await reasons(edit(own.db, (b) => withNode(b, won, [edgeOf("standard", "won")]))),
      ).toEqual([CONVERT_FIRST]);
    } finally {
      await own.stop();
    }
  });

  it("counts the open journeys on a node", async () => {
    const [a, b] = [await person("a@example.test"), await person("b@example.test")];
    await pg.db.insert(journeys).values([
      { profileId: a, version: 1, node: "booked", entry: "yt" },
      { profileId: b, version: 1, node: "booked", entry: "yt" },
    ]);
    expect(await openOn(pg.db, "booked")).toBe(2);
    expect(await openOn(pg.db, "yt")).toBe(0);
  });
});
