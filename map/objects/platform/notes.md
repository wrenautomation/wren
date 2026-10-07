---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-07 @ aac16d11
entity: packages/notes/src/schema.ts:38
---

# notes

Docs in the portal: rough thoughts to full docs, for Wren's team and a client's people. Each note is a Yjs doc in Postgres with a version timeline, sharing by role, `@` links to records, and full-text search (designs/2026-10-07-notes.md).

## Why this shape

Yjs is the source of truth (`notes.y_state`), so offline edits and two people's edits merge; everything else (`body`, `text`, `title`, links) is derived on each change (`changeNote`, `packages/notes/src/store.ts:153`). Every update is kept (`note_updates`), so any version can be rebuilt. A version is one person's sitting: their edits within 10 minutes extend it (`SESSION_MS`). Restore adds a new version; nothing is deleted, archive is the trash. Private notes stay private from admins and View as.

## Shape

- tables in every database (one schema): `notes`, `note_updates`, `note_versions`, `note_shares`, `note_stars`, `note_seen`, `note_links`, `notes_settings`, `note_comments`, `note_mentions` (`packages/notes/src/schema.ts`, migrations `0168_notes`, `0170_notes_comments`)
- roles `view | comment | edit`, plus owner; shares to an email, `team` (Wren's team) or `client:<id>`; general access `private | workspace` (`packages/notes/src/access.ts`)
- a note's role is capped by the viewer's app permission at `notes` (read, comment, act) (`readerOf`, `packages/notes/src/console.ts`)
- a Wren note shared to `client:<id>` is read from main by that client's people
- sync: the browser posts what the server lacks (by its state vector) and gets back what it lacks (`syncNote`); 5s while active, 30s idle, IndexedDB copy per note (`apps/portal/web/src/modules/notes/sync.ts`)
- live: a Durable Object per note (`NoteRoom`, `apps/portal/src/live.ts`) runs `Room` (`packages/notes/src/room.ts`): relays Yjs updates and cursors, saves through `notes/sync` as each person, and takes their role from its answer every 15s
- comments: anchored by Yjs relative positions (`note_comments.anchor`); highlights are decorations
- suggestions: `suggestAdd`/`suggestDel` marks; a commenter's sync is taken only when it just suggests (`onlySuggests`, `packages/notes/src/suggest.ts`)
- mentions: `person:<email>`, `note:<id>`, `console.client:<id>`, kept in `note_links` for backlinks; a person `@`ed in the body or a comment gets a `note_mentions` row, shown under Notes → Mentions only when they can open the note
- images: S3 under `notes/<client>/<id>/`, referenced as `wren-file:` and signed on read
- Dump: each person's capture note; Quick note (N, ⌘K "Note: …") appends a timestamped block

## Connected to

- **feeds:** Ask Claude (`notesContext` adds up to 5 matching notes the asker can open, `packages/core/src/ask.ts`)
- **feeds:** training (`wren train export --notes`, `wren.note/1`, opt-in per note or per workspace, `packages/notes/src/train.ts`)
- **shows on:** every record page as a "Notes" section of backlinks (`apps/portal/web/src/records.tsx`)
- **looks-like-but-is-not:** [[platform/template-store]] (copy that sends; notes never send)

## If you change this

- **Hits:** the Yjs field names (`Y_BODY`, `Y_TITLE`) are in every stored doc: renaming loses content
- **Hits:** `toMarkdown`/`fromMarkdown` feed the CLI, imports, downloads and training
- **Also hits:** the portal's `maxBody` for notes (5.6 MB) sits under Lambda's 6 MB
- **Also hits:** the portal Worker's `NOTE_ROOM` binding and its DO migration (`apps/portal/wrangler.toml`); the room's frame protocol is shared by `room.ts` and the page's `sync.ts`
- **Does not hit:** anything that sends

## Surfaces

| Surface | Role |
|---|---|
| `NotesConsole` (`packages/notes/src/console.ts`, routes `notes/*`) | home, open, sync, versions, compare, share, capture, backlinks, upload, training, comments, mentions |
| `/api/notes/live/<id>` (`apps/portal/src/live.ts`) | the live room's WebSocket |
| Notes app (`apps/portal/web/src/modules/notes/`) | home (views, search), Mentions, doc (editor, live cursors, outline, comments and suggestions, history, share), Quick note |
| `wren notes add\|ls\|show\|search\|append` (`apps/cli/src/notes.ts`) | agents write as `agent:<name>`; `--as` reads as a person |
| `wren train export --notes` (`apps/cli/src/train.ts`) | opted-in notes as JSONL |

## In development

Word and PDF files, Google Drive import, turn into a task, draft or SOP. Not built: a Mentions tile in Wren's Inbox and email for a mention.

## See

- Design: `designs/2026-10-07-notes.md`
- Tests: `packages/notes/src/*.test.ts`, `packages/notes/test/integration/notes.test.ts`
