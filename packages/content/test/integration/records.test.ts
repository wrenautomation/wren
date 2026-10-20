/**
 * `marketing.post` against Postgres: a published post with its newest numbers, never an older
 * count or an unpublished draft, and engagement pooled in the footer. `marketing.inbox`'s email
 * replies and text threads in their states; `marketing.approval` holds what we'd send, the Inbox
 * never does. Synthetic rows only.
 */
import { recordDraft } from "@wren/core/draft-record";
import { editRecord } from "@wren/core/edits";
import { resolveObjects } from "@wren/core/objects";
import { serveRecords } from "@wren/core/records/serve";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLATFORM_SPECS } from "../../src/platforms.js";
import { draftRecord, postRecord } from "../../src/records.js";
import { draftVersion } from "../../src/review.js";
import { contentDrafts, contentIdeas, contentMetrics } from "../../src/schema.js";
import { AD_FORMAT_SEED, adFormatRecord } from "../../src/social/ad-formats.js";
import { doneRecord } from "../../src/social/done-record.js";
import {
  approvalRecord,
  engageRecord,
  exploreRecord,
  inboxRecord,
} from "../../src/social/records.js";

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
        max: PLATFORM_SPECS.x.maxChars,
        feed: { laptop: null, phone: null },
      },
      shape: expect.objectContaining({
        platform: "x",
        site: "X",
        editable: true,
        text: "a draft post",
        published: null,
      }),
      // One X login in the test: nothing to pick.
      accounts: null,
      ask: [],
      record: null,
      // The same idea's other drafts, a click apart in the editor.
      siblings: [{ id: gone?.id, platform: "x", state: "published", title: "a published post" }],
    });
    // The row names its words' version: Approve sends it, so a change since refuses the yes.
    expect(one.row.version).toBe(draftVersion("a draft post"));
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
      accounts: null,
      ask: [],
      record: null,
    });
  });
});

describe("marketing.engage: outbound comments in one queue", () => {
  it("holds others' posts with our comment drafted; a post draft waits elsewhere", async () => {
    await resolveObjects(pg.db, [
      { platform: "linkedin", kind: "post", raw: "urn:li:activity:9901" },
    ]);
    const [p] = (await pg.db.execute(sql`insert into reach_posts (platform, ref, author, text, url,
        found_by, account, fit, why, state, draft, queued_at, raw)
      values ('linkedin', 'urn:li:activity:9901', 'Synthetic Author', 'their synthetic post',
        'https://www.linkedin.com/feed/update/urn:li:activity:9901/', 'pasted', 'linkedin@wren',
        100, 'you pasted it', 'queued', 'our synthetic comment', now(), '{}')
      returning id`)) as unknown as { id: number }[];
    const api = serveRecords([engageRecord], pg.db);
    for (const v of engageRecord.views)
      await api.list({ record: engageRecord.id, view: v.id, limit: 50 });
    const waiting = (await api.list({ record: engageRecord.id, view: "waiting", limit: 50 })).rows;
    expect(waiting).toContainEqual(
      expect.objectContaining({
        id: `onpost:${p!.id}`,
        type: "onpost",
        state: "waiting",
        why: "you pasted it",
        draft: "our synthetic comment",
      }),
    );
    // Outreach's: what we write on their ground. Comments to us and DMs live elsewhere.
    expect(waiting.every((r) => ["thread", "onpost"].includes(String(r.type)))).toBe(true);
    const all = (await api.list({ record: engageRecord.id, view: "all", limit: 50 })).rows;
    expect(all.some((r) => r.type === "dm")).toBe(false);
    expect(all.every((r) => r.type !== "comment" || r.state === "answered")).toBe(true);
    const posts = (await api.list({ record: engageRecord.id, view: "posts", limit: 50 })).rows;
    expect(posts.map((r) => r.id)).toContain(`onpost:${p!.id}`);
    expect(await engageRecord.load?.(pg.db, `onpost:${p!.id}`)).toMatchObject({ ask: [] });
  });
});

describe("marketing.engage: Posted and Not live (comment proofs)", () => {
  it("lists sent comments newest first with their proof; Not live keeps hidden and missing", async () => {
    await resolveObjects(pg.db, [
      { platform: "linkedin", kind: "post", raw: "urn:li:activity:9921" },
    ]);
    const [p] = (await pg.db.execute(sql`insert into reach_posts (platform, ref, author, text, url,
        found_by, account, state, comment, commented_at, raw)
      values ('linkedin', 'urn:li:activity:9921', 'Proof Author', 'a synthetic post',
        'https://www.linkedin.com/feed/update/urn:li:activity:9921/', 'pasted', 'linkedin@wren',
        'commented', 'our synthetic words', now(), '{}')
      returning id`)) as unknown as { id: number }[];
    const item = `onpost:${p?.id}`;
    await pg.db.execute(sql`insert into comment_proofs (item, platform, state, url, note, checked_at)
      values (${item}, 'linkedin', 'hidden', 'https://example.com/c', 'not on the public page', now())`);
    const api = serveRecords([engageRecord], pg.db);
    const posted = (await api.list({ record: engageRecord.id, view: "posted", limit: 50 })).rows;
    expect(posted).toContainEqual(
      expect.objectContaining({
        id: item,
        state: "sent",
        proof: "hidden",
        draft: "our synthetic words",
      }),
    );
    const notLive = (await api.list({ record: engageRecord.id, view: "notlive", limit: 50 })).rows;
    expect(notLive.map((r) => r.id)).toContain(item);
    // A sent comment is no longer one to write.
    const waiting = (await api.list({ record: engageRecord.id, view: "waiting", limit: 50 })).rows;
    expect(waiting.map((r) => r.id)).not.toContain(item);
  });
});

describe("marketing.explore: found, not followed or picked yet", () => {
  it("found posts and ranked threads, best fit first; picked and old ones stay out", async () => {
    await resolveObjects(pg.db, [
      { platform: "linkedin", kind: "post", raw: "urn:li:activity:9911" },
      ...["t3_syn1", "t3_syn2", "t3_syn3"].map((raw) => ({
        platform: "reddit" as const,
        kind: "post" as const,
        raw,
      })),
    ]);
    const [p] = (await pg.db.execute(sql`insert into reach_posts (platform, ref, author, text, url,
        found_by, account, fit, why, state, raw)
      values ('linkedin', 'urn:li:activity:9911', 'Found Author', 'a found synthetic post',
        'https://www.linkedin.com/feed/update/urn:li:activity:9911/', 'topic', 'linkedin@wren',
        70, 'synthetic topic', 'found', '{}')
      returning id`)) as unknown as { id: number }[];
    await pg.db.execute(
      sql`insert into reddit_places (subreddit, name, found_by) values ('syntheticsub', 'syntheticsub', 'test')`,
    );
    await pg.db.execute(sql`insert into reddit_threads (id, subreddit, title, body, author, url,
        posted_at, comments, raw, fit, angle, state)
      values ('t3_syn1', 'syntheticsub', 'A ranked thread', 'its words', 'someone',
          'https://www.reddit.com/r/syntheticsub/comments/syn1/', now(), 3, '{}', 9, 'fits', 'ranked'),
        ('t3_syn2', 'syntheticsub', 'An old one', '', 'someone',
          'https://www.reddit.com/r/syntheticsub/comments/syn2/', now() - interval '5 days', 3, '{}',
          9, 'fits', 'ranked'),
        ('t3_syn3', 'syntheticsub', 'Queued', '', 'someone',
          'https://www.reddit.com/r/syntheticsub/comments/syn3/', now(), 3, '{}', 9, 'fits', 'queued')`);
    const api = serveRecords([exploreRecord], pg.db);
    for (const v of exploreRecord.views)
      await api.list({ record: exploreRecord.id, view: v.id, limit: 50 });
    const best = (await api.list({ record: exploreRecord.id, view: "best", limit: 50 })).rows;
    expect(best.map((r) => r.id)).toEqual([`onpost:${p!.id}`, "thread:t3_syn1"]);
    expect(best[1]).toMatchObject({ where: "r/syntheticsub", why: "fits", platform: "reddit" });
    expect(await exploreRecord.load?.(pg.db, "thread:t3_syn1")).toMatchObject({
      body: "A ranked thread\n\nits words",
    });
  });
});

describe("marketing.done", () => {
  it("keeps a person's steps and what followed, not the model's drafts; Today is today", async () => {
    const step = (
      item: string,
      event: "generated" | "approved" | "rejected" | "sent",
      via: "model" | "person" | "wren",
      at?: Date,
    ) =>
      recordDraft(pg.db, {
        item,
        kind: item.startsWith("comment") ? "comment" : "post",
        platform: "linkedin",
        event,
        via,
        by: via === "person" ? "william" : null,
        text: `Synthetic words for ${item}`,
        ...(at ? { at } : {}),
      });
    await step("draft:901", "generated", "model");
    await step("draft:901", "approved", "person");
    await step("draft:901", "sent", "wren");
    await step("comment:902", "rejected", "person", new Date(Date.now() - 3 * 86_400_000));
    const api = serveRecords([doneRecord], pg.db);
    const all = await api.list({ record: "marketing.done", view: "all", limit: 50 });
    const mine = all.rows.filter((r) =>
      ["draft:901", "comment:902"].some((i) => String(r.open).endsWith(i.split(":")[1] ?? "")),
    );
    expect(mine.map((r) => r.event).sort()).toEqual(["approved", "rejected", "sent"]);
    expect(mine.find((r) => r.event === "approved")?.open).toBe("/marketing/drafts/901");
    const today = await api.list({ record: "marketing.done", view: "today", limit: 50 });
    expect(
      today.rows.some((r) => r.event === "rejected" && r.open === "/marketing/comments/902"),
    ).toBe(false);
    const week = await api.list({ record: "marketing.done", view: "week", limit: 50 });
    expect(week.rows.some((r) => r.open === "/marketing/comments/902")).toBe(true);
  });
});

describe("ads.format", () => {
  it("starts from the 42, adds up its launches' days, and saves edits as changes", async () => {
    const api = serveRecords([adFormatRecord], pg.db);
    const all = await api.list({ record: "ads.format", view: "ideas", limit: 100 });
    expect(all.rows).toHaveLength(AD_FORMAT_SEED.length);
    await pg.db.execute(sql`
      insert into ad_launches (name, ad_account_id, campaign_id, adset_id, creative_id, ad_id, spec, daily_budget_usd)
      values ('synthetic', 'act_1', 'c1', 's1', 'cr1', 'a1', '{"format":"testimonial"}', 5)`);
    await pg.db.execute(sql`
      insert into ad_days (day, adset_id, campaign_id, campaign_name, adset_name, currency, spend, impressions, reach, clicks, leads, results)
      values (current_date, 's1', 'c1', 'c', 's', 'USD', 10, 1000, 900, 20, 4, 4),
        (current_date - 1, 's1', 'c1', 'c', 's', 'USD', 10, 1000, 900, 30, 1, 1)`);
    const by = "william";
    await editRecord(pg.db, adFormatRecord, "testimonial", { patch: { state: "testing" }, by });
    await expect(
      editRecord(pg.db, adFormatRecord, "testimonial", { patch: { family: "vibes" }, by }),
    ).rejects.toThrow();
    const testing = await api.list({ record: "ads.format", view: "testing", limit: 10 });
    expect(testing.rows).toHaveLength(1);
    expect(testing.rows[0]).toMatchObject({
      id: "testimonial",
      launches: 1,
      spend: { amount: 20, currency: "USD" },
      clicks: 50,
      leads: 5,
      ctr: 2.5,
      costPerLead: { amount: 4, currency: "USD" },
      updatedBy: by,
    });
    const [change] = await pg.db.execute(
      sql`select record, after from changes where record_id = 'testimonial'`,
    );
    expect(change).toMatchObject({ record: "ads.format", after: { state: "testing" } });
  });
});
