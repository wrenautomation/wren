/**
 * Notes as records: where the signed-in person was `@`ed (designs/2026-10-07-notes.md,
 * "Comments, suggestions, mentions"). One person's own list, so the type is `mine`: whoever
 * reads it gets their mentions only, and only in notes they may open. Wren's Inbox counts the
 * unread ones on a tile; the console serves it on Wren's database.
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
import { nameOf } from "./doc.js";
import { mentionsOf } from "./store.js";

export const MENTION = "notes.mention";

/** How many rows one read carries: the newest. */
const MENTION_ROWS = 200;

/** The person's mentions in Wren's notes they may open, newest first; none for nobody. */
async function mentionRows(db: Queryable, me?: Me | null) {
  if (!me?.email) return [];
  // Wren's workspace: its team are its people, and nobody there is a client's.
  const reader = { email: me.email, team: me.team, inWorkspace: me.team, client: null };
  const rows = await mentionsOf(db, reader, MENTION_ROWS);
  return rows.map((m) => ({
    id: m.id,
    note: nameOf(m.title, m.text),
    words: m.comment ?? m.text,
    place: m.commentId ? "comment" : "note",
    state: m.seenAt ? "read" : "unread",
    by: m.by,
    who: me.email,
    at: m.at.toISOString(),
    note_id: m.noteId,
    comment_id: m.commentId,
  }));
}

export const mentionRecord: RecordType = defineRecord({
  id: MENTION,
  app: "notes",
  channel: null,
  name: { one: "mention", many: "mentions" },
  rows: mentionRows,
  mine: "who",
  key: "id",
  title: "note",
  subtitle: "words",
  fields: {
    note: text("Note"),
    words: text("Words"),
    place: status(
      {
        note: { label: "In the note", tone: "neutral" },
        comment: { label: "In a comment", tone: "neutral" },
      },
      "Where",
    ),
    state: status(
      { unread: { label: "Unread", tone: "warn" }, read: { label: "Read", tone: "neutral" } },
      "State",
    ),
    by: actor("From"),
    at: date("When"),
    who: actor("For", { listed: false }),
    noteId: text("Note id", { listed: false, group: "System" }),
    commentId: text("Comment id", { listed: false, group: "System" }),
  },
  views: [
    { id: "unread", label: "Unread", where: { state: "unread" }, sort: "-at", at: "at" },
    { id: "all", label: "All", sort: "-at", at: "at" },
  ],
  actions: ["notes.mentionRead"],
});

export const NOTES_RECORDS: readonly RecordType[] = [mentionRecord];
