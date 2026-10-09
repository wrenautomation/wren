/**
 * Auto-reply on Postgres (designs/2026-10-09-auto-reply.md): modes per channel, the thread a
 * heard reply maps to, and when a draft on arrival skips. Synthetic threads (`../inbox-seed.ts`).
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { autoModes, draftable, setAutoMode, threadOfReply } from "../../src/inbox/auto.js";
import { optionsOf, partyOf } from "../../src/inbox/conversation.js";
import { reviewHow, reviewOf } from "../../src/inbox/review.js";
import { askReply } from "../../src/inbox/send.js";
import { type MapsRead, mapsRows } from "../../src/social/maps-reviews.js";
import { reviewRecord } from "../../src/social/review-record.js";
import { ringLowReviews } from "../../src/social/review-ring.js";
import { keepReviews } from "../../src/social/store.js";
import { INBOX_TABLES, type InboxSeed, seedInbox } from "../inbox-seed.js";

let pg: TestPostgres;
let s: InboxSeed;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(async () => {
  await truncate(pg.db, ["auto_replies", "client_members", "clients", ...INBOX_TABLES]);
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

  const place = "ChIJsynthetic_place-0001";
  const maps: MapsRead = {
    placeId: place,
    name: "Synthetic Bakery",
    url: `https://www.google.com/maps/place/?q=place_id:${place}`,
    reviews: [
      {
        id: "ChZDSUhNsynthetic1",
        author: "Jordan Lee",
        authorUrl: null,
        stars: 1,
        text: "Showed up late.",
        at: "2026-10-08T10:00:20Z",
        estimated: false,
        ago: "a day ago",
        edited: false,
        reply: null,
      },
    ],
  };

  it("keeps a Maps review once, copied to Google, until the API takes it over", async () => {
    const [kept] = await keepReviews(pg.db, "google_business", mapsRows(maps), now);
    expect(await keepReviews(pg.db, "google_business", mapsRows(maps), now)).toEqual([]);
    const p = await partyOf(pg.db, `comment:${kept?.id}`);
    if (!p) throw new Error("no party");
    const [own] = await optionsOf(pg.db, p);
    expect(own).toMatchObject({ label: "Copy and post on Google", copy: maps.url, off: null });
    // The Business Profile API reads it later, 20 seconds off: one row, now the API's.
    expect(await keep()).toHaveLength(1);
    const [row] = await pg.db.execute(
      sql`select count(*)::int n, max(ref) ref from comments where author = 'Jordan Lee'`,
    );
    expect(row).toEqual({ n: 1, ref: "accounts/1/locations/2/reviews/a" });
    const [after] = await optionsOf(pg.db, p);
    expect(after?.copy).toBeUndefined();
  });

  it("rings a client's owners for a 1 or 2 star review", async () => {
    await pg.db.execute(
      sql`insert into clients (id, name, database) values ('kappa', 'Kappa', 'wren_client_kappa')`,
    );
    await pg.db.execute(sql`insert into client_members (client_id, email, role) values
      ('kappa', 'Owner@kappa.example', 'owner'), ('kappa', 'staff@kappa.example', 'member')`);
    const kept = await keep();
    const ids = kept.map((k) => k.id);
    expect(await ringLowReviews(pg.db, pg.db, "kappa", ids, now)).toBe(1);
    const notes = await pg.db.execute(sql`select n.thread, n.body, m.who from inbox_notes n
      join note_mentions m on m.inbox_note_id = n.id`);
    expect(notes).toEqual([
      {
        thread: `comment:${ids[0]}`,
        body: "2 star review from Jordan Lee. It needs a reply. @owner@kappa.example",
        who: "owner@kappa.example",
      },
    ]);
  });
});
