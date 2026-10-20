/**
 * Scheduled comments on Postgres: drafted, queued comments on others' posts take spaced slots on
 * their platform's lane, never two inside the gap, under the day's cap, and a slot taken off the
 * schedule is no longer due. A failed slot is slotted again once, then skipped.
 */
import { resolveObjects } from "@wren/core/objects";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { COMMENTS_SETTINGS } from "../../src/reach-posts.js";
import { POST_PACE, schedulePosts, sendFailed, stillDue, unschedule } from "../../src/scheduled.js";
import { reachPosts } from "../../src/schema.js";

let pg: TestPostgres;
const db = () => pg.db;
// 2026-03-02 10:00 in Toronto.
const now = new Date("2026-03-02T15:00:00Z");
const settings = COMMENTS_SETTINGS.linkedin.parse({ account: "linkedin@wren", perDay: 3 });

beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, ["reach_posts"]);
  await resolveObjects(
    pg.db,
    [1, 2, 3, 4, 5, 6].map((n) => ({
      platform: "linkedin" as const,
      kind: "post" as const,
      raw: `urn:li:activity:${n}`,
    })),
  );
});

const row = (n: number, o: Partial<typeof reachPosts.$inferInsert> = {}) => ({
  platform: "linkedin" as const,
  ref: `urn:li:activity:${n}`,
  author: `Author ${n}`,
  text: `Post ${n}`,
  url: `https://example.com/${n}`,
  postedAt: new Date(now.getTime() - 3_600_000),
  foundBy: "topic: synthetic",
  account: "linkedin@wren",
  fit: 90 - n,
  state: "queued" as const,
  draft: `Draft ${n}`,
  queuedAt: now,
  raw: {},
  ...o,
});

describe("schedulePosts", () => {
  it("spaces drafted posts on the lane, a day's cap at a time", async () => {
    await db()
      .insert(reachPosts)
      .values([1, 2, 3, 4, 5].map((n) => row(n)));
    await db()
      .insert(reachPosts)
      .values(row(6, { draft: null }));
    const slots = await schedulePosts(db(), "linkedin", settings, { now, rand: () => 0 });
    expect(slots).toHaveLength(5);
    const at = slots.map((s) => new Date(s.at).getTime()).sort((a, b) => a - b);
    for (let i = 1; i < at.length; i++)
      expect((at[i] ?? 0) - (at[i - 1] ?? 0)).toBeGreaterThanOrEqual(POST_PACE.gapMinutes * 60_000);
    const day = (t: number) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: POST_PACE.zone }).format(new Date(t));
    expect(at.filter((t) => day(t) === day(at[0] ?? 0))).toHaveLength(3);
    // The best fit goes first; the undrafted one waits.
    const kept = await db().select().from(reachPosts);
    const first = kept.find((r) => r.ref === "urn:li:activity:1");
    expect(first?.sendAt?.getTime()).toBe(at[0]);
    expect(kept.find((r) => r.ref === "urn:li:activity:6")?.sendAt).toBeNull();
    // A second run adds nothing: every draft has its slot.
    expect(await schedulePosts(db(), "linkedin", settings, { now, rand: () => 0 })).toEqual([]);
  });

  it("a slot taken off the schedule is no longer due", async () => {
    await db().insert(reachPosts).values(row(1));
    const [s] = await schedulePosts(db(), "linkedin", settings, { now, rand: () => 0 });
    expect(s).toBeDefined();
    if (!s) return;
    expect(await stillDue(db(), "post", s.id, s.at)).toBe(true);
    await unschedule(db(), { posts: [Number(s.id)] });
    expect(await stillDue(db(), "post", s.id, s.at)).toBe(false);
  });

  it("a failed slot is slotted again once, then skipped", async () => {
    const [p] = await db().insert(reachPosts).values(row(1)).returning({ id: reachPosts.id });
    const id = p?.id ?? 0;
    const read = async () => (await db().select().from(reachPosts)).find((r) => r.id === id);
    await schedulePosts(db(), "linkedin", settings, { now, rand: () => 0 });
    expect(await sendFailed(db(), "post", String(id), "HTTP 426")).toBe("retry");
    expect(await read()).toMatchObject({ state: "queued", sendAt: null });
    expect(await schedulePosts(db(), "linkedin", settings, { now, rand: () => 0 })).toHaveLength(1);
    expect(await sendFailed(db(), "post", String(id), "HTTP 426")).toBe("skipped");
    expect(await read()).toMatchObject({ state: "skipped", stateReason: "send failed: HTTP 426" });
  });
});
