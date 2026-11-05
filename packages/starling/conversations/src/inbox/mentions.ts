/**
 * Where the signed-in teammate was `@`ed in an Inbox note: one person's own list (`mine`), newest
 * first. Wren's Inbox counts the unread ones; InboxDesk `mentionsRead` clears them.
 */
import {
  actor,
  date,
  defineRecord,
  type Me,
  type RecordType,
  status,
  text,
} from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { inboxMentionsOf } from "./notes.js";

export const MENTION = "inbox.mention";

/** How many rows one read carries: the newest. */
const MENTION_ROWS = 200;

async function mentionRows(db: Queryable, me?: Me | null) {
  // An Inbox note is the team's: a client's login never reads one here.
  if (!me?.email || !me.team) return [];
  return (await inboxMentionsOf(db, me.email, MENTION_ROWS)).map((m) => ({
    id: m.id,
    words: m.text,
    state: m.seenAt ? "read" : "unread",
    by: m.by,
    who: me.email,
    at: m.at.toISOString(),
    thread: m.thread,
  }));
}

export const mentionRecord: RecordType = defineRecord({
  id: MENTION,
  app: "inbox",
  channel: null,
  name: { one: "mention", many: "mentions" },
  rows: mentionRows,
  mine: "who",
  key: "id",
  title: "words",
  fields: {
    words: text("Words"),
    state: status(
      { unread: { label: "Unread", tone: "warn" }, read: { label: "Read", tone: "neutral" } },
      "State",
    ),
    by: actor("From"),
    at: date("When"),
    who: actor("For", { listed: false }),
    thread: text("Inbox thread", { listed: false, group: "System" }),
  },
  views: [
    { id: "unread", label: "Unread", where: { state: "unread" }, sort: "-at", at: "at" },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
  actions: ["inbox.mentionRead"],
  // Mark read on one's own row: a login without `run` may call it, naming that row.
  calls: { "InboxDesk/mentionsRead": "ids", "InboxDesk/mentionsUnread": "ids" },
});
