/**
 * The demo's sample project: only on the demo, nothing late or overdue for the
 * week it stays up, and reseeded once it's old enough to look stale.
 */
import { clients } from "@wren/core/clients";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, deliveryHome, engagements } from "../../src/index.js";
import { keepSampleFresh, SAMPLE_REFRESH_DAYS, seedSample } from "../../src/sample.js";

let pg: TestPostgres;
const TODAY = "2026-10-05";

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme Staffing", database: "wren_client_acme" },
    { id: "demo", name: "Northside Talent", database: "wren_client_demo", demo: true },
  ]);
});
afterAll(() => pg?.stop());

describe("the demo's sample", () => {
  it("is the demo's only", async () => {
    await expect(seedSample(pg.db, "acme", TODAY)).rejects.toThrow("the demo's only");
  });

  it("is seeded when missing, and nothing on it runs late before it's reseeded", async () => {
    expect(await keepSampleFresh(pg.db, TODAY)).toBe(true);
    for (const day of [TODAY, addDays(TODAY, SAMPLE_REFRESH_DAYS)]) {
      const [e] = (await deliveryHome(pg.db, "demo", { operator: false, today: day })).engagements;
      expect(e?.steps.map((s) => s.state)).toEqual(["done", "done", "now", "next"]);
      expect(e?.asks.filter((a) => !a.answeredAt)).toHaveLength(1);
      expect(e?.asks.some((a) => a.overdue)).toBe(false);
      expect(e?.updates.length).toBeGreaterThan(3);
      expect(e?.updates.flatMap((u) => u.comments.map((c) => c.fromWren))).toEqual([false, true]);
      expect(e?.deliverables.every((d) => d.status === "approved")).toBe(true);
      expect(e?.results.find((r) => r.key === "meetings")?.value).toBe(6);
    }
  });

  it("is left alone for a week, then reseeded from that day", async () => {
    const [before] = await pg.db.select().from(engagements);
    expect(await keepSampleFresh(pg.db, addDays(TODAY, SAMPLE_REFRESH_DAYS))).toBe(false);
    expect(await keepSampleFresh(pg.db, addDays(TODAY, SAMPLE_REFRESH_DAYS + 1))).toBe(true);
    const after = await pg.db.select().from(engagements);
    expect(after).toHaveLength(1);
    expect(after[0]?.startsOn).toBe(addDays(before?.startsOn ?? "", SAMPLE_REFRESH_DAYS + 1));
  });
});
