/**
 * Inbox → Mentions: where someone `@`ed you in Wren's notes, yours only (`notes.mention`, a
 * `mine` type). Open note goes to the note at the mention, which marks it read; Mark read
 * clears it without opening.
 */
import type { Row } from "@wren/core/records/serve";
import { type Action, ButtonLink } from "@wren/ui";
import { docPath } from "../notes/api.js";

const said = (line: string) => () => line;

export const MENTION_ACTIONS: Action[] = [
  {
    id: "notes.mentionRead",
    label: "Mark read",
    handler: "notes/mentionsRead",
    undo: "notes/mentionsUnread",
    bulk: true,
    key: "e",
    when: { state: ["unread"] },
    sets: { state: "read" },
    done: said("Marked read"),
  },
];

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The note at the mention: its comment opened when the mention is in one. */
export function mentionLink(row: Row): string {
  const note = str(row.noteId);
  const comment = str(row.commentId);
  return comment ? `${docPath(note)}?comment=${encodeURIComponent(comment)}` : docPath(note);
}

export const mentionExtras = (_: unknown, { row }: { row: Row }) => ({
  lead: (
    <ButtonLink tone="primary" icon="note" href={mentionLink(row)}>
      Open note
    </ButtonLink>
  ),
});
