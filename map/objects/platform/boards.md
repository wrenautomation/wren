---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-14 @ c6ed8dff
entity: packages/notes/src/schema.ts:59
---

# boards

A lean kanban inside Notes (designs/2026-10-14-boards.md). A card is a note of kind `task`, on a board, in one column. Boards have ordered columns; a column marked `done` closes the cards that land in it. Wren's team and a client's people use them; agents use `wren tasks`.

## Why this shape

A card is a note, so it already has a body, comments, history, sharing and `@` links. Nothing is rebuilt for it. The task fields (`board_id`, `column_id`, `position`, `assignee`, `due`, `closed_at`) sit on `notes` beside `kind = 'task'`, and a check keeps `board_id` off any other kind (`ck_notes_board_task`). A card's role is the better of its note role and its board role, a board owner capped at edit (`boardRoleOn`, `packages/notes/src/boards.ts:74`). Moves are stored by column id and named from the board's current columns, so a rename never breaks the Timeline. `position` is a fractional string ordered `collate "C"`, so a drop writes one row (`positionBetween`, `packages/notes/src/position.ts:27`).

## Shape

- tables in every database: `boards` (`columns` jsonb `{id,name,done}`, `owner`, `general`, `is_default`, `archived_at`), `board_shares` (same `who` forms as `note_shares`: email, `team`, `client:<id>`), `task_blocks` (`task_id` waits on `blocked_by`), `task_moves` (the Timeline: `kind` create | move | assign | close | reopen, columns, assignee, `by`, `why`); `notes` gains the task fields (`packages/notes/src/schema.ts:59`, migration `0263_boards`)
- one default board per database, "Work" with To do, Doing, Done, made on first open (`defaultBoard`, `boards.ts:101`, unique on `is_default`); it is shared to the workspace for edit, cannot be archived or made private
- the card store (`packages/notes/src/tasks.ts`): `createTask`, `moveTask` (a drop into a done column closes; out of one reopens), `closeTask`, `reopenTask`, `assignTask`, `setDue`, `moveToBoard`, `blockTask`/`unblockTask` (no self or cycle), `readyTasks`, `needsYou`
- ready = open, not archived, owned by you or nobody, and no open blocker (`readyTasks`, `tasks.ts:196`)
- agent rule: an agent that moves or closes a card owned by a person into a done column is sent to Review (the column named Review, else the last open one) and told so (`moveTask`, `tasks.ts:434`); a card nobody or an agent owns can be closed by an agent
- columns can be edited in Board settings, but a column holding cards cannot be removed or flipped to done (`saveBoard`, `boards.ts:185`)
- routes: `NotesConsole` `boards`, `board`, `boardCreate|Save|Share|General|Archive`, `task`, `taskMoves`, `taskAdd|Move|Edit|Close|Block`, `taskFromLine`, `taskExport`, `taskImport`, `needsYou`, `driveTitle` (`packages/notes/src/console-boards.ts:129`, roles in `console-routes.ts:51`); the writes are journaled
- record type `notes.task` (`packages/notes/src/task-records.ts:23`), served by the notes `records*` routes and, for Wren's team, the console's generic records; the List view and record backlinks read it
- "Needs you" = open cards owned by you and due today or earlier, plus cards waiting on a card you own (`needsYou`, `tasks.ts:268`); it shows as the Board tab's badge and in Today
- Make card: checklist lines of a note become cards on the viewer's default board; the card body names the source note (`note:<id>`) and the line gets a "Card: <column>" chip (`taskFromLine`; `apps/portal/web/src/modules/notes/cards.ts`). The chip shows the card's current column, read for all of a note's cards at once (`cardChips`; `packages/notes/src/chips.ts`). ⌘K "card: <title>" and the Quick note "Card" switch make one directly
- Turn into cards: Claude reads a note and proposes cards (`cardsPropose`, `packages/notes/src/propose.ts`): owners only from people the note @-mentions, real days, at most 30. Writes nothing; the picks go through `taskFromLine` with owner, due and board (`apps/portal/web/src/modules/notes/propose.tsx`). The worker wires the model as `NotesDeps.write`, null on the fake LLM
- labels: `notes.labels` (migration `0264_boards_labels`), edited in the card strip, on card faces, a Label filter, the CSV "labels" column, `wren tasks --label`
- owner names: `ownerName` (`packages/notes/src/types.ts`) for every face, filter, List, Timeline and the CLI; `agent:claude` reads "Claude"
- sheets: Export CSV builds a file from `taskExport` rows (title, column, owner, due, labels, blocked by, link); Import takes a CSV or a pasted tab table, maps columns once, and updates by link when the link holds a card of that board, else makes a card (`taskImport`, `console-boards.ts:541`; pure parser and writer in `packages/notes/src/sheet.ts`, cells starting `= + - @` get a leading `'`). Bad owner, column or due warns and keeps the row
- pasted file links: a Drive, Docs, Sheets, Slides, Dropbox or OneDrive link becomes a labelled link; a Google file is renamed to its title (`driveTitle`, `NoteDrive.title`, `packages/notes/src/drive.ts`; `apps/portal/web/src/modules/notes/filelinks.ts`)
- clients: a board shared to `client:<id>` shows as Board in that client's Notes, read from main, and its cards follow the board's role
- not here: sprints, points, swimlanes, WIP limits, automations, Gantt, two-way Sheets sync

## Connected to

- **extends:** [[platform/notes]] (a card is a note; its doc page, comments, sharing and backlinks)
- **served by:** [[platform/records]] (`notes.task`)
- **feeds:** `wren tasks` (`apps/cli/src/tasks.ts:70`), agents write as `agent:<name>`
- **shows on:** record pages, as a "Card: <column>" tag in the Notes backlinks (`apps/portal/web/src/modules/notes/backlinks.tsx`)
- **looks-like-but-is-not:** [[leads/sent-log]] and the Inbox "To approve" (cards never send); Turn into cards never writes before Add

## If you change this

- **Hits:** `notes.kind` is checked in the database (`ck_notes_kind`); a new kind needs a migration
- **Hits:** the column ids in `task_moves` and `notes.column_id`; a removed column would orphan them, so removal is refused while it holds cards
- **Hits:** the `notes.task` record fields, `wren tasks` output and the CSV header names (`SHEET_FIELDS`); users keep files that use them
- **Also hits:** the Notes home hides kind `task` unless asked, so a new notes list must do the same (`packages/notes/src/store.ts`)
- **Also hits:** the Board tab badge and Today's Needs you, both from `needsYou`
- **Does not hit:** anything that posts or sends to a lead

## Surfaces

| Surface | Role |
|---|---|
| Notes → Board (`apps/portal/web/src/modules/notes/board.tsx`) | columns, drag, filters, List toggle, Board settings, Export CSV, Import |
| the doc page (`card.tsx`) | task strip (column, owner, due, board, blocked by, blocks) and the Timeline panel |
| editor toolbar, note menu, ⌘K, Quick note | Make card, Turn into cards with Claude, New card |
| `wren tasks ready\|ls\|show\|add\|move\|assign\|due\|close\|reopen\|comment\|block` (`apps/cli/src/tasks.ts`) | agents; `--json`, `--agent <name>` |

## See

- Design: `designs/2026-10-14-boards.md`
- Tests: `packages/notes/test/integration/tasks.test.ts`, `packages/notes/test/integration/boards.test.ts`, `packages/notes/src/sheet.test.ts`
