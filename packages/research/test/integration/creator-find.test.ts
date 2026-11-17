/**
 * A Studio find on a real Postgres (WA-1416): one open find per input; the person rule (D4).
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  findById,
  findShown,
  openFind,
  personForFind,
  STALE_WHY,
  setFind,
  trackedOf,
} from "../../src/creator-find.js";
import { newPerson, trackCreator } from "../../src/creators.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() =>
  truncate(pg.db, [
    "creator_finds",
    "tracked_creators",
    "creator_people",
    "social_handles",
    "platform_objects",
  ]),
);
const db = () => pg.db;

describe("creator finds", () => {
  it("returns the open find for the same input; a done one opens a new find", async () => {
    const a = await openFind(db(), { input: "Dana  Reyes", niche: "biz", requestedBy: "test" });
    expect(a.opened).toBe(true);
    const b = await openFind(db(), { input: " dana reyes", niche: "biz", requestedBy: "test" });
    expect(b).toMatchObject({ opened: false, find: { id: a.find.id } });
    await setFind(db(), a.find.id, { state: "found", step: null });
    const c = await openFind(db(), { input: "Dana Reyes", niche: "biz", requestedBy: "test" });
    expect(c.opened).toBe(true);
    expect(c.find.id).not.toBe(a.find.id);
    expect((await findById(db(), a.find.id))?.state).toBe("found");
  });

  it("a finding find quiet for 10 minutes shows failed, and Try again opens a new one", async () => {
    const a = await openFind(db(), { input: "Dana Reyes", niche: "biz", requestedBy: "test" });
    await setFind(db(), a.find.id, { state: "waiting" });
    await db().execute(
      sql`update creator_finds set updated_at = now() - interval '11 minutes' where id = ${a.find.id}`,
    );
    // waiting is the Mac asleep: it stays open
    expect((await findShown(db(), a.find.id))?.state).toBe("waiting");
    expect(
      (await openFind(db(), { input: "dana reyes", niche: "biz", requestedBy: "t" })).opened,
    ).toBe(false);
    await db().execute(
      sql`update creator_finds set state = 'finding', updated_at = now() - interval '11 minutes' where id = ${a.find.id}`,
    );
    expect(await findShown(db(), a.find.id)).toMatchObject({ state: "failed", error: STALE_WHY });
    const b = await openFind(db(), { input: "Dana Reyes", niche: "biz", requestedBy: "test" });
    expect(b.opened).toBe(true);
    expect((await findById(db(), a.find.id))?.state).toBe("failed");
  });

  it("person: a passing hit's tracked person, else the named one, else new", async () => {
    const x = await trackCreator(db(), {
      platform: "x",
      handle: "danareyes",
      niches: ["biz"],
      addedBy: "test",
    });
    const passing = [
      { platform: "instagram", handle: "reyes" },
      { platform: "x", handle: "DanaReyes" },
    ];
    expect(await personForFind(db(), { name: "Dana Reyes", passing, addedBy: "test" })).toEqual({
      id: x.personId,
      how: "tracked",
    });
    expect((await trackedOf(db(), passing)).get("x:danareyes")?.id).toBe(x.id);

    const named = await newPerson(db(), { name: "Lena Reyes", addedBy: "test" });
    expect(
      await personForFind(db(), {
        name: "lena reyes",
        passing: [passing[0] as never],
        addedBy: "test",
      }),
    ).toEqual({ id: named.id, how: "named" });

    const fresh = await personForFind(db(), { name: "Sam Ortiz", passing: [], addedBy: "test" });
    expect(fresh.how).toBe("new");
    expect(fresh.id).not.toBe(named.id);
  });
});
