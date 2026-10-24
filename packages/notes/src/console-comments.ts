/** Notes handlers for comments and mentions. */
import { WREN } from "@wren/core/access";
import { PortalRefusal } from "@wren/core/portal";
import { atLeast } from "./access.js";
import { iso, type NotesApiContext, type Req, str } from "./console-context.js";
import { nameOf } from "./doc.js";
import { inboxMentionsOf, unseenInboxMentions } from "./inbox.js";
import type { NoteComment } from "./schema.js";
import {
  addComment,
  commentById,
  commentsOf,
  deleteComment,
  editComment,
  mentionsOf,
  resolveComment,
  unseenMentions,
} from "./store.js";
import { COMMENT_MAX, type CommentAnchor, QUOTE_MAX } from "./types.js";

const anchorOf = (v: unknown): CommentAnchor | null => {
  if (!v || typeof v !== "object") return null;
  const a = v as { from?: unknown; to?: unknown };
  if (!a.from || !a.to || typeof a.from !== "object" || typeof a.to !== "object") return null;
  if (JSON.stringify(a).length > 2000) throw new PortalRefusal("that range is too long", 400);
  return { from: a.from, to: a.to };
};

const commentOut = (c: NoteComment, me: string) => ({
  id: c.id,
  parentId: c.parentId,
  anchor: c.anchor,
  quote: c.quote,
  body: c.body,
  mentions: c.mentions,
  by: c.by,
  mine: c.by === me,
  at: iso(c.at) as string,
  editedAt: iso(c.editedAt),
  resolvedAt: iso(c.resolvedAt),
  resolvedBy: c.resolvedBy,
});

export function commentsHandlers(notes: NotesApiContext) {
  const { main, placeOf, readerOf, markMentions, byOf, locate, tell, mentioned } = notes;
  return {
    /** The note's comment threads, each with its replies, oldest first. */
    async comments(req: Req<{ id?: unknown }>) {
      const { db, note, reader, role } = await locate(req, req.id, "view");
      const rows = await commentsOf(db, note.id);
      const me = reader.email;
      const threads = rows
        .filter((c) => !c.parentId)
        .map((c) => ({
          ...commentOut(c, me),
          replies: rows.filter((r) => r.parentId === c.id).map((r) => commentOut(r, me)),
        }));
      return { threads, canComment: atLeast(role, "comment") && !!me, owner: role === "owner" };
    },
    /** Where this person was `@`ed, and how many they haven't opened: the Notes tab's number. */
    async mentions(req: Req<{ limit?: unknown }>) {
      const place = await placeOf(req);
      const reader = await readerOf(req, place);
      if (!reader.email) return { mentions: [], unseen: 0 };
      const out = (rows: Awaited<ReturnType<typeof mentionsOf>>, home: string) =>
        rows.map((m) => ({
          id: m.id,
          noteId: m.noteId as string | null,
          name: nameOf(m.title, m.text),
          commentId: m.commentId,
          comment: m.comment,
          by: m.by,
          at: iso(m.at) as string,
          seen: m.seenAt !== null,
          home,
          thread: null as string | null,
        }));
      const limit = Number(req.limit) || 50;
      const mentions = out(await mentionsOf(place.db, reader, limit), place.ws);
      let unseen = await unseenMentions(place.db, reader);
      // A client's Inbox notes: its people and the team on it tag each other there. Wren's own
      // land in Inbox -> Mentions.
      if (place.ws !== WREN) {
        const inbox = await inboxMentionsOf(place.db, reader.email, limit);
        mentions.push(
          ...inbox.map((m) => ({
            id: m.id,
            noteId: null,
            name: "an Inbox thread",
            commentId: null,
            comment: m.text,
            by: m.by,
            at: iso(m.at) as string,
            seen: m.seenAt !== null,
            home: place.ws,
            thread: m.thread,
          })),
        );
        unseen += await unseenInboxMentions(place.db, reader.email);
        mentions.sort((a, b) => b.at.localeCompare(a.at));
      }
      // A client's people are also `@`ed in Wren's notes shared to their client.
      if (place.ws !== WREN && !reader.team) {
        const wr = { ...reader, team: false, inWorkspace: false };
        mentions.push(...out(await mentionsOf(main, wr, limit), WREN));
        unseen += await unseenMentions(main, wr);
        mentions.sort((a, b) => b.at.localeCompare(a.at));
      }
      return { mentions: mentions.slice(0, limit), unseen };
    },
    /**
     * Mark these mentions of the signed-in person read, here and, for a client's people, in
     * Wren's notes shared to them. Only their own: anyone else's id is skipped.
     */
    mentionsRead: (req: Req<{ ids?: unknown }>) => markMentions(req, true),
    /** Mark them unread again: Mark read's Undo. */
    mentionsUnread: (req: Req<{ ids?: unknown }>) => markMentions(req, false),
    /**
     * A new thread on a range, or a reply in one. `@email` in the words tells that person, if
     * they're in this workspace; it never shares the note.
     */
    async comment(
      req: Req<{
        id?: unknown;
        body?: unknown;
        parentId?: unknown;
        anchor?: unknown;
        quote?: unknown;
      }>,
    ) {
      const { db, note, place, reader, home } = await locate(req, req.id, "comment");
      const by = byOf(req);
      const body = str(req.body, COMMENT_MAX, "the comment").trim();
      if (!body) throw new PortalRefusal("write something", 400);
      let parentId: string | null = null;
      if (req.parentId !== undefined && req.parentId !== null) {
        const parent = await commentById(db, note.id, String(req.parentId));
        if (!parent || parent.parentId) throw new PortalRefusal("no such comment", 404);
        parentId = parent.id;
      }
      const anchor = parentId ? null : anchorOf(req.anchor);
      // A card's talk sits under its title, on no range.
      if (!parentId && !anchor && note.kind !== "task")
        throw new PortalRefusal("select the words to comment on", 400);
      const c = await addComment(db, {
        noteId: note.id,
        by,
        body,
        parentId,
        anchor,
        quote: typeof req.quote === "string" ? req.quote.slice(0, QUOTE_MAX) : "",
        mentions: await mentioned(place, body),
      });
      await tell(home, place);
      return commentOut(c, reader.email);
    },
    /** Its author's new words. */
    async commentEdit(req: Req<{ id?: unknown; commentId?: unknown; body?: unknown }>) {
      const { db, note, place, reader, home } = await locate(req, req.id, "comment");
      const by = byOf(req);
      const c = await commentById(db, note.id, String(req.commentId ?? ""));
      if (!c) throw new PortalRefusal("no such comment", 404);
      if (c.by !== by) throw new PortalRefusal("only its author can change it", 403);
      const body = str(req.body, COMMENT_MAX, "the comment").trim();
      if (!body) throw new PortalRefusal("write something", 400);
      const edited = await editComment(db, c, body, await mentioned(place, body));
      await tell(home, place);
      return commentOut(edited, reader.email);
    },
    /** Gone, with its replies when it starts a thread: its author's, or the note owner's call. */
    async commentDelete(req: Req<{ id?: unknown; commentId?: unknown }>) {
      const { db, note, role } = await locate(req, req.id, "comment");
      const by = byOf(req);
      const c = await commentById(db, note.id, String(req.commentId ?? ""));
      if (!c) throw new PortalRefusal("no such comment", 404);
      if (c.by !== by && role !== "owner")
        throw new PortalRefusal("only its author or the note's owner can delete it", 403);
      await deleteComment(db, c.id);
      return { deleted: c.id };
    },
    /** Resolve a thread, or open it again. */
    async resolve(req: Req<{ id?: unknown; commentId?: unknown; on?: unknown }>) {
      const { db, note } = await locate(req, req.id, "comment");
      const by = byOf(req);
      const c = await commentById(db, note.id, String(req.commentId ?? ""));
      if (!c || c.parentId) throw new PortalRefusal("no such thread", 404);
      const on = req.on !== false;
      await resolveComment(db, c.id, on ? by : null);
      return { resolved: on };
    },
  };
}
