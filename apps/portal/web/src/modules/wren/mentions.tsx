/**
 * Inbox → Mentions: where someone `@`ed you in an Inbox note, yours only (`inbox.mention`, a
 * `mine` type). Open thread goes to the thread; Mark read clears it without opening.
 */
import type { Row } from "@wren/core/records/serve";
import { type Action, ButtonLink, said } from "@wren/ui";

export const MENTION_ACTIONS: Action[] = [
  {
    id: "inbox.mentionRead",
    label: "Mark read",
    icon: "read",
    handler: "inbox/mentionsRead",
    undo: "inbox/mentionsUnread",
    bulk: true,
    key: "e",
    when: { state: ["unread"] },
    sets: { state: "read" },
    done: said("Marked read"),
  },
];

export const mentionExtras = (_: unknown, { row }: { row: Row }) => ({
  lead: (
    <ButtonLink
      tone="primary"
      icon="note"
      href={`/today/messages/${encodeURIComponent(String(row.thread ?? ""))}`}
    >
      Open thread
    </ButtonLink>
  ),
});
