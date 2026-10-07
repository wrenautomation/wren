/**
 * A local database for looking at the Inbox (designs/2026-10-07-inbox-reply.md): migrated, then
 * the synthetic threads, a note with a mention, an asked reply, and threads assigned to the
 * preview's operator. Local only: it refuses any host but localhost.
 *
 *   WREN_DATABASE_URL=postgres://...@127.0.0.1:5434/wren_inbox_preview \
 *     npx tsx packages/content/test/inbox-preview.ts
 */
import { createDb, migrate } from "@wren/db";
import { addInboxNote } from "@wren/notes/inbox";
import { sql } from "drizzle-orm";
import { askReply } from "../src/inbox/send.js";
import { setThread } from "../src/inbox/threads.js";
import { INBOX_TABLES, seedInbox } from "./inbox-seed.js";

const url = process.env.WREN_DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("a local database only");
const { db, close } = createDb(url, { max: 1 });
await migrate(db);
await db.execute(
  sql.raw(`truncate ${INBOX_TABLES.map((t) => `"${t}"`).join(", ")} restart identity cascade`),
);
const me = "preview@localhost";
await db.execute(sql`insert into operators (email, role) values (${me}, 'admin')
  on conflict do nothing`);
const s = await seedInbox(db);
const now = new Date();
const text = `text:${s.smsId}`;
await addInboxNote(db, {
  thread: text,
  personId: s.personId,
  body: `@${s.operator} she asked about Spanish. Can you check the voice options before the call?`,
  by: me,
  team: [me, s.operator, s.admin],
  now: new Date(now.getTime() - 20 * 60_000),
});
await setThread(db, text, { assignee: me }, me, now);
await setThread(db, `comment:${s.commentId}`, { assignee: me }, me, now);
await setThread(db, `reply:${s.replyId}`, { assignee: s.operator }, me, now);
await askReply(db, {
  thread: `comment:${s.commentId}`,
  option: {
    channel: "comment",
    target: String(s.commentId),
    label: "Comment on YouTube",
    platform: "youtube",
    own: true,
    off: null,
  },
  body: "Two trucks is where it pays off most. Every missed call gets a text back in seconds.",
  who: "dana_rivera",
  by: s.operator,
  why: "You can't send. Someone who can says yes.",
});
await close();
console.log("seeded");
