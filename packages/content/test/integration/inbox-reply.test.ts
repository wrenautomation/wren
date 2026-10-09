/**
 * Reply from the Inbox against Postgres and a Restate test environment, over a fake channel
 * sender and synthetic threads (designs/2026-10-07-inbox-reply.md): one conversation across
 * channels, the channels a reply can take, Send for an admin and Ask to send for an operator, a
 * yes from To approve, notes with mentions, assign, close and snooze.
 */
import type { Context } from "@restatedev/restate-sdk";
import * as clients from "@restatedev/restate-sdk-clients";
import type { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import { ingressOf } from "@wren/config";
import { startTestRestate } from "@wren/core/testing";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { FakeLlm } from "@wren/llm";
import { mentionRecord } from "@wren/notes/records";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  askFollowEmail,
  conversationOf,
  pickOption,
  type ReplySender,
  setThread,
} from "../../src/inbox/index.js";
import { makeInboxDesk } from "../../src/restate/inbox-desk.js";
import { approvalRecord, inboxRecord } from "../../src/social/records.js";
import { INBOX_TABLES, type InboxSeed, seedInbox } from "../inbox-seed.js";

/** What the fake channels were asked to send. */
const sent: { channel: string; id: number; body: string }[] = [];
/** Each send journaled once, as the real desks' calls are, so a replay doesn't send again. */
const fake = (ctx: Context): ReplySender => {
  const push = (channel: string) => async (id: number, body: string) => {
    await ctx.run(`send ${channel}`, async () => {
      sent.push({ channel, id, body });
    });
  };
  return {
    dm: push("dm"),
    text: push("text"),
    comment: push("comment"),
    invite: push("invite"),
    email: push("email"),
    thread: push("thread"),
    chat: push("chat"),
    mail: push("mail"),
  };
};
const llm = new FakeLlm({
  respond: (prompt) =>
    JSON.stringify({
      draft: prompt.includes("Spanish") ? "Yes, it can answer in Spanish." : "Happy to help.",
    }),
});

let pg: TestPostgres;
let env: RestateTestEnvironment;
let s: InboxSeed;
beforeAll(async () => {
  pg = await startTestPostgres();
  env = await startTestRestate({
    services: [makeInboxDesk({ db: pg.db, llm, senderName: "Will", channels: fake })],
    alwaysReplay: true,
  });
});
afterAll(async () => {
  await env?.stop();
  await pg?.stop();
});
beforeEach(async () => {
  await truncate(pg.db, [...INBOX_TABLES]);
  sent.length = 0;
  s = await seedInbox(pg.db);
});

const desk = () =>
  clients
    .connect(ingressOf({ restateIngressUrl: env.baseUrl() }))
    .serviceClient<ReturnType<typeof makeInboxDesk>>({ name: "InboxDesk" });
const as = (email: string) => ({ viewer: { email } });
const rowOf = async (id: string) =>
  ((await inboxRecord.rows?.(pg.db)) ?? []).find((r) => r.id === id);

describe("the conversation", () => {
  it("reads every channel with the person, oldest first, with where a reply can go", async () => {
    const c = await conversationOf(pg.db, `text:${s.smsId}`);
    expect(c?.who).toBe("Dana Rivera");
    const channels = new Set(c?.entries.map((e) => e.channel));
    for (const ch of ["email", "text", "dm", "comment", "booking", "touch"])
      expect(channels).toContain(ch);
    const at = c?.entries.map((e) => e.at) ?? [];
    expect([...at].sort()).toEqual(at);
    expect(c?.entries.at(-1)).toMatchObject({ channel: "text", direction: "in" });
    // Its own channel first; text the other person never shows.
    expect(c?.options[0]).toMatchObject({ channel: "text", target: String(s.smsId), own: true });
    expect(c?.options.map((o) => o.channel).sort()).toEqual(["dm", "email", "text"]);
    expect(c?.options.find((o) => o.channel === "email")?.target).toBe(`reply:${s.replyId}`);
  });

  it("finds the person behind a comment by their handle, and offers the comment first", async () => {
    const c = await conversationOf(pg.db, `comment:${s.commentId}`);
    expect(c?.personId).toBe(s.personId);
    expect(c?.options[0]).toMatchObject({ channel: "comment", own: true });
    expect(c?.entries.some((e) => e.channel === "text")).toBe(true);
  });

  it("refuses a target that isn't the thread's person, and an opted-out one", async () => {
    await expect(
      pickOption(pg.db, `text:${s.smsId}`, "text", String(s.smsOtherId)),
    ).rejects.toThrow(/can't be reached/);
    await pg.db.execute(sql`update sms_contacts set state = 'opted_out' where id = ${s.smsId}`);
    await expect(pickOption(pg.db, `text:${s.smsId}`, "text", String(s.smsId))).rejects.toThrow(
      /STOP/,
    );
  });
});

describe("status", () => {
  it("follows the channel, keeps a close, and opens again when they write", async () => {
    const id = `text:${s.smsId}`;
    expect(await rowOf(id)).toMatchObject({ status: "open", assignee: null });
    await setThread(pg.db, id, { status: "closed" }, s.admin);
    expect((await rowOf(id))?.status).toBe("closed");
    await pg.db.execute(sql`insert into sms_messages (contact_id, direction, kind, to_e164, body,
      state, received_at, created_at) values (${s.smsId}, 'in', 'inbound', '+15555550100',
      'One more thing', 'received', now() + interval '1 minute', now())`);
    expect((await rowOf(id))?.status).toBe("open");
  });
});

describe("InboxDesk", () => {
  const thread = () => `text:${s.smsId}`;
  const reply = (email: string, body = "Yes, Spanish works.") =>
    desk().reply({
      thread: thread(),
      channel: "text",
      target: String(s.smsId),
      body,
      ...as(email),
    });

  it("sends an admin's reply on the thread's own channel, then it waits on them", async () => {
    expect(await reply(s.admin)).toEqual({ sent: true, asked: null, why: null });
    expect(sent).toEqual([{ channel: "text", id: s.smsId, body: "Yes, Spanish works." }]);
    expect((await rowOf(thread()))?.status).toBe("waiting");
  });

  it("switches channel: the same person by email instead", async () => {
    await desk().reply({
      thread: thread(),
      channel: "email",
      target: `reply:${s.replyId}`,
      body: "Sending details by email.",
      ...as(s.admin),
    });
    expect(sent).toEqual([{ channel: "email", id: s.replyId, body: "Sending details by email." }]);
  });

  it("asks for an operator, sends on an admin's yes, once", async () => {
    const out = await reply(s.operator);
    expect(out.sent).toBe(false);
    expect(sent).toEqual([]);
    const id = out.asked as number;
    const waiting = ((await approvalRecord.rows?.(pg.db)) ?? []).find(
      (r) => r.id === `reply:${id}`,
    );
    expect(waiting).toMatchObject({ type: "reply", state: "waiting", body: "Yes, Spanish works." });
    // Shown in the conversation as waiting for a yes.
    const c = await conversationOf(pg.db, thread());
    expect(c?.entries.at(-1)).toMatchObject({ state: "asked", direction: "out" });

    await expect(desk().approve({ id, ...as(s.operator) })).rejects.toThrow();
    expect(sent).toEqual([]);
    await desk().approve({ id, ...as(s.admin) });
    expect(sent).toEqual([{ channel: "text", id: s.smsId, body: "Yes, Spanish works." }]);
    await expect(desk().approve({ id, ...as(s.admin) })).rejects.toThrow(/sent already/);
    expect(sent).toHaveLength(1);
  });

  it("drops an asked reply: nothing sends", async () => {
    const { asked } = await desk().ask({
      thread: thread(),
      channel: "text",
      target: String(s.smsId),
      body: "Maybe later.",
      ...as(s.operator),
    });
    expect(await desk().drop({ id: asked, ...as(s.admin) })).toEqual({ dropped: true });
    await expect(desk().approve({ id: asked, ...as(s.admin) })).rejects.toThrow(/dropped/);
    expect(sent).toEqual([]);
  });

  it("refuses an empty reply and a stranger's number", async () => {
    await expect(reply(s.admin, "  ")).rejects.toThrow(/empty/);
    await expect(
      desk().reply({
        thread: thread(),
        channel: "text",
        target: String(s.smsOtherId),
        body: "hi",
        ...as(s.admin),
      }),
    ).rejects.toThrow(/can't be reached/);
    expect(sent).toEqual([]);
  });

  it("suggests words from the conversation; nothing sends", async () => {
    const { text } = await desk().suggest({
      thread: thread(),
      channel: "text",
      target: String(s.smsId),
      ...as(s.operator),
    });
    expect(text).toBe("Yes, it can answer in Spanish.");
    expect(sent).toEqual([]);
  });

  it("keeps a note with a mention, never sent, in the timeline and the teammate's Mentions", async () => {
    const out = await desk().note({
      thread: thread(),
      body: "@alex@wren.example.test can you check Spanish voices? @stranger@else.example.test",
      ...as(s.admin),
    });
    expect(out.mentioned).toEqual([s.operator]);
    expect(sent).toEqual([]);
    const c = await conversationOf(pg.db, `reply:${s.replyId}`);
    expect(c?.entries.find((e) => e.channel === "note")).toMatchObject({
      direction: "note",
      who: s.admin,
    });
    const mine = await mentionRecord.rows?.(pg.db, { email: s.operator, team: true });
    expect(mine?.[0]).toMatchObject({ place: "inbox", state: "unread", thread: thread() });
  });

  it("assigns to a teammate only, closes, snoozes and wakes", async () => {
    await desk().assign({ thread: thread(), assignee: s.operator, ...as(s.admin) });
    expect((await rowOf(thread()))?.assignee).toBe(s.operator);
    await expect(
      desk().assign({ thread: thread(), assignee: "nobody@else.example.test", ...as(s.admin) }),
    ).rejects.toThrow(/not on the team/);
    await desk().take({ thread: thread(), ...as(s.admin) });
    expect((await rowOf(thread()))?.assignee).toBe(s.admin);
    await desk().status({ thread: thread(), status: "closed", ...as(s.admin) });
    expect((await rowOf(thread()))?.status).toBe("closed");
    const until = new Date(Date.now() + 3_600_000).toISOString();
    await desk().snooze({ thread: thread(), until, ...as(s.operator) });
    expect((await rowOf(thread()))?.status).toBe("snoozed");
    await desk().status({ thread: thread(), status: "open", ...as(s.operator) });
    expect((await rowOf(thread()))?.status).toBe("open");
  });
});

describe("a follow-up's email", () => {
  /** Dana never wrote back by email, and the sequence is done. */
  const quiet = async () => {
    await pg.db.execute(sql`delete from call_bookings`);
    await pg.db.execute(sql`delete from thread_events`);
    await pg.db.execute(
      sql`update enrollments set state = 'finished', stop_reason = null, stopped_at = null`,
    );
  };
  const ask = (subject: string) =>
    askFollowEmail(pg.db, {
      subject,
      enrollmentId: s.enrollmentId,
      body: "Still worth a call?",
      by: "workflow:follow_up.touches/email4",
      why: "Follow-up's email: it sends once someone says yes.",
    });

  it("waits in To approve on their text thread, once; a yes sends it in our email thread", async () => {
    await quiet();
    expect(await ask(`lead:sms:${s.smsId}`)).toEqual({ asked: true, why: null });
    expect(await ask(`lead:sms:${s.smsId}`)).toEqual({ asked: false, why: "already asked" });
    const rows = ((await approvalRecord.rows?.(pg.db)) ?? []).filter((r) => r.type === "reply");
    expect(rows).toEqual([
      expect.objectContaining({
        platform: "email",
        body: "Still worth a call?",
        url: `/inbox/waiting/${encodeURIComponent(`text:${s.smsId}`)}`,
      }),
    ]);
    const id = Number(String(rows[0]?.id).slice("reply:".length));
    await desk().approve({ id, ...as(s.admin) });
    expect(sent).toEqual([{ channel: "thread", id: s.enrollmentId, body: "Still worth a call?" }]);
  });

  it("asks on our email thread when the lead has no other, and never while it still sends", async () => {
    await quiet();
    expect(await ask(`lead:email:${s.enrollmentId}`)).toEqual({ asked: true, why: null });
    const [row] = ((await approvalRecord.rows?.(pg.db)) ?? []).filter((r) => r.type === "reply");
    expect(row).toMatchObject({ who: "Dana Rivera", url: null });
    await pg.db.execute(sql`delete from inbox_replies`);
    await pg.db.execute(sql`update enrollments set state = 'active'`);
    expect(await ask(`lead:email:${s.enrollmentId}`)).toEqual({
      asked: false,
      why: "Its sequence is still sending.",
    });
  });
});
