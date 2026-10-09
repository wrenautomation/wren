/**
 * Auto-reply on Postgres (designs/2026-10-09-auto-reply.md): modes per channel, the thread a
 * heard reply maps to, and when a draft on arrival skips. Synthetic threads (`../inbox-seed.ts`).
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { autoModes, draftable, setAutoMode, threadOfReply } from "../../src/inbox/auto.js";
import { askReply } from "../../src/inbox/send.js";
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
    expect(await autoModes(pg.db)).toEqual({
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
