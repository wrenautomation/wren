/**
 * Auto-reply on Postgres (designs/2026-10-09-auto-reply.md): modes per channel, the thread a
 * heard reply maps to, and when a draft on arrival skips. Synthetic threads (`../inbox-seed.ts`).
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { autoModes, draftable, setAutoMode, threadOfReply } from "../../src/inbox/auto.js";
import { reviewHow, reviewOf } from "../../src/inbox/review.js";
import { askReply } from "../../src/inbox/send.js";
import { reviewRecord } from "../../src/social/review-record.js";
import { keepReviews } from "../../src/social/store.js";
import { INBOX_TABLES, type InboxSeed, seedInbox } from "../inbox-seed.js";

let pg: TestPostgres;
let s: InboxSeed;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, ["auto_replies", ...INBOX_TABLES]);
  s = await seedInbox(pg.db);
});

describe("modes", () => {
  it("defaults to Suggest, saves one per channel, refuses an unknown", async () => {
    expect(await autoModes(pg.db)).toMatchObject({
      email: "suggest",
      text: "suggest",
      dm: "suggest",
      comment: "suggest",
    });
    await setAutoMode(pg.db, "text", "off", "admin@example.test");
    await setAutoMode(pg.db, "text", "auto", "admin@example.test");
    expect((await autoModes(pg.db)).text).toBe("auto");
    await expect(setAutoMode(pg.db, "fax", "off", "x")).rejects.toThrow("no channel");
    await expect(setAutoMode(pg.db, "dm", "loud", "x")).rejects.toThrow("no mode");
  });
});

describe("threads", () => {
  it("maps a heard reply to its Inbox thread", async () => {
    expect(await threadOfReply(pg.db, "sms", s.smsOtherId)).toBe(`text:${s.smsOtherId}`);
    expect(await threadOfReply(pg.db, "dm", s.reachId)).toBe(`dm:${s.reachId}`);
    expect(await threadOfReply(pg.db, "email", s.enrollmentId)).toBe(`reply:${s.replyId}`);
    expect(await threadOfReply(pg.db, "email", 999_999)).toBeNull();
  });
});

describe("draftable", () => {
  const thread = () => `text:${s.smsOtherId}`;

  it("drafts on their unanswered message, on its own channel", async () => {
    const at = await draftable(pg.db, thread());
    expect("option" in at && at.option.channel).toBe("text");
  });

  it("skips when a reply already waits", async () => {
    const at = await draftable(pg.db, thread());
    if (!("option" in at)) throw new Error(at.skip);
    await askReply(pg.db, {
      thread: thread(),
      option: at.option,
      body: "Yes, Saturdays.",
      who: at.who,
      by: "auto",
      why: null,
    });
    expect(await draftable(pg.db, thread())).toEqual({ skip: "a reply already waits" });
  });

  it("skips when we answered last, or they opted out", async () => {
    await pg.db.execute(sql`insert into sms_messages (contact_id, direction, kind, to_e164, body,
        state, provider_id, sent_at, created_at)
      values (${s.smsOtherId}, 'out', 'manual', '+15555550177', 'We do.', 'sent', 'auto-test-1',
        now(), now())`);
    expect(await draftable(pg.db, thread())).toEqual({ skip: "we answered already" });
    await pg.db.execute(sql`insert into sms_messages (contact_id, direction, kind, to_e164, body,
        state, received_at, created_at)
      values (${s.smsOtherId}, 'in', 'inbound', '+15555550100', 'STOP', 'received',
        now() + interval '1 minute', now() + interval '1 minute')`);
    expect(await draftable(pg.db, thread())).toEqual({ skip: "they opted out" });
  });
});

describe("reviews", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  const keep = () =>
    keepReviews(
      pg.db,
      "google_business",
      [
        {
          id: "accounts/1/locations/2/reviews/a",
          postId: "accounts/1/locations/2",
          author: "Jordan Lee",
          text: "2/5 stars. Showed up late.",
          stars: 2,
          at: "2026-10-08T10:00:00Z",
        },
        {
          id: "accounts/1/locations/2/reviews/b",
          postId: "accounts/1/locations/2",
          author: "Priya Shah",
          text: "5/5 stars, no words.",
          stars: 5,
          at: "2026-10-08T11:00:00Z",
          repliedWith: "Thanks, Priya!",
        },
      ],
      now,
    );

  it("keeps stars, counts an owner's reply as answered, and drafts only the open one", async () => {
    const kept = await keep();
    expect(kept).toHaveLength(2);
    const [late, happy] = kept;
    const r = await reviewOf(pg.db, late?.id ?? null);
    expect(r).toEqual({ stars: 2, words: true });
    expect(reviewHow(r as never)).toMatch(/without admitting fault/);
    expect(await reviewOf(pg.db, happy?.id ?? null)).toEqual({ stars: 5, words: false });
    expect("option" in (await draftable(pg.db, `comment:${late?.id}`))).toBe(true);
    expect(await draftable(pg.db, `comment:${happy?.id}`)).toEqual({
      skip: "we answered already",
    });
    const rows = (await reviewRecord.rows?.(pg.db)) ?? [];
    expect(rows.map((x) => [x.who, x.stars, x.reply])).toEqual([
      ["Priya Shah", 5, "replied"],
      ["Jordan Lee", 2, "none"],
    ]);
  });
});
