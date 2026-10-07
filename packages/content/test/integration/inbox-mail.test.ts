/**
 * Marketing → Inbox shows a client's own mail (designs/2026-10-07-mail-access.md): only the `mail`
 * reader's rows, waiting until Done, opened by their own link. The Monitor's never show here.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inboxRecord } from "../../src/social/records.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
}, 240_000);
afterAll(() => pg?.stop());

describe("client mail in the Inbox", () => {
  it("shows the mail reader's rows by verdict, never the Monitor's", async () => {
    await pg.db.execute(sql`insert into watch.mail
      (mailbox, message_id, thread_id, from_name, from_address, subject, summary, verdict, at, link, reader, done_at)
      values
      ('ann@acme.example', 'm1', 't1', 'Lee', 'lee@patient.example', 'Quote?', 'Wants a quote', 'show',
        now(), 'https://outlook.office365.com/owa/?ItemID=m1', 'mail', null),
      ('ann@acme.example', 'm2', 't2', '', 'x@news.example', 'News', null, 'hold', now(), null, 'mail', null),
      ('ann@acme.example', 'm3', 't3', '', 'y@client.example', 'Thanks', null, 'show', now(), null, 'mail', now()),
      ('me@wren.example', 'w1', 'tw', '', 'z@vendor.example', 'Invoice', null, 'show', now(), null, 'monitor', null)`);
    const rows = ((await inboxRecord.rows?.(pg.db)) ?? []).filter((r) => r.type === "mail");
    expect(rows.map((r) => [r.who, r.state, r.account])).toEqual(
      expect.arrayContaining([
        ["Lee", "waiting", "ann@acme.example"],
        ["x@news.example", "seen", "ann@acme.example"],
        ["y@client.example", "read", "ann@acme.example"],
      ]),
    );
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.who === "Lee")).toMatchObject({
      body: "Wants a quote",
      post_title: "Quote?",
      url: "https://outlook.office365.com/owa/?ItemID=m1",
    });
    expect(rows.find((r) => r.who === "y@client.example")?.url).toMatch(
      /^https:\/\/mail\.google\.com\//,
    );
  });
});
