/**
 * The sent log: one row per message on any channel, one ladder, each row's history. Synthetic rows.
 * The views read `now()` (an email counts as delivered after 48 hours), so every time here is an
 * offset from the clock when the file loads: nothing depends on today's date.
 */
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

const HOUR = 3_600_000;
/** Sent less than 48 hours ago: no bounce yet proves nothing. */
const T0 = new Date(Date.now() - 40 * HOUR);
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000).toISOString();
/** Sent over 48 hours ago: the quiet rule has fired. */
const OLD = new Date(Date.now() - 72 * HOUR);
const atOld = (minutes: number) => new Date(OLD.getTime() + minutes * 60_000).toISOString();
/** "Oct 6", the way a history line writes a day. */
const day = (iso: string) =>
  `${new Date(iso).toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${new Date(iso).getUTCDate()}`;

type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>) => (await pg.db.execute(q)) as unknown as Row[];
const one = async (q: ReturnType<typeof sql>) => (await run(q))[0] as Row;

beforeEach(async () => {
  await truncate(pg.db, [
    "open_events",
    "email_clicks",
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
const click = (message: number, firstAt: string, lastAt: string, url = "/", clicks = 1) =>
  run(sql`insert into email_clicks (link_code, url, message_id, first_at, last_at, clicks)
    values (${`code${++ids}`}, ${url}, ${message}, ${firstAt}, ${lastAt}, ${clicks})`);
const emailHistory = (message: number) =>
  run(
    sql`select kind, what, at from sent_activity where message = ${`email:${message}`} order by at, seq`,
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
    expect(history.map((h) => h.kind)).toEqual([
      "approved",
      "sent",
      "note",
      "delivered",
      "opened",
      "reply",
    ]);
    expect(history[1]?.what).toBe("Sent from sender@example.test");
    expect(history[2]?.what).toMatch(/mail scanner/);
    expect(history[3]?.what).toBe("Counted as delivered: it was opened");
    expect(history[4]?.what).toBe(`Opened 2 times, last ${day(at(60 * 24))}`);
    expect(history[5]?.what).toBe("They replied: Sounds good");
  });
});

describe("email delivered and clicked", () => {
  it("counts delivered after 48 hours with no bounce, and never after a bounce", async () => {
    const a = await enroll("ann@example.test");
    const fresh = await a.message({ state: "sent", sentAt: at(0), step: 1 });
    const old = await a.message({ state: "sent", sentAt: atOld(0), step: 2 });
    const b = await enroll("bob@example.test");
    const bouncedOld = await b.message({ state: "sent", sentAt: atOld(0) });
    await threadEvent(b.enrollment, "bounce", atOld(3), { bounceClass: "hard" });
    const failedOld = await b.message({ state: "failed", step: 2, sentAt: null });

    const rows = await log();
    expect(stateOf(rows, `email:${fresh}`)).toBe("sent");
    expect(stateOf(rows, `email:${old}`)).toBe("delivered");
    expect(stateOf(rows, `email:${bouncedOld}`)).toBe("bounced");
    expect(stateOf(rows, `email:${failedOld}`)).toBe("failed");

    expect((await emailHistory(fresh)).map((h) => h.kind)).toEqual(["sent"]);
    const history = await emailHistory(old);
    expect(history.map((h) => [h.kind, h.what])).toEqual([
      ["sent", "Sent from sender@example.test"],
      ["delivered", "Counted as delivered: no bounce in 48 hours"],
    ]);
    // The rule's time is the 48-hour mark, not the moment the view is read.
    expect(new Date(history[1]?.at as string).getTime()).toBe(OLD.getTime() + 48 * HOUR);
    expect((await emailHistory(bouncedOld)).map((h) => h.kind)).toEqual(["sent", "bounce"]);
  });

  it("counts delivered sooner on an open, a click or a reply, and says which", async () => {
    const a = await enroll("ann@example.test");
    const opened = await a.message({ state: "sent", sentAt: at(0), step: 1 });
    await open(opened, at(30));
    const clicked = await a.message({ state: "sent", sentAt: at(0), step: 2 });
    await click(clicked, at(45), at(45));
    const replied = await a.message({ state: "sent", sentAt: at(0), step: 3 });
    await threadEvent(a.enrollment, "reply", at(60), { replyTo: replied });
    // The earliest proof is the one named, whatever came after.
    const first = await a.message({ state: "sent", sentAt: at(0), step: 4 });
    await open(first, at(90));
    await click(first, at(20), at(20));
    // Opened after the 48-hour mark: the quiet rule fired first.
    const late = await a.message({ state: "sent", sentAt: atOld(0), step: 5 });
    await open(late, atOld(60 * 60));

    const rows = await log();
    expect(stateOf(rows, `email:${opened}`)).toBe("opened");
    expect(stateOf(rows, `email:${clicked}`)).toBe("clicked");
    expect(stateOf(rows, `email:${replied}`)).toBe("replied");
    expect(stateOf(rows, `email:${first}`)).toBe("clicked");
    expect(stateOf(rows, `email:${late}`)).toBe("opened");

    const rule = async (m: number) =>
      (await emailHistory(m)).find((h) => h.kind === "delivered")?.what;
    expect(await rule(opened)).toBe("Counted as delivered: it was opened");
    expect(await rule(clicked)).toBe("Counted as delivered: they clicked a link");
    expect(await rule(replied)).toBe("Counted as delivered: they replied");
    expect(await rule(first)).toBe("Counted as delivered: they clicked a link");
    expect(await rule(late)).toBe("Counted as delivered: no bounce in 48 hours");
    const early = (await emailHistory(opened)).find((h) => h.kind === "delivered");
    expect(new Date(early?.at as string).toISOString()).toBe(at(30));
  });

  it("sets clicked from the stored clicks, and says what they landed on", async () => {
    const a = await enroll("ann@example.test");
    const once = await a.message({ state: "sent", sentAt: at(0), step: 1 });
    await click(once, at(15), at(15), "/recruiting");
    const many = await a.message({ state: "sent", sentAt: at(0), step: 2 });
    await click(many, at(10), at(30), "/", 2);
    await click(many, at(40), at(40), "/book/reactivation");
    // Open and click: the click is further up the ladder.
    const both = await a.message({ state: "sent", sentAt: at(0), step: 3 });
    await open(both, at(10));
    await click(both, at(12), at(12));

    const rows = await log();
    expect(stateOf(rows, `email:${once}`)).toBe("clicked");
    expect(stateOf(rows, `email:${both}`)).toBe("clicked");
    const clicked = (m: number) =>
      emailHistory(m).then((h) => h.filter((x) => x.kind === "clicked").map((x) => x.what));
    expect(await clicked(once)).toEqual(["Clicked the link, landing on /recruiting"]);
    expect(await clicked(many)).toEqual([
      `Clicked the link, landing on /, /book/reactivation (3 times, last ${day(at(40))})`,
    ]);
    const counts = await run(sql`select state, count(*)::int n from sent_records group by state`);
    expect(Object.fromEntries(counts.map((r) => [r.state, r.n]))).toEqual({ clicked: 3 });
  });

  it("does not count a link followed within 2 minutes of sending", async () => {
    const a = await enroll("ann@example.test");
    const scanned = await a.message({ state: "sent", sentAt: at(0), step: 1 });
    await click(scanned, at(0.5), at(1));
    const scannedThenReal = await a.message({ state: "sent", sentAt: at(0), step: 2 });
    await click(scannedThenReal, at(0.5), at(25));

    const rows = await log();
    expect(stateOf(rows, `email:${scanned}`)).toBe("sent");
    expect(stateOf(rows, `email:${scannedThenReal}`)).toBe("clicked");
    expect((await emailHistory(scanned)).map((h) => h.kind)).toEqual(["sent", "note"]);
    expect((await emailHistory(scanned))[1]?.what).toMatch(/not counted as a click/);
    // One stored row cannot split a scan from a later real click: it counts once it reaches 2 minutes.
    expect((await emailHistory(scannedThenReal)).map((h) => h.kind)).toEqual([
      "sent",
      "delivered",
      "clicked",
    ]);
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
