/**
 * Mail for a mention (designs/2026-10-07-notes.md): someone `@`ed in a note, a comment or an
 * Inbox note hears of it by email once, unless they saw it first. Only mentions from the last day,
 * and only in notes they may open: one in a note not shared with them waits until it is.
 */
import type { Queryable } from "@wren/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Reader } from "./access.js";
import { inboxNotes, type Note, noteComments, noteMentions, notes } from "./schema.js";
import { roleOn } from "./store.js";

export interface MentionMail {
  to: string;
  subject: string;
  text: string;
}
export type SendMention = (m: MentionMail) => Promise<void>;

/** How long an unseen mention may wait for its mail. */
const WITHIN_MS = 24 * 3600_000;
const EXCERPT = 400;

export interface MailMentionsOpts {
  send: SendMention;
  /** The portal's origin, for the link. */
  portal: string;
  /** The client this database is, for the link's `?client=`; null at Wren. */
  client: string | null;
  /** Who they are here, or null when they aren't someone this workspace can `@`. */
  readerOf: (email: string) => Promise<Omit<Reader, "cap"> | null>;
  now?: Date;
}

const clip = (s: string) => (s.length > EXCERPT ? `${s.slice(0, EXCERPT - 1)}…` : s);
const nameOf = (n: Note) =>
  n.title.trim() || n.text.trim().split("\n")[0]?.slice(0, 80) || "Untitled";

/** Mail every waiting mention in this database once. The number mailed. */
export async function mailMentions(db: Queryable, o: MailMentionsOpts): Promise<number> {
  const now = o.now ?? new Date();
  const rows = await db
    .select({
      id: noteMentions.id,
      who: noteMentions.who,
      by: noteMentions.by,
      noteId: noteMentions.noteId,
      commentId: noteMentions.commentId,
      comment: noteComments.body,
      thread: inboxNotes.thread,
      inboxBody: inboxNotes.body,
    })
    .from(noteMentions)
    .leftJoin(noteComments, eq(noteComments.id, noteMentions.commentId))
    .leftJoin(inboxNotes, eq(inboxNotes.id, noteMentions.inboxNoteId))
    .where(
      and(
        isNull(noteMentions.mailedAt),
        isNull(noteMentions.seenAt),
        gt(noteMentions.at, new Date(now.getTime() - WITHIN_MS)),
      ),
    )
    .orderBy(noteMentions.at)
    .limit(100);
  const q = o.client ? `client=${encodeURIComponent(o.client)}` : "";
  const origin = o.portal.replace(/\/+$/, "");
  let n = 0;
  for (const r of rows) {
    let mail: MentionMail;
    if (r.noteId) {
      const [note] = await db.select().from(notes).where(eq(notes.id, r.noteId));
      if (!note || note.archivedAt) continue;
      const reader = await o.readerOf(r.who);
      if (!reader || !(await roleOn(db, note, reader))) continue;
      const params = [r.commentId ? `comment=${r.commentId}` : "", q].filter(Boolean).join("&");
      const name = nameOf(note);
      mail = {
        to: r.who,
        subject: `${r.by} mentioned you in ${name}`,
        text: [
          `${r.by} mentioned you ${r.commentId ? "in a comment on" : "in"} "${name}":`,
          "",
          clip((r.comment ?? note.text).trim()),
          "",
          `Open it: ${origin}/notes/doc/${note.id}${params ? `?${params}` : ""}`,
        ].join("\n"),
      };
    } else if (r.thread) {
      mail = {
        to: r.who,
        subject: `${r.by} mentioned you in an Inbox note`,
        text: [
          `${r.by} mentioned you in a note on an Inbox thread:`,
          "",
          clip((r.inboxBody ?? "").trim()),
          "",
          `Open it: ${origin}/inbox/waiting/${encodeURIComponent(r.thread)}${q ? `?${q}` : ""}`,
        ].join("\n"),
      };
    } else continue;
    // Claimed first, so two passes never mail it twice; a failed send gives it back.
    const [claimed] = await db
      .update(noteMentions)
      .set({ mailedAt: now })
      .where(and(eq(noteMentions.id, r.id), isNull(noteMentions.mailedAt)))
      .returning({ id: noteMentions.id });
    if (!claimed) continue;
    try {
      await o.send(mail);
      n++;
    } catch (e) {
      console.warn(`mention mail to ${r.who} failed: ${(e as Error).message}`);
      await db.update(noteMentions).set({ mailedAt: null }).where(eq(noteMentions.id, r.id));
    }
  }
  return n;
}
