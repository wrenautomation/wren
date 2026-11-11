/**
 * Wake triggers (migration 0353, designs/2026-11-01-loop-calls.md) on a real Postgres: a write
 * that changes no row wakes nothing; a changed row wakes its loop. Synthetic data only.
 */
import { listen } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveProfile, setTraits } from "../../src/profiles.js";
import { recordTouch } from "../../src/touches.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.close();
});

/** The notices one write sends, read after a short wait. */
async function heardOf(write: () => Promise<unknown>): Promise<string[]> {
  const heard: string[] = [];
  const l = await listen(pg.url, { wren_wake: (p) => heard.push(p) });
  try {
    await write();
    await new Promise((r) => setTimeout(r, 300));
    return heard;
  } finally {
    await l.close();
  }
}

describe("wake triggers", () => {
  it("wake segments on a changed trait, never on a write that changes nothing", async () => {
    const p = await resolveProfile(pg.db, [{ kind: "email", value: "wake@example.test" }], "t");
    if (!p) throw new Error("no profile");
    expect(await heardOf(() => setTraits(pg.db, p.id, { plan: "a" }, "t"))).toContain(
      "SegmentPass/fleet",
    );
    // migration 0379: no trigger wakes the old name
    const old = await pg.db.execute(
      sql`select tgname from pg_trigger where not tgisinternal and pg_get_triggerdef(oid) like '%Segments/%'`,
    );
    expect([...old]).toEqual([]);
    // The people map's sync shape: an upsert that finds every row as it is.
    expect(
      await heardOf(() => pg.db.execute(sql`update profile_traits set value = value`)),
    ).toEqual([]);
    expect(
      await heardOf(() =>
        pg.db.execute(sql`insert into profile_traits (profile_id, key, value, source)
          select profile_id, key, value, source from profile_traits on conflict do nothing`),
      ),
    ).toEqual([]);
  });

  it("wakes the touch feed on a new touch", async () => {
    const heard = await heardOf(() =>
      recordTouch(pg.db, {
        platform: "x",
        handle: "wake_synth",
        kind: "dm",
        direction: "theirs",
        at: new Date("2026-11-01T09:00:00Z"),
        source: "reach_messages",
        ref: "wake:1",
      }),
    );
    expect(heard).toContain("TouchToJourney/all");
  });
});
