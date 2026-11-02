/**
 * Our follow lists as ours follow touches (designs/2026-10-22-drift-reconcile.md): a follow made
 * by hand on the site is kept once; a handle wren already follows is left alone; a handle the
 * list had before and has no more is counted, never deleted.
 */
import { recordTouch } from "@wren/core/touches";
import { socialHandles, touches } from "@wren/core/touches-schema";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FOLLOWING_SOURCE, keepFollowing } from "../../src/touches.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
}, 120_000);
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, ["touches", "social_handles"]);
});

const NOW = new Date("2026-10-22T12:00:00Z");
const row = (handle: string, at: string | null = null) => ({
  handle,
  name: `Name ${handle}`,
  url: null,
  at,
});
const follows = async () =>
  (
    await pg.db
      .select({ handle: socialHandles.handle, source: touches.source, at: touches.at })
      .from(touches)
      .innerJoin(socialHandles, eq(socialHandles.id, touches.handleId))
      .where(eq(touches.direction, "ours"))
      .orderBy(socialHandles.handle)
  ).map((r) => [r.handle, r.source, r.at.toISOString()]);

describe("keepFollowing", () => {
  it("keeps each unknown handle once, at the platform's time or the read time", async () => {
    const rows = [row("Sam_Synth", "2026-09-01T00:00:00Z"), row("@kim_synth"), row("sam_synth")];
    expect(await keepFollowing(pg.db, "x", rows, NOW)).toEqual({ added: 2, gone: 0 });
    expect(await keepFollowing(pg.db, "x", rows, NOW)).toEqual({ added: 0, gone: 0 });
    expect(await follows()).toEqual([
      ["kim_synth", FOLLOWING_SOURCE, NOW.toISOString()],
      ["sam_synth", FOLLOWING_SOURCE, "2026-09-01T00:00:00.000Z"],
    ]);
  });

  it("leaves a handle wren already follows from another writer", async () => {
    await recordTouch(pg.db, {
      platform: "x",
      handle: "sam_synth",
      kind: "follow",
      direction: "ours",
      account: "x@wren",
      at: new Date("2026-10-01T00:00:00Z"),
      source: "people",
      ref: "follow:x:sam_synth",
    });
    expect(await keepFollowing(pg.db, "x", [row("sam_synth")], NOW)).toEqual({
      added: 0,
      gone: 0,
    });
    expect(await follows()).toEqual([["sam_synth", "people", "2026-10-01T00:00:00.000Z"]]);
  });

  it("counts a listed handle the list no longer has, and deletes nothing", async () => {
    await keepFollowing(pg.db, "x", [row("sam_synth"), row("kim_synth")], NOW);
    expect(await keepFollowing(pg.db, "x", [row("kim_synth")], NOW)).toEqual({
      added: 0,
      gone: 1,
    });
    expect((await follows()).length).toBe(2);
  });

  it("keeps a YouTube channel id's case", async () => {
    const ch = "UCabcdefghijklmnopqrstuV";
    await keepFollowing(pg.db, "youtube", [row(ch)], NOW);
    expect((await follows())[0]?.[0]).toBe(ch);
  });
});
