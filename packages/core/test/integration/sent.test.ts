/** The sent log: one row per message on any channel, one ladder, each row's history. Synthetic rows. */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { serveRecords } from "../../src/records-serve.js";
import { SENT_RECORDS, sentDetail } from "../../src/sent-records.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const T0 = new Date("2026-10-05T12:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000).toISOString();

type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>) => (await pg.db.execute(q)) as unknown as Row[];
const one = async (q: ReturnType<typeof sql>) => (await run(q))[0] as Row;

beforeEach(async () => {
  await truncate(pg.db, [
    "open_events",
    "thread_events",
    "messages",
    "enrollments",
    "companies",
    "sms_messages",
    "sms_contacts",
    "reach_messages",
    "reach_contacts",
    "reach_accounts",
    "comments",
    "reach_posts",
    "reddit_threads",
    "reddit_places",
    "consent_events",
    "consents",
    "topics",
    "blog_posts",
  ]);
});

let firms = 0;
let ids = 0;
/** An enrollment of one address, and a way to add messages to it. */
async function enroll(to: string) {
  const company = await one(
    sql`insert into companies (domain) values (${`firm${++firms}.example.test`}) returning id`,
  );
  const e = await one(sql`insert into enrollments
    (niche, sequence_name, sequence_snapshot, offer, state, company_id, kind, to_email, sender)
    values ('plumbing', 'cold_intro', '{}'::jsonb, 'offer', 'active', ${company.id as number},
      'role_inbox', ${to}, 'sender@example.test') returning id`);
  const enrollment = e.id as number;
  const message = async (o: {
    state: string;
    step?: number;
    sentAt?: string | null;
    approvedAt?: string | null;
    subject?: string | null;
    body?: string;
    detail?: string | null;
  }) => {
    const m = await one(sql`insert into messages
      (enrollment_id, step, template, template_version, to_email, body, provenance, state,
       sent_at, approved_at, approved_by, message_id, subject, detail)
      values (${enrollment}, ${o.step ?? 1}, 't', 'v1', ${to}, ${o.body ?? "Hello there"},
        '{}'::jsonb, ${o.state}, ${o.sentAt ?? null}, ${o.approvedAt ?? null},
        ${o.approvedAt ? "operator" : null}, ${`<m${++ids}@example.test>`},
        ${o.subject === undefined ? "Quick question" : o.subject}, ${o.detail ?? null}) returning id`);
    return m.id as number;
  };
  return { enrollment, message };
}

const open = (message: number, seenAt: string) =>
  run(
    sql`insert into open_events (message_id, remote_id, seen_at) values (${message}, ${++ids}, ${seenAt})`,
  );
const threadEvent = (
  enrollment: number,
  kind: string,
  receivedAt: string,
  extra: { replyTo?: number; snippet?: string; bounceClass?: string } = {},
) =>
  run(sql`insert into thread_events
    (enrollment_id, kind, received_at, in_reply_to_message_id, snippet, bounce_class)
    values (${enrollment}, ${kind}, ${receivedAt}, ${extra.replyTo ?? null},
      ${extra.snippet ?? null}, ${extra.bounceClass ?? null})`);

/** The sent log's rows by id, state and the channel's own state. */
async function log() {
  const rows = await run(sql`select id, channel, kind, to_address, key_kind, key_value, subject,
    channel_state, state, campaign from sent_records order by id`);
  return new Map(rows.map((r) => [r.id as string, r]));
}
const stateOf = (rows: Map<string, Row>, id: string) => rows.get(id)?.state;

describe("email on the ladder", () => {
  it("puts each message at the furthest step it reached; a failure wins", async () => {
    const a = await enroll("Ann@Example.test");
    const plain = await a.message({ state: "sent", sentAt: at(0), step: 1 });
    const opened = await a.message({ state: "sent", sentAt: at(10), step: 2 });
    const scanned = await a.message({ state: "sent", sentAt: at(20), step: 3 });
    const replied = await a.message({ state: "sent", sentAt: at(30), step: 4 });
    const both = await a.message({ state: "sent", sentAt: at(40), step: 5 });
    await open(opened, at(10 + 15));
    await open(scanned, at(20.5));
    await open(both, at(40 + 15));
    await threadEvent(a.enrollment, "reply", at(30 + 60), {
      replyTo: replied,
      snippet: "Yes please",
    });
    await threadEvent(a.enrollment, "reply", at(40 + 90), { replyTo: both });

    const b = await enroll("bob@example.test");
    const bounced = await b.message({ state: "sent", sentAt: at(0) });
    await open(bounced, at(30));
    // No header names the message: a bounce belongs to the last one sent on the thread.
    await threadEvent(b.enrollment, "bounce", at(5), { bounceClass: "hard" });
    const failed = await b.message({ state: "failed", step: 2, detail: "mailbox paused" });
    const queued = await b.message({ state: "approved", step: 3, approvedAt: at(50) });
    const draft = await b.message({ state: "draft", step: 4 });
    const noSubject = await b.message({
      state: "sent",
      step: 5,
      sentAt: at(70),
      subject: null,
      body: "First line\n\n  second   line",
    });

    const rows = await log();
    expect(stateOf(rows, `email:${plain}`)).toBe("sent");
    expect(stateOf(rows, `email:${opened}`)).toBe("opened");
    // An image fetched seconds after sending is a mail scanner, not a person.
    expect(stateOf(rows, `email:${scanned}`)).toBe("sent");
    expect(stateOf(rows, `email:${replied}`)).toBe("replied");
    expect(stateOf(rows, `email:${both}`)).toBe("replied");
    expect(stateOf(rows, `email:${bounced}`)).toBe("bounced");
    expect(stateOf(rows, `email:${failed}`)).toBe("failed");
    expect(stateOf(rows, `email:${queued}`)).toBe("queued");
    expect(rows.has(`email:${draft}`)).toBe(false);
    // No subject: the first line of the body, whitespace folded.
    expect(rows.get(`email:${noSubject}`)?.subject).toBe("First line second line");

    const first = rows.get(`email:${plain}`) as Row;
    expect(first).toMatchObject({
      channel: "email",
      kind: "email",
      to_address: "Ann@Example.test",
      key_kind: "email",
      key_value: "ann@example.test",
      subject: "Quick question",
      channel_state: "sent",
      campaign: "plumbing / cold intro",
    });
  });

  it("keeps a message's history in order, and says why a scan did not count", async () => {
    const a = await enroll("ann@example.test");
    const m = await a.message({ state: "sent", sentAt: at(0), approvedAt: at(-5) });
    await open(m, at(0.5));
    await open(m, at(20));
    await open(m, at(60 * 24));
    await threadEvent(a.enrollment, "reply", at(90), { replyTo: m, snippet: "Sounds good" });
    const history = await run(
      sql`select kind, what from sent_activity where message = ${`email:${m}`} order by at, seq`,
    );
    expect(history.map((h) => h.kind)).toEqual(["approved", "sent", "note", "opened", "reply"]);
    expect(history[1]?.what).toBe("Sent from sender@example.test");
    expect(history[2]?.what).toMatch(/mail scanner/);
    expect(history[3]?.what).toMatch(/^Opened 2 times, last Oct 6$/);
    expect(history[4]?.what).toBe("They replied: Sounds good");
  });
});

describe("texts on the ladder", () => {
  it("reads the carrier's receipt, and a reply only for the message it followed", async () => {
    const c = await one(sql`insert into sms_contacts (e164, source_kind, basis)
      values ('+15555550101', 'manual', 'opt_in') returning id`);
    const contact = c.id as number;
    const text = (o: {
      direction: string;
      state: string;
      body: string;
      sentAt?: string;
      deliveredAt?: string;
      receivedAt?: string;
    }) =>
      one(sql`insert into sms_messages
        (contact_id, direction, kind, to_e164, body, state, sent_at, delivered_at, received_at,
         provider_id)
        values (${contact}, ${o.direction}, ${o.direction === "in" ? "inbound" : "manual"},
          '+15555550101', ${o.body}, ${o.state}, ${o.sentAt ?? null}, ${o.deliveredAt ?? null},
          ${o.receivedAt ?? null}, ${o.sentAt ? `SM${++ids}` : null}) returning id`);
    const first = await text({
      direction: "out",
      state: "sent",
      body: "Are you free Tuesday?",
      sentAt: at(0),
    });
    await text({ direction: "in", state: "received", body: "Yes, 3pm", receivedAt: at(30) });
    const second = await text({
      direction: "out",
      state: "delivered",
      body: "Booked.",
      sentAt: at(60),
      deliveredAt: at(61),
    });
    const queued = await text({ direction: "out", state: "queued", body: "Reminder" });
    const failed = await text({ direction: "out", state: "failed", body: "Failed one" });

    const rows = await log();
    expect(stateOf(rows, `sms:${first.id}`)).toBe("replied");
    expect(stateOf(rows, `sms:${second.id}`)).toBe("delivered");
    expect(stateOf(rows, `sms:${queued.id}`)).toBe("queued");
    expect(stateOf(rows, `sms:${failed.id}`)).toBe("failed");
    // What people sent us is not in a log of what we sent.
    expect([...rows.keys()].filter((k) => k.startsWith("sms:"))).toHaveLength(4);
    expect(rows.get(`sms:${first.id}`)).toMatchObject({
      channel: "sms",
      key_kind: "phone",
      key_value: "+15555550101",
      channel_state: "sent",
      campaign: "manual",
    });
  });
});

describe("DMs, comments and newsletters", () => {
  it("lists DMs by platform, a reply on the thread, and skips proposals", async () => {
    const c = await one(sql`insert into reach_contacts (platform, handle, url, found_in)
      values ('linkedin', 'Jo-Example', 'https://example.test/jo', 'search') returning id`);
    const contact = c.id as number;
    const dm = (direction: string, state: string, body: string, sentAt: string | null) =>
      one(sql`insert into reach_messages (contact_id, direction, kind, body, state, sent_at)
        values (${contact}, ${direction}, ${direction === "in" ? "inbound" : "manual"}, ${body},
          ${state}, ${sentAt}) returning id`);
    const sent = await dm("out", "sent", "Saw your post", at(0));
    await dm("in", "received", "Thanks!", at(20));
    const proposed = await dm("out", "proposed", "Not yet", null);
    const failed = await dm("out", "failed", "Broken", at(40));
    const later = await dm("out", "sent", "Following up", at(60));

    const rows = await log();
    expect(stateOf(rows, `dm:${sent.id}`)).toBe("replied");
    expect(stateOf(rows, `dm:${later.id}`)).toBe("sent");
    expect(stateOf(rows, `dm:${failed.id}`)).toBe("failed");
    expect(rows.has(`dm:${proposed.id}`)).toBe(false);
    expect(rows.get(`dm:${sent.id}`)).toMatchObject({
      channel: "linkedin",
      kind: "dm",
      key_kind: "handle:linkedin",
      key_value: "jo-example",
    });
  });

  it("lists comments we posted, on a post, a thread and a reply", async () => {
    await run(sql`insert into comments
      (platform, ref, post, parent, kind, author, body, url, at, raw, answer, answered_at, channel)
      values ('youtube', 'c1', 'p1', '', 'post_reply', 'Pat', 'Great video', 'https://example.test/c1',
        ${at(0)}, '{}'::jsonb, 'Thank you, Pat', ${at(10)}, 'content')`);
    await run(sql`insert into reach_posts (ref, author, text, url, found_by, account, raw, comment, commented_at)
      values ('r1', 'Sam', 'A post', 'https://example.test/r1', 'search', 'acct', '{}'::jsonb,
        'Nice point', ${at(20)})`);
    await run(
      sql`insert into reddit_places (subreddit, name, found_by) values ('example', 'example', 'named')`,
    );
    await run(sql`insert into reddit_threads
      (id, subreddit, title, body, author, url, posted_at, comments, raw, answer, answered_at)
      values ('t1', 'example', 'Question', 'Body', 'kim', 'https://example.test/t1', ${at(0)}, 0,
        '{}'::jsonb, 'Here is how', ${at(30)})`);
    const rows = await log();
    const kinds = [...rows.values()].map((r) => [r.id, r.kind, r.state]);
    expect(kinds).toEqual([
      expect.arrayContaining(["comment", "sent"]),
      expect.arrayContaining(["comment", "sent"]),
      expect.arrayContaining(["comment", "sent"]),
    ]);
    expect(rows.get("thread:t1")).toMatchObject({
      channel: "reddit",
      key_kind: "handle:reddit",
      campaign: "r/example",
    });
  });

  it("lists a newsletter issue once per address, with the post's title", async () => {
    await run(sql`insert into blog_posts (slug, title, description, body, date)
      values ('how-to-animate', 'How to animate', 'd', 'Body text', '2026-10-01')`);
    const t = await one(sql`insert into topics (name, public_name, line, channel, cadence)
      values ('weekly-breakdown', 'Weekly breakdown', 'l', 'email', 'weekly') returning id`);
    const c =
      await one(sql`insert into consents (channel, address, topic_id, state, source, text_version)
      values ('email', 'Reader@Example.test', ${t.id as number}, 'confirmed', 'lander_form', 'v1')
      returning id`);
    await run(sql`insert into consent_events (consent_id, kind, by, evidence, created_at)
      values (${c.id as number}, 'sent', 'newsletter',
        '{"issue":"weekly-breakdown:how-to-animate","url":"https://example.test/blog/how-to-animate"}'::jsonb,
        ${at(0)}),
      (${c.id as number}, 'confirmed', 'subscriber', null, ${at(-10)})`);
    const rows = await log();
    const sent = [...rows.values()].filter((r) => r.kind === "newsletter");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      channel: "email",
      to_address: "Reader@Example.test",
      key_value: "reader@example.test",
      subject: "How to animate",
      state: "sent",
      campaign: "Weekly breakdown",
    });
    const d = await sentDetail(pg.db, sent[0]?.id as string);
    expect(d).toMatchObject({ as: "email", to: "Reader@Example.test", subject: "How to animate" });
    expect(d?.body).toContain("Body text");
    expect(d?.body).toContain("https://example.test/blog/how-to-animate");
  });
});

describe("opening a row", () => {
  it("reads the message as it went out, from its own table", async () => {
    const a = await enroll("ann@example.test");
    const m = await a.message({
      state: "sent",
      sentAt: at(0),
      subject: "Hi Ann",
      body: "Line one\nLine two",
    });
    expect(await sentDetail(pg.db, `email:${m}`)).toEqual({
      as: "email",
      site: null,
      from: "sender@example.test",
      to: "ann@example.test",
      subject: "Hi Ann",
      body: "Line one\nLine two",
    });
    expect(await sentDetail(pg.db, "email:99999")).toBeNull();
    expect(await sentDetail(pg.db, "nonsense")).toBeNull();
    expect(await sentDetail(pg.db, "sms:abc")).toBeNull();
  });
});

describe("the record", () => {
  it("serves the views, a state filter, the history and the message through the records API", async () => {
    const a = await enroll("ann@example.test");
    const ok = await a.message({
      state: "sent",
      sentAt: at(0),
      approvedAt: at(-5),
      body: "Hi Ann",
    });
    const b = await enroll("bob@example.test");
    await b.message({ state: "sent", sentAt: at(0) });
    await threadEvent(b.enrollment, "bounce", at(3), { bounceClass: "hard" });
    const api = serveRecords(SENT_RECORDS, pg.db);
    const all = await api.list({ record: "people.sent", view: "all", limit: 200 });
    expect(all.rows).toHaveLength(2);
    expect(all.counts).toMatchObject({ all: 2, failed: 1, opened: 0, replied: 0 });
    const failed = await api.list({ record: "people.sent", view: "failed", limit: 200 });
    expect(failed.rows.map((r) => r.state)).toEqual(["bounced"]);
    const bySearch = await api.list({ record: "people.sent", q: "ann@", limit: 200 });
    expect(bySearch.rows.map((r) => r.to)).toEqual(["ann@example.test"]);
    const got = await api.get({ record: "people.sent", id: `email:${ok}` });
    expect(got.row.state).toBe("sent");
    expect(got.activity?.map((l) => l.kind)).toEqual(["sent", "approved"]);
    expect(got.detail).toMatchObject({ as: "email", body: "Hi Ann", to: "ann@example.test" });
  });
});
