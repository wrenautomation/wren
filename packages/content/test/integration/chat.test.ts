/**
 * Site chat (designs/2026-10-09-site-chat.md): a visitor's first message starts a thread and hands
 * back its key; the Inbox shows it waiting; our reply reaches the bubble's next read and answers it.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHAT_PER_HOUR, ChatRefusal, readChat, replyChat, say } from "../../src/chat/store.js";
import { optionsOf, partyOf, timelineOf } from "../../src/inbox/conversation.js";
import { inboxRecord } from "../../src/social/records.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
}, 240_000);
afterAll(() => pg?.stop());

const inbox = async () =>
  ((await inboxRecord.rows?.(pg.db)) ?? []).filter((r) => r.type === "chat");

describe("site chat", () => {
  it("starts a thread, shows in the Inbox, and carries our reply back", async () => {
    const first = await say(pg.db, {
      body: "Do you take new patients?",
      name: "Sam",
      contact: "Sam@Example.com",
      page: "https://acme.example/contact",
    });
    expect(first.started).toBe(true);
    expect(first.key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(first.lines.map((l) => [l.from, l.body])).toEqual([
      ["you", "Do you take new patients?"],
    ]);

    const [row] = await inbox();
    expect(row).toMatchObject({
      who: "Sam",
      state: "waiting",
      post_title: "https://acme.example/contact",
    });
    const thread = String(row?.id);

    const party = await partyOf(pg.db, thread);
    expect(party?.emails).toEqual(["sam@example.com"]);
    const options = await optionsOf(pg.db, party as NonNullable<typeof party>);
    expect(options[0]).toMatchObject({ channel: "chat", own: true, off: null });

    const id = Number(thread.slice("chat:".length));
    await replyChat(pg.db, id, "We do. Want a time this week?", "ann@acme.example");
    const lines = await readChat(pg.db, first.key, first.lines[0]?.id);
    expect(lines.map((l) => [l.from, l.body])).toEqual([["us", "We do. Want a time this week?"]]);
    expect((await inbox())[0]?.state).toBe("answered");

    const timeline = await timelineOf(pg.db, party as NonNullable<typeof party>);
    expect(timeline.map((e) => [e.channel, e.direction, e.who])).toEqual([
      ["chat", "in", "Sam"],
      ["chat", "out", "ann@acme.example"],
    ]);

    // Their next message keeps the thread and waits on us again.
    const again = await say(pg.db, { key: first.key, body: "Thursday?", after: lines[0]?.id });
    expect(again.started).toBe(false);
    expect(again.lines.map((l) => l.body)).toEqual(["Thursday?"]);
    expect((await inbox()).map((r) => r.state)).toEqual(["waiting"]);
  });

  it("refuses a bad key, an empty message, and a flood", async () => {
    await expect(readChat(pg.db, "nope", 0)).rejects.toBeInstanceOf(ChatRefusal);
    await expect(say(pg.db, { body: "  " })).rejects.toThrow(/Type a message/);
    const { key } = await say(pg.db, { body: "hi" });
    for (let i = 1; i < CHAT_PER_HOUR; i++) await say(pg.db, { key, body: `m${i}` });
    await expect(say(pg.db, { key, body: "one more" })).rejects.toMatchObject({ status: 429 });
  });
});
