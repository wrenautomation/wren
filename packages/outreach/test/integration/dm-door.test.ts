/**
 * The DM door on Postgres (designs/2026-10-11-dm-door.md), synthetic comments only: a comment on
 * our own Instagram post takes one DM within 7 days, refused after, twice, or when they opted out;
 * once sent it holds their contact, the message and the touch.
 */
import { lookupTouches } from "@wren/core/touches";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { commentById, planPrivateReply, privateReplied } from "../../src/comments.js";
import { comments, reachContacts, reachMessages } from "../../src/schema.js";

const TABLES = ["touches", "social_handles", "comments", "reach_messages", "reach_contacts"];
const NOW = new Date("2026-10-11T15:00:00Z");
const DAY = 86_400_000;

let pg: TestPostgres;
const db = () => pg.db;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, TABLES);
});

async function contentComment(n: number, platform: "instagram" | "youtube", daysAgo: number) {
  const [c] = await db()
    .insert(comments)
    .values({
      platform,
      channel: "content",
      ref: `c${n}`,
      post: "p1",
      parent: "p1",
      kind: "post_reply",
      postTitle: "Invoice chasing",
      author: `reader${n}`,
      body: "How do I set this up?",
      url: `https://example.test/c${n}`,
      at: new Date(NOW.getTime() - daysAgo * DAY),
      raw: {},
      sort: "asked",
    })
    .returning({ id: comments.id });
  return c?.id ?? 0;
}

describe("dm door", () => {
  it("one private reply per comment within 7 days; contact, message and touch kept", async () => {
    const id = await contentComment(1, "instagram", 2);
    const c = await planPrivateReply(db(), id, NOW);
    const r = await privateReplied(db(), c, { body: "Here is the setup", ref: "m_1", now: NOW });
    const [msg] = await db().select().from(reachMessages).where(eq(reachMessages.id, r.messageId));
    expect(msg).toMatchObject({ state: "sent", ref: "m_1", body: "Here is the setup" });
    expect((await commentById(db(), id)).contactId).toBe(r.contactId);
    const seen = await lookupTouches(db(), "instagram:reader1");
    expect(seen?.touches.map((t) => [t.kind, t.direction])).toEqual([["dm", "ours"]]);
    await expect(planPrivateReply(db(), id, NOW)).rejects.toThrow("has a DM from us");
  });

  it("refuses after 7 days, without a door, and when they opted out", async () => {
    const old = await contentComment(2, "instagram", 8);
    await expect(planPrivateReply(db(), old, NOW)).rejects.toThrow("within 7 days");
    const yt = await contentComment(3, "youtube", 1);
    await expect(planPrivateReply(db(), yt, NOW)).rejects.toThrow("YouTube has no DMs");
    const stop = await contentComment(4, "instagram", 1);
    await db().insert(reachContacts).values({
      platform: "instagram",
      handle: "reader4",
      url: "https://www.instagram.com/reader4/",
      foundIn: "test",
      state: "opted_out",
    });
    await expect(planPrivateReply(db(), stop, NOW)).rejects.toThrow("asked us to stop");
  });
});
