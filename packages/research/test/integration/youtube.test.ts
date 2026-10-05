/**
 * The youtube stage's dueness on a real Postgres: a fresh read is not due, a read kept before
 * `raw` was is, so old reads fill themselves in.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { youtubeDue, youtubeFindings } from "../../src/enrichment/youtube.js";
import { keepFinding } from "../../src/findings.js";
import { makeCompany } from "./fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["companies", "findings"]));
const db = () => pg.db;

const due = async (id: number) => {
  const [r] = await db().execute<{ due: boolean }>(sql`select ${youtubeDue(sql`${id}::int`)} due`);
  return r?.due;
};

describe("youtubeDue", () => {
  it("a fresh read or a missing link is not due; a read with no raw is", async () => {
    const firm = (k: string) => makeCompany(db(), { key: k, domain: `${k}.example` });
    const [read, missing, old] = [(await firm("a")).id, (await firm("b")).id, (await firm("c")).id];
    const channel = (raw: unknown) => ({
      id: "UCabcdefghijklmnopqrstuv",
      title: "T",
      handle: null,
      about: "",
      country: null,
      subscribers: null,
      videos: null,
      views: null,
      keywords: null,
      topics: [],
      publishedAt: null,
      uploads: null,
      raw,
    });
    const link = "https://www.youtube.com/@t";
    for (const f of youtubeFindings(read, link, { channel: channel({}), uploads: [] }))
      await keepFinding(db(), f);
    for (const f of youtubeFindings(missing, link, { missing: "no channel at this link" }))
      await keepFinding(db(), f);
    for (const f of youtubeFindings(old, link, { channel: channel({}), uploads: [] }))
      await keepFinding(db(), { ...f, factKey: `${f.factKey}:old` });
    await db().execute(sql`update findings set value = value - 'raw' where company_id = ${old}`);

    expect([await due(read), await due(missing), await due(old)]).toEqual([false, false, true]);
  });
});
