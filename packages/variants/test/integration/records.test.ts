/** The Batches list's rows stay blind on an open batch, for a person and for no one (WA-1455). Synthetic. */

import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { variants } from "../../src/index.js";
import { batchRecord } from "../../src/records.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

type Me = Parameters<NonNullable<ReturnType<typeof batchRecord>["rows"]>>[1];
const as = (email: string | null) => (email ? { email } : null) as unknown as Me;

describe("variants.batch rows", () => {
  it("hide the agent's reason and others' calls while open", async () => {
    const db = pg.db;
    const v = variants(db);
    await v.newSubject({ slug: "opener", name: "Opener email", kind: "text", by: "ana" });
    const b = await v.addBatch("opener", {
      title: "Two openers",
      why: "Named tool against a question",
      agent: "test",
      samples: [{ body: "Saw you use a CRM." }, { body: "Quick question?" }],
    });
    const [one, two] = b.samples as [number, number];
    await v.judge(one, "amazing", "ana@example.com");
    await v.judge(two, "bad", "bo@example.com");
    const t = batchRecord({ db, sign: null });
    const read = async (email: string | null) => {
      const rows = (await t.rows?.(db, as(email))) ?? [];
      const row = rows.find((r) => r.id === b.id);
      if (!row) throw new Error("no row");
      return row;
    };

    for (const email of ["ana@example.com", null]) {
      const row = await read(email);
      expect(row.state).toBe("waiting");
      expect(row.why).toBeNull();
      expect(row.goodRate).toBeNull();
      expect(row.judges).toBeNull();
      expect(row).not.toHaveProperty("tally");
    }
    // his own mark only, never bo's
    expect((await read("ana@example.com")).marked).toBe("1 of 2");
    expect((await read("ana@example.com")).yours).toBe("yes");
    expect((await read(null)).marked).toBe("0 of 2");

    await v.closeBatch(b.id, null, "ana@example.com");
    const closed = await read("ana@example.com");
    expect(closed.state).toBe("closed");
    expect(closed.why).toBe("Named tool against a question");
    // Vireo's own rate, over every sheet; shown once closed
    expect(closed.goodRate).not.toBeNull();
  });
});
