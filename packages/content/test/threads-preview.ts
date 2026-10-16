/**
 * A local database for looking at Engage's threads (designs/2026-10-15-engage-threads.md): the
 * Inbox's synthetic seed, plus a Reddit thread where one person replied under our comment, then
 * replied to their own reply, and a third person answered them. Local only.
 *
 *   WREN_DATABASE_URL=postgres://...@127.0.0.1:5434/wren_threads_preview \
 *     npx tsx packages/content/test/threads-preview.ts
 */
import type { ThreadNode } from "@wren/core/outreach";
import { createDb, migrate } from "@wren/db";
import {
  addAccount,
  applyThread,
  keepComments,
  setAccountState,
  watchFromComments,
} from "@wren/outreach";
import { commentThreads } from "@wren/outreach/schema";
import { sql } from "drizzle-orm";
import { INBOX_TABLES, seedInbox } from "./inbox-seed.js";

const url = process.env.WREN_DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("a local database only");
const { db, close } = createDb(url, { max: 1 });
await migrate(db);
await db.execute(
  sql.raw(
    `truncate ${["comment_threads", ...INBOX_TABLES].map((t) => `"${t}"`).join(", ")} restart identity cascade`,
  ),
);
const me = "preview@localhost";
await db.execute(sql`insert into operators (email, role) values (${me}, 'admin')
  on conflict do nothing`);
await seedInbox(db);

const now = new Date();
const ago = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
const added = await addAccount(db, { platform: "reddit", account: "reddit@wren", now });
const acct = await setAccountState(db, added.id, "warming", { reason: null, now });
await db.execute(sql`update reach_accounts set handle = 'wren_test' where id = ${acct.id}`);
const link = (ref: string) => `https://www.reddit.com/r/smallbusiness/comments/p1/x/${ref}/`;
const node = (
  ref: string,
  parent: string,
  handle: string,
  m: number,
  text: string,
): ThreadNode => ({
  ref,
  parent,
  handle,
  text,
  at: ago(m),
  url: link(ref),
});
const nodes = [
  node(
    "t1_ours",
    "t3_p1",
    "wren_test",
    300,
    "We text every missed call back within a minute. Most people answer the text.",
  ),
  node(
    "t1_a1",
    "t1_ours",
    "harbor_plumbing",
    240,
    "We tried this. Customers liked it more than voicemail.",
  ),
  node(
    "t1_a2",
    "t1_a1",
    "harbor_plumbing",
    200,
    "Follow-up: does it work after hours, or only when someone's in the office?",
  ),
  node(
    "t1_b1",
    "t1_a2",
    "north_hvac",
    150,
    "Same question here. Nights are when we lose the most calls.",
  ),
  node("t1_x1", "t3_p1", "quiet_reader", 120, "Saving this thread."),
];
// The inbox showed only the direct reply.
await keepComments(
  db,
  acct,
  [
    {
      ref: "t1_a1",
      post: "t3_p1",
      parent: "t1_ours",
      kind: "comment_reply",
      place: "smallbusiness",
      postTitle: "How do you handle missed calls?",
      handle: "harbor_plumbing",
      text: "We tried this. Customers liked it more than voicemail.",
      url: link("t1_a1"),
      at: ago(240),
      raw: {},
    },
  ],
  ["wren_test"],
);
await watchFromComments(db, now, 7, ["reddit"]);
const [t] = await db.select().from(commentThreads);
if (!t) throw new Error("no watch");
await applyThread(
  db,
  t,
  acct,
  {
    post: {
      ref: "t3_p1",
      title: "How do you handle missed calls?",
      text: "Small shop, two trucks. We miss calls on jobs and lose the work. What do you do?",
      handle: "busy_owner",
      url: "https://www.reddit.com/r/smallbusiness/comments/p1/x/",
      place: "smallbusiness",
      media: null,
      at: ago(400),
      count: nodes.length,
    },
    nodes,
    more: 1,
  },
  ["wren_test"],
  now,
  0.5,
  7,
);
await close();
console.log("seeded");
