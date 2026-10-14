/** An approved reply the frequency cap holds keeps its place in To approve. */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  askReply,
  failReply,
  holdReply,
  settleReply,
  waitingReplies,
} from "../../src/inbox/send.js";
import { inboxReplies } from "../../src/schema.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() => truncate(pg.db, ["inbox_replies"]));

const ask = () =>
  askReply(pg.db, {
    thread: "outbound:7",
    option: { channel: "email", target: "thread:7" } as Parameters<typeof askReply>[1]["option"],
    body: "Still worth a call?",
    who: "Jane",
    by: "workflow:follow_up/n1",
    why: "Follow-up's email: it sends once someone says yes.",
  });

describe("holdReply", () => {
  it("puts a claimed reply back to waiting with why, and a second Approve can take it", async () => {
    const row = await ask();
    expect(await settleReply(pg.db, row.id, "sent", "amy@example.test")).toBe(true);
    expect(await waitingReplies(pg.db)).toEqual([]);
    await holdReply(pg.db, row.id, "Held by the frequency cap until 2026-10-06 13:00 UTC.");
    const [kept] = await waitingReplies(pg.db);
    expect(kept).toMatchObject({
      id: row.id,
      state: "waiting",
      why: "Held by the frequency cap until 2026-10-06 13:00 UTC.",
      decidedBy: null,
      decidedAt: null,
    });
    expect(await settleReply(pg.db, row.id, "sent", "amy@example.test")).toBe(true);
  });

  it("never revives a reply that was dropped or failed", async () => {
    const dropped = await ask();
    await settleReply(pg.db, dropped.id, "dropped", "amy@example.test");
    await holdReply(pg.db, dropped.id, "held");
    const failed = await ask();
    await settleReply(pg.db, failed.id, "sent", "amy@example.test");
    await failReply(pg.db, failed.id, "no route");
    await holdReply(pg.db, failed.id, "held");
    const rows = await pg.db
      .select()
      .from(inboxReplies)
      .where(eq(inboxReplies.thread, "outbound:7"));
    expect(rows.map((r) => r.state).sort()).toEqual(["dropped", "failed"]);
  });
});
