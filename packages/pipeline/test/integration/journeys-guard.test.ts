/**
 * The guard in migration 0307 (designs/2026-10-19-business-map.md, "Migration in two steps"): the
 * legacy journey columns go only when every journey sits on a shape node and version, and no person
 * holds two open journeys. The guard runs here against `journeys` as migration 0306 left it, because
 * 0307 has already changed it in the test database. Synthetic data only.
 */
import { readFileSync } from "node:fs";
import { resolveProfile } from "@wren/core/profiles";
import type { Db } from "@wren/db";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { depthOf } from "../../src/model.js";
import { shapeVersions } from "../../src/schema.js";
import { shape } from "../fixtures.js";

const FILE = new URL("../../../db/drizzle/0307_journeys_guard.sql", import.meta.url);
const [GUARD = "", ...CHANGES] = readFileSync(FILE, "utf8").split("--> statement-breakpoint");

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  // The table as 0306 left it: the version under its old name, node and version nullable, and
  // no index that holds one open journey per person.
  await pg.db.execute(sql`alter table pipeline.journeys rename column version to shape_version`);
  await pg.db.execute(sql`alter table pipeline.journeys alter column node drop not null,
    alter column shape_version drop not null`);
  await pg.db.execute(sql`drop index pipeline.uq_journeys_open`);
  await pg.db.insert(shapeVersions).values({
    number: 1,
    body: shape(),
    run: shape(),
    depths: depthOf(shape()),
    note: "first",
    createdBy: "t",
  });
});
afterAll(() => pg.stop());

/** What Postgres said, not drizzle's wrapper. */
async function guard(db: Db = pg.db): Promise<string | null> {
  try {
    await db.execute(sql.raw(GUARD));
    return null;
  } catch (e) {
    return String((e as { cause?: { message?: string } }).cause?.message ?? e);
  }
}

const person = async (email: string) =>
  (await resolveProfile(pg.db, [{ kind: "email", value: email }], "test"))?.id as number;

const journey = (profile: number, over: { node?: string | null; version?: number | null } = {}) => {
  const node = over.node === undefined ? "engaged" : over.node;
  const version = over.version === undefined ? 1 : over.version;
  return pg.db.execute(sql`insert into pipeline.journeys (profile_id, shape_version, node, entry)
    values (${profile}, ${version}, ${node}, 'manual')`);
};

describe("the journeys guard", () => {
  it("is the first statement, and the changes follow it", () => {
    expect(GUARD.replace(/^(--.*\n)+/, "").startsWith("DO $$")).toBe(true);
    const text = CHANGES.join("\n");
    for (const part of [
      'DROP COLUMN "funnel"',
      'DROP COLUMN "stage"',
      'DROP COLUMN "version"',
      'RENAME COLUMN "shape_version" TO "version"',
      'ALTER COLUMN "node" SET NOT NULL',
      'ALTER COLUMN "version" SET NOT NULL',
      'CREATE UNIQUE INDEX "uq_journeys_open"',
      'DROP CONSTRAINT "uq_deals_journey"',
      'DROP CONSTRAINT "fk_journeys_funnel_version"',
    ])
      expect(text).toContain(part);
  });

  it("passes with no journeys", async () => {
    expect(await guard()).toBeNull();
  });

  it("raises for a journey with no node", async () => {
    await journey(await person("ada@example.test"), { node: null });
    expect(await guard()).toMatch(/1 row\(s\) have no shape node or version/);
  });

  it("raises for a journey with no shape version", async () => {
    await pg.db.execute(sql`delete from pipeline.journeys`);
    await journey(await person("bo@example.test"), { version: null });
    expect(await guard()).toMatch(/1 row\(s\) have no shape node or version/);
  });

  it("passes once every journey is placed", async () => {
    await pg.db.execute(sql`delete from pipeline.journeys`);
    await journey(await person("cy@example.test"));
    await journey(await person("di@example.test"));
    expect(await guard()).toBeNull();
  });

  it("raises for a person with two open journeys, not for a closed one", async () => {
    const ed = await person("ed@example.test");
    await journey(ed);
    await pg.db.execute(sql`insert into pipeline.journeys (profile_id, shape_version, node, entry, status)
      values (${ed}, 1, 'engaged', 'manual', 'done')`);
    expect(await guard()).toBeNull();
    await journey(ed);
    expect(await guard()).toMatch(/1 person\(s\) hold more than one open journey/);
  });
});
