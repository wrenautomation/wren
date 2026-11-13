/**
 * Captures on a real Postgres: one row per saved object and person, sources and lists merge on a
 * re-read, filed rows leave the queue, a row stops after 3 failures.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  captureCounts,
  keepSaved,
  MAX_ATTEMPTS,
  markFailed,
  markFiled,
  type Saved,
  unfiled,
} from "../../src/captures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["captures", "platform_objects"]));
const db = () => pg.db;

const reel = (code: string, lists: string[] = []): Saved => ({
  platform: "instagram",
  ref: code,
  url: `https://www.instagram.com/reel/${code}/`,
  author: "maker",
  at: new Date("2026-11-01T00:00:00Z"),
  lists,
  raw: { code },
});

describe("captures", () => {
  it("adds once, then merges lists and sources on a re-read", async () => {
    expect(
      await keepSaved(db(), "william", "instagram-saved", [reel("A", ["Edits"]), reel("B")]),
    ).toEqual({ read: 2, added: 2 });
    expect(
      await keepSaved(db(), "william", "instagram-saved", [
        reel("A", ["Hooks"]),
        reel("A", ["Edits"]),
      ]),
    ).toEqual({ read: 2, added: 0 });
    const rows = await unfiled(db(), "william", "instagram-saved", 10);
    expect(rows.map((r) => r.url)).toEqual([
      "https://www.instagram.com/reel/A/",
      "https://www.instagram.com/reel/B/",
    ]);
    expect(rows[0]?.lists.sort()).toEqual(["Edits", "Hooks"]);
    expect(await keepSaved(db(), "other", "instagram-saved", [reel("A")])).toEqual({
      read: 1,
      added: 1,
    });
  });

  it("files a row out of the queue and stops a row after the retry limit", async () => {
    await keepSaved(db(), "william", "instagram-saved", [reel("A"), reel("B")]);
    const [a, b] = await unfiled(db(), "william", "instagram-saved", 10);
    await markFiled(db(), a?.id as number, ["source-a"]);
    for (let i = 0; i < MAX_ATTEMPTS; i++) await markFailed(db(), b?.id as number, "read failed");
    expect(await unfiled(db(), "william", "instagram-saved", 10)).toEqual([]);
    expect(await captureCounts(db(), "william")).toEqual([
      { source: "instagram-saved", read: 2, filed: 1, waiting: 0, failed: 1 },
    ]);
  });

  it("reads nothing for an empty answer", async () => {
    expect(await keepSaved(db(), "william", "x-bookmarks", [])).toEqual({ read: 0, added: 0 });
  });
});
