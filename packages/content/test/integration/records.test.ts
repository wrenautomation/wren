/**
 * `marketing.post` against Postgres: a published post with its newest numbers, never an older
 * count or an unpublished draft, and engagement pooled in the footer. `marketing.inbox`'s email
 * replies and text threads in their states; `marketing.approval` holds what we'd send, the Inbox
 * never does. Synthetic rows only.
 */
import { serveRecords } from "@wren/core/records/serve";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { draftRecord, postRecord } from "../../src/records.js";
import { contentDrafts, contentIdeas, contentMetrics } from "../../src/schema.js";
import { approvalRecord, inboxRecord } from "../../src/social/records.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(async () => {
  await pg?.stop();
});

describe("marketing.post", () => {
  it("lists published posts by their newest numbers, every view", async () => {
    const [idea] = await pg.db
      .insert(contentIdeas)
      .values({ text: "synthetic idea", source: "cli" })
      .returning();
    const draft = (status: "published" | "draft", text: string) => ({
      ideaId: idea!.id,
      platform: "linkedin" as const,
      text,
      status,
      promptVersion: "t",
      publishedAt: status === "published" ? new Date() : null,
    });
    const [post] = await pg.db
      .insert(contentDrafts)
      .values([draft("published", "First line\nsecond line"), draft("draft", "not out")])
      .returning();
    const count = (views: number, reactions: number, at: string) => ({
      draftId: post!.id,
      asOf: new Date(at),
      views,
      reactions,
      comments: 1,
      shares: 0,
      fetchedWith: "api",
      createdAt: new Date(at),
    });
    await pg.db
      .insert(contentMetrics)
      .values([count(10, 1, "2026-01-01T00:00:00Z"), count(200, 9, "2026-01-02T00:00:00Z")]);

    const api = serveRecords([postRecord], pg.db);
    for (const v of postRecord.views)
      await api.list({ record: postRecord.id, view: v.id, limit: 9 });
    const week = await api.list({ record: postRecord.id, view: "week", limit: 9 });
    expect(week.rows).toEqual([
      expect.objectContaining({
        id: `${idea!.id}/linkedin/${post!.id}`,
        title: "First line",
        views: 200,
      }),
    ]);
    expect(week.totals.engagement).toEqual({ n: 10, of: 200 });
  });
});

describe("marketing.draft", () => {
  it("lists drafts not yet out by state, and loads what the preview needs", async () => {
    const [idea] = await pg.db
      .insert(contentIdeas)
      .values({ text: "synthetic draft idea", source: "cli" })
      .returning();
    if (!idea) throw new Error("no idea");
    const [waiting, gone] = await pg.db
      .insert(contentDrafts)
      .values(
        (["draft", "published"] as const).map((status) => ({
          ideaId: idea.id,
          platform: "x" as const,
          text: `a ${status} post`,
          status,
          promptVersion: "t",
        })),
      )
      .returning();
    const api = serveRecords([draftRecord], pg.db);
    for (const v of draftRecord.views)
      await api.list({ record: draftRecord.id, view: v.id, limit: 9 });
    const ids = (await api.list({ record: draftRecord.id, view: "waiting", limit: 9 })).rows.map(
      (r) => r.id,
    );
    expect(ids).toContain(waiting?.id);
    expect(ids).not.toContain(gone?.id);
    const one = await api.get({ record: draftRecord.id, id: String(waiting?.id) });
    expect(one.detail).toEqual({
      post: {
        site: "X",
        title: null,
        text: "a draft post",
        max: 280,
        feed: { laptop: null, phone: null },
      },
      shape: expect.objectContaining({
        platform: "x",
        site: "X",
        editable: true,
        text: "a draft post",
        published: null,
      }),
      ask: [],
      record: null,
    });
    // Every field X takes, as the editor draws it; nothing set yet.
    const shape = (one.detail as { shape: { fields: { key: string; status: string }[] } }).shape;
    expect(shape.fields.map((f) => f.key)).toContain("replySettings");
  });
});

describe("marketing.inbox: email replies and texts", () => {
  it("waits on an unanswered reply and an unread text; answered ones leave the view", async () => {
    const one = async (q: ReturnType<typeof sql>) =>
      ((await pg.db.execute(q)) as unknown as { id: number }[])[0]?.id as number;
    const co = await one(
      sql`insert into companies (domain, name) values ('inbox.example', 'Inbox Firm') returning id`,
    );
    const person = await one(sql`
      insert into people (company_id, full_name, is_compliance, origin, origin_ref, raw)
      values (${co}, 'Ann Example', false, 'manual', 'test', '{}') returning id`);
    const enrollment = await one(sql`
      insert into enrollments (niche, sequence_name, sequence_snapshot, offer, state, company_id,
        person_id, kind, to_email, sender)
      values ('test', 's', '{}', 'o', 'active', ${co}, ${person}, 'person', 'ann@inbox.example',
        'me@wren.example') returning id`);
    const reply = (words: string, disposition: string) =>
      one(sql`
        insert into thread_events (enrollment_id, kind, disposition, disposition_source,
          from_address, body_text, received_at)
        values (${enrollment}, 'reply', ${disposition}, 'rule', 'ann@inbox.example', ${words},
          now())
        returning id`);
    const open = await reply("Tell me more", "interested");
    const booked = await reply("Tuesday works", "interested");
    const asked = await reply("Can we talk Friday?", "interested");
    const invited = (thread: number, state: string) =>
      one(sql`
        insert into call_invites (thread_event_id, enrollment_id, state, email)
        values (${thread}, ${enrollment}, ${state}, 'ann@inbox.example') returning id`);
    const invite = await invited(booked, "sent");
    const toAnswer = await invited(asked, "needs_you");

    const contact = (e164: string) =>
      one(sql`
        insert into sms_contacts (e164, name, source_kind, basis)
        values (${e164}, ${`Texter ${e164.slice(-1)}`}, 'inbound', 'opt_in') returning id`);
    const text = (id: number, direction: "in" | "out", body: string, ago: number) =>
      pg.db.execute(sql`
        insert into sms_messages (contact_id, direction, kind, to_e164, body, state, received_at,
          created_at)
        values (${id}, ${direction}, ${direction === "in" ? "inbound" : "manual"}, '+15550000000',
          ${body}, ${direction === "in" ? "received" : "queued"},
          ${direction === "in" ? sql`now() - ${`${ago} minutes`}::interval` : null},
          now() - ${`${ago} minutes`}::interval)`);
    const unread = await contact("+15550000001");
    await text(unread, "in", "Is this still open?", 5);
    const answered = await contact("+15550000002");
    await text(answered, "in", "Who is this?", 10);
    await text(answered, "out", "Wren, about your note", 2);

    const api = serveRecords([inboxRecord], pg.db);
    for (const v of inboxRecord.views)
      await api.list({ record: inboxRecord.id, view: v.id, limit: 50 });
    const waiting = (await api.list({ record: inboxRecord.id, view: "waiting", limit: 50 })).rows;
    expect(waiting).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `reply:${open}`,
          type: "email",
          state: "waiting",
          who: "Ann Example",
          company: "Inbox Firm",
          body: "Tell me more",
          url: null,
        }),
        // An invite's id, so the replies page's Send and Don't answer act on it here.
        expect.objectContaining({
          id: `email:${toAnswer}`,
          type: "email",
          state: "waiting",
          answer: "needs_you",
          url: `/inbox/replies/${toAnswer}`,
        }),
        expect.objectContaining({
          id: `text:${unread}`,
          type: "text",
          state: "waiting",
          body: "Is this still open?",
        }),
      ]),
    );
    const ids = waiting.map((r) => r.id);
    const inbound = ["comment", "dm", "email", "text", "activity"];
    expect(waiting.every((r) => inbound.includes(String(r.type)))).toBe(true);
    expect(ids).not.toContain(`email:${invite}`);
    expect(ids).not.toContain(`text:${answered}`);
    const email = (await api.list({ record: inboxRecord.id, view: "email", limit: 50 })).rows;
    expect(email.find((r) => r.id === `email:${invite}`)).toMatchObject({
      state: "answered",
      answer: "sent",
      url: `/inbox/replies/${invite}`,
    });
    const texts = (await api.list({ record: inboxRecord.id, view: "texts", limit: 50 })).rows;
    expect(texts.find((r) => r.id === `text:${answered}`)).toMatchObject({ state: "answered" });
    // A text row's detail is its thread, as the Texts app shows it.
    expect(await inboxRecord.load?.(pg.db, `text:${unread}`)).toMatchObject({
      messages: [expect.objectContaining({ direction: "in", body: "Is this still open?" })],
    });
  });
});

describe("marketing.approval: what we'd send", () => {
  it("holds a post draft waiting on a yes; the Inbox doesn't", async () => {
    const [idea] = await pg.db
      .insert(contentIdeas)
      .values({ text: "synthetic approval idea", source: "cli" })
      .returning();
    const [d] = await pg.db
      .insert(contentDrafts)
      .values({
        ideaId: idea!.id,
        platform: "linkedin",
        text: "a post to approve",
        status: "draft",
        promptVersion: "t",
      })
      .returning();
    const api = serveRecords([approvalRecord, inboxRecord], pg.db);
    for (const v of approvalRecord.views)
      await api.list({ record: approvalRecord.id, view: v.id, limit: 50 });
    const waiting = (await api.list({ record: approvalRecord.id, view: "waiting", limit: 50 }))
      .rows;
    expect(waiting).toContainEqual(
      expect.objectContaining({
        id: `draft:${d!.id}`,
        type: "draft",
        state: "waiting",
        body: "a post to approve",
      }),
    );
    const outbound = ["draft", "video", "thread", "invite"];
    expect(waiting.every((r) => outbound.includes(String(r.type)))).toBe(true);
    const inbox = (await api.list({ record: inboxRecord.id, view: "all", limit: 500 })).rows;
    expect(inbox.some((r) => outbound.includes(String(r.type)))).toBe(false);
    expect(await approvalRecord.load?.(pg.db, `draft:${d!.id}`)).toEqual({
      shape: expect.objectContaining({ draftId: d!.id, editable: true }),
      ask: [],
      record: null,
    });
  });
});
