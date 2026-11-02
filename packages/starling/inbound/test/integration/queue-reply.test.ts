/**
 * An approved reply the frequency cap holds: queued with the yes kept, out of To approve, taken
 * back once, droppable while it waits.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  askReply,
  campaignOfAsker,
  failReply,
  QUEUED_WHY,
  queuedReplies,
  queueReply,
  releaseReply,
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
const AMY = "amy@example.test";
const UNTIL = new Date("2026-10-06T13:00:00Z");

describe("queueReply", () => {
  it("queues a claimed reply: yes kept, gone from To approve, no second Approve", async () => {
    const row = await ask();
    expect(await settleReply(pg.db, row.id, "sent", AMY)).toBe(true);
    await queueReply(pg.db, row.id, UNTIL);
    expect(await waitingReplies(pg.db)).toEqual([]);
    expect(await settleReply(pg.db, row.id, "sent", AMY)).toBe(false);
    const taken = await releaseReply(pg.db, row.id);
    expect(taken).toMatchObject({ state: "sent", decidedBy: AMY, detail: null, sendAt: null });
  });

  it("says when it goes and why it waits", async () => {
    const row = await ask();
    await settleReply(pg.db, row.id, "sent", AMY);
    await queueReply(pg.db, row.id, UNTIL);
    const [queued] = await pg.db.select().from(inboxReplies).where(eq(inboxReplies.id, row.id));
    expect(queued).toMatchObject({
      state: "queued",
      decidedBy: AMY,
      sendAt: UNTIL,
      detail: QUEUED_WHY,
    });
  });

  it("lists the queued, the soonest to go first, and not the waiting", async () => {
    const later = await ask();
    const sooner = await ask();
    await ask();
    for (const r of [later, sooner]) await settleReply(pg.db, r.id, "sent", AMY);
    await queueReply(pg.db, later.id, new Date("2026-10-07T13:00:00Z"));
    await queueReply(pg.db, sooner.id, UNTIL);
    expect((await queuedReplies(pg.db)).map((r) => r.id)).toEqual([sooner.id, later.id]);
  });

  it("is taken back once: a second release gets nothing", async () => {
    const row = await ask();
    await settleReply(pg.db, row.id, "sent", AMY);
    await queueReply(pg.db, row.id, UNTIL);
    expect(await releaseReply(pg.db, row.id)).not.toBeNull();
    expect(await releaseReply(pg.db, row.id)).toBeNull();
  });

  it("can be dropped while it waits, and then is not released", async () => {
    const row = await ask();
    await settleReply(pg.db, row.id, "sent", AMY);
    await queueReply(pg.db, row.id, UNTIL);
    expect(await settleReply(pg.db, row.id, "dropped", "bo@example.test")).toBe(true);
    expect(await releaseReply(pg.db, row.id)).toBeNull();
    expect(await queuedReplies(pg.db)).toEqual([]);
    const [gone] = await pg.db.select().from(inboxReplies).where(eq(inboxReplies.id, row.id));
    expect(gone).toMatchObject({ state: "dropped", sendAt: null });
  });

  it("never moves a reply that was dropped, failed or never claimed", async () => {
    const dropped = await ask();
    await settleReply(pg.db, dropped.id, "dropped", AMY);
    await queueReply(pg.db, dropped.id, UNTIL);
    const failed = await ask();
    await settleReply(pg.db, failed.id, "sent", AMY);
    await failReply(pg.db, failed.id, "no route");
    await queueReply(pg.db, failed.id, UNTIL);
    const waiting = await ask();
    await queueReply(pg.db, waiting.id, UNTIL);
    for (const id of [dropped.id, failed.id, waiting.id])
      expect(await releaseReply(pg.db, id)).toBeNull();
    expect((await waitingReplies(pg.db)).map((r) => r.id)).toEqual([waiting.id]);
  });
});

describe("campaignOfAsker", () => {
  it("is the asking workflow; a person asking has none", () => {
    expect(campaignOfAsker("workflow:follow_up.touches/email4")).toBe("follow_up.touches");
    expect(campaignOfAsker("amy@example.test")).toBeNull();
  });
});
