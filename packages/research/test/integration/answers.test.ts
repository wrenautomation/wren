import type { SiteClient } from "@wren/core/content";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { keepingAnswers } from "../../src/findings.js";
import { documents } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["documents"]));

describe("keepingAnswers", () => {
  it("keeps every read's whole answer once; writes are not reads", async () => {
    const raw = [{ url: "https://x.example", text: "no heading", score: 0.4 }];
    const sites: SiteClient = {
      call: async <T>() => ({ people: [], raw }) as T,
      via: async () => "api",
    };
    const kept = keepingAnswers(sites, pg.db);
    await kept.call("web", "GET", "/people", { q: "recruiters at Acme", n: 10 });
    await kept.call("web", "GET", "/people", { q: "recruiters at Acme", n: 10 });
    await kept.call("linkedin", "POST", "/messages", { to: "x" });

    const rows = await pg.db.select().from(documents);
    expect(rows.map((d) => [d.url, d.kind, d.fetchTier])).toEqual([
      ["autobrowse:web/people?q=recruiters+at+Acme&n=10", "snippet", "web"],
    ]);
    expect(JSON.parse(rows[0]?.text ?? "")).toMatchObject({ raw });
  });
});
