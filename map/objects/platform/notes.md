---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-11-04 @ 434a3c28
entity: packages/starling/conversations/src/notes-schema.ts
---

# notes

Team notes on an Inbox thread or a person, never sent, and the `@` mentions in them. The Notes app (docs, boards, cards, live editing) was cut 11-04 (WA-1067); its tables stay until the lake takes them.

## Why this shape

A note is plain text on the thread, not a doc. The Inbox is where the team talks about a lead, so notes and mentions live in the conversations package beside it.

## Parts

- tables in every database: `inbox_notes` (migration 0178) and `note_mentions` (`inbox_note_id`). The cut app's tables (`notes`, `note_updates`, `note_versions`, `note_shares`, boards, tasks…) stay in the same schema file, unwritten
- write: `addInboxNote` (`packages/starling/conversations/src/inbox/notes.ts`) keeps the note and a `note_mentions` row per teammate `@`ed (`@email`; strangers dropped)
- read: `inboxNotesOf` (on the thread), `inboxMentionsOf` (one person's)
- record `inbox.mention` (`inbox/mentions.ts`): a `mine` list, team only; the Inbox tile counts unread. Mark read is `InboxDesk/mentionsRead`, undo `mentionsUnread` (`markInboxMentions`)
- mention mail: `mailMentions` (`inbox/mention-mail.ts`) emails each unseen mention from the last day once (`note_mentions.mailed_at`), linking `/today/messages/<thread>`. InboxDesk runs it after a note, through the booker mailer
- portal: `NoteBox` (`apps/portal/web/src/modules/marketing/note-box.tsx`) on the thread; ⌘Enter keeps it

## Edges

- **joins:** [[content/inbox-thread]]
- **Also hits:** the booker mailer (mention mail)
