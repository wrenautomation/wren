/** Ship two cuts to two pages, collect the page events, read rates by segment. Synthetic. */

import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { siteEvents, sitePages } from "@wren/sites/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { variants } from "../../src/index.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const PAGE_A = "00000000-0000-4000-8000-00000000000a";
const PAGE_B = "00000000-0000-4000-8000-00000000000b";

/** n views from one channel, `forms` of them sent the form. */
function views(page: string, channel: string, n: number, forms: number) {
  return Array.from({ length: n }, (_, i) => {
    const view = `${page.slice(-1)}-${channel}-${i}`;
    const base = { page, view, channel, at: new Date(Date.now() + 1000) };
    return i < forms
      ? [
          { ...base, name: "view" },
          { ...base, name: "form" },
        ]
      : [{ ...base, name: "view" }];
  }).flat();
}

describe("variants live", () => {
  it("keeps sources, ships, collects and ranks by segment", async () => {
    const db = pg.db;
    const v = variants(db);
    await v.newSubject({ slug: "hero", name: "Hero cut", kind: "video", by: "me" });
    await expect(
      v.addBatch("hero", {
        title: "Bad source",
        why: "bad source",
        samples: [{ body: "x", source: { ref: "studio:1", spans: [{ s: 3, e: 1 }] } }],
      }),
    ).rejects.toThrow(/source/);
    const b = await v.addBatch("hero", {
      title: "Two cold opens",
      why: "Long cold open vs straight start",
      agent: "test",
      samples: [
        { body: "cut a", source: { ref: "studio:1", spans: [{ s: 0, e: 4 }] } },
        {
          body: "cut b",
          source: {
            ref: "studio:1",
            spans: [
              { s: 6, e: 8 },
              { s: 0, e: 4 },
            ],
          },
        },
      ],
    });
    const [a, bb] = b.samples as [number, number];
    await db.insert(sitePages).values(
      [PAGE_A, PAGE_B].map((id, i) => ({
        id,
        slug: `hero-${i}`,
        title: `Hero ${i}`,
        kind: "lander",
        source: "data",
        previewToken: `t${i}`,
        createdBy: "me",
        updatedBy: "me",
      })),
    );
    const sa = await v.ship(a, { channel: "site", target: PAGE_A }, "me");
    await v.ship(bb, { channel: "site", target: PAGE_B }, "me");

    await db
      .insert(siteEvents)
      .values([
        ...views(PAGE_A, "outreach", 40, 12),
        ...views(PAGE_A, "organic", 40, 2),
        ...views(PAGE_B, "outreach", 40, 2),
        ...views(PAGE_B, "organic", 40, 2),
      ]);
    const got = await v.collect();
    expect(got.ships).toHaveLength(2);

    const f = await v.feedback("hero");
    expect(f.batches[0]?.samples.find((x) => x.id === bb)?.source?.spans).toHaveLength(2);
    expect(f.live.segments).toEqual(["all", "channel:organic", "channel:outreach"]);
    const row = (s: number, seg: string) =>
      f.live.rows.find((r) => r.sample === s && r.segment === seg);
    expect(row(a, "all")?.rates.forms?.wins).toBe(14);
    expect(row(a, "all")?.rates.forms?.of).toBe(80);
    // A wins on outreach, ties on organic
    expect(row(a, "channel:outreach")?.rates.forms?.pBest).toBeGreaterThan(0.95);
    const social = row(a, "channel:organic")?.rates.forms?.pBest ?? 0;
    expect(social).toBeGreaterThan(0.2);
    expect(social).toBeLessThan(0.8);

    await v.unship(sa.id, "me");
    await expect(v.unship(sa.id, "me")).rejects.toThrow(/no live ship/);
  });
});
