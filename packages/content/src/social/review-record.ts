/**
 * Marketing → Reviews (`marketing.review`, designs/2026-10-09-review-replies.md): every review of
 * the business with its stars and where its reply stands. Open goes to the thread, where the
 * drafted reply waits.
 */

import { date, defineRecord, link, name, number, prose, status } from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { PLATFORM_LABELS } from "@wren/outreach/records";
import { sql } from "drizzle-orm";
import { conversationOf } from "../inbox/conversation.js";

/** ponytail: rows, not a view: a business has hundreds of reviews, not thousands. */
const REVIEW_ROWS = 1000;

const rowsOf = async (db: Queryable) =>
  (await db.execute(
    sql`select c.id, c.platform, c.author who, c.stars, c.body words, c.at, c.answer,
        case when c.state = 'answered' then 'replied'
          when exists (select 1 from inbox_replies r
            where r.thread = 'comment:' || c.id and r.state = 'waiting') then 'drafted'
          else 'none' end reply
      from comments c where c.kind = 'review'
      order by c.at desc limit ${REVIEW_ROWS}`,
  )) as unknown as Array<Record<string, unknown>>;

export const reviewRecord = defineRecord({
  id: "marketing.review",
  app: "marketing",
  channel: { field: "platform" },
  name: { one: "review", many: "reviews" },
  rows: async (db) =>
    (await rowsOf(db)).map((r) => ({
      ...r,
      id: `comment:${r.id}`,
      band: r.stars != null && Number(r.stars) <= 3 ? "low" : "high",
      url: `/marketing/inbox/${encodeURIComponent(`comment:${r.id}`)}`,
    })),
  key: "id",
  title: "who",
  subtitle: "words",
  fields: {
    who: name("Who"),
    stars: number("Stars"),
    band: status(
      {
        low: { label: "1 to 3 stars", tone: "warn" },
        high: { label: "4 or 5 stars", tone: "good" },
      },
      "Stars",
      { listed: false },
    ),
    words: prose("Their words"),
    reply: status(
      {
        none: { label: "No reply", tone: "warn" },
        drafted: { label: "Drafted", tone: "neutral" },
        replied: { label: "Replied", tone: "good" },
      },
      "Reply",
    ),
    answer: prose("Our reply", { listed: false }),
    platform: status(PLATFORM_LABELS, "Site"),
    at: date("When"),
    url: link("Open the thread"),
  },
  views: [
    {
      id: "waiting",
      label: "Needs reply",
      where: { reply: ["none", "drafted"] },
      sort: "-at",
      at: "at",
    },
    { id: "low", label: "1 to 3 stars", where: { band: "low" }, sort: "-at", at: "at" },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
  load: async (db, id) => ({ conversation: await conversationOf(db, id) }),
});
