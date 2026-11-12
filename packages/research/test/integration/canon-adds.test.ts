/**
 * The Add box's queue on a real Postgres: two drains never take one ask, a dead drain's lease
 * frees it, a repeat ask joins the open row, and an ask that keeps failing stops for a person.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimAdd,
  enqueueAdd,
  failAdd,
  finishAdd,
  listAdds,
  renewAdd,
  retryAdd,
} from "../../src/canon-adds.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const ASKER = "ana@example.com";
const expire = (id: number) =>
  pg.db.execute(
    sql`update canon_add_requests set lease_until = now() - interval '1 second' where id = ${id}`,
  );

describe("canon adds", () => {
  it("files each ask once across drains, and frees a dead drain's claim", async () => {
    const a = await enqueueAdd(pg.db, {
      what: "https://example.com/a",
      note: "first",
      askedBy: ASKER,
    });
    expect(a).toMatchObject({ state: "pending", person: "ana", note: "first" });
    // the same link again: one row, both notes
    const again = await enqueueAdd(pg.db, {
      what: "https://example.com/a",
      note: "second",
      askedBy: ASKER,
    });
    expect(again.id).toBe(a.id);
    expect(again.note).toBe("first\n\nsecond");
    await enqueueAdd(pg.db, { what: "https://example.com/b", askedBy: ASKER });

    const [x, y, z] = await Promise.all([
      claimAdd(pg.db, "mac"),
      claimAdd(pg.db, "box"),
      claimAdd(pg.db, "vps"),
    ]);
    const got = [x, y, z].filter(Boolean);
    expect(got).toHaveLength(2);
    expect(new Set(got.map((r) => r?.id)).size).toBe(2);

    const held = got.find((r) => r?.id === a.id);
    if (!held?.worker) throw new Error("a not claimed");
    expect(await renewAdd(pg.db, a.id, held.worker)).toBe(true);
    // the holder died: its lease runs out, another drain takes it
    await expire(a.id);
    const taken = await claimAdd(pg.db, "spare");
    expect(taken).toMatchObject({ id: a.id, worker: "spare", attempts: 2 });
    expect(await renewAdd(pg.db, a.id, held.worker)).toBe(false);
    await finishAdd(pg.db, a.id, "spare", ["web-example-a"]);

    const rows = await listAdds(pg.db);
    expect(rows.find((r) => r.id === a.id)).toMatchObject({
      state: "done",
      records: ["web-example-a"],
    });
  });

  it("stops after three tries, and Retry puts it back", async () => {
    const r = await enqueueAdd(pg.db, { what: "https://example.com/broken", askedBy: ASKER });
    for (let i = 1; i <= 3; i++) {
      const c = await claimAdd(pg.db, "mac");
      expect(c?.id).toBe(r.id);
      await failAdd(pg.db, r.id, "mac", `try ${i}: private video`);
    }
    expect(await claimAdd(pg.db, "mac")).toBeNull();
    const [failed] = (await listAdds(pg.db)).filter((x) => x.id === r.id);
    expect(failed).toMatchObject({ state: "failed", error: "try 3: private video" });

    expect(await retryAdd(pg.db, r.id)).toMatchObject({ state: "pending", attempts: 0 });
    expect((await claimAdd(pg.db, "mac"))?.id).toBe(r.id);
  });

  it("fails a claim that died on its last try", async () => {
    const r = await enqueueAdd(pg.db, { what: "https://example.com/kills", askedBy: ASKER });
    for (let i = 0; i < 3; i++) {
      expect((await claimAdd(pg.db, "mac"))?.id).toBe(r.id);
      await expire(r.id);
    }
    expect(await claimAdd(pg.db, "mac")).toBeNull();
    const [row] = (await listAdds(pg.db)).filter((x) => x.id === r.id);
    expect(row?.state).toBe("failed");
  });

  it("refuses what is neither a link nor a stored file", async () => {
    await expect(enqueueAdd(pg.db, { what: "file:///etc/passwd", askedBy: ASKER })).rejects.toThrow(
      /link/,
    );
  });
});
