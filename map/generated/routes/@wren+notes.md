# @wren/notes: routes

Services: 1.

## NotesConsole (service via `portalService`)

File: packages/notes/src/console.ts

- **append** `?` → `?` (write): writes public.note_links, public.note_mentions, public.note_updates, public.note_versions, public.notes; reads public.boards, public.inbox_notes, public.note_comments
  - outside: npm lib0, yjs
- **archive** `?` → `?` (write): writes public.notes; reads public.boards
- **backlinks** `?` → `?` (read): reads public.board_shares, public.boards, public.note_links, public.note_shares, public.notes
- **board** `?` → `?` (read): reads public.board_shares, public.boards, public.note_shares, public.notes
- **boardArchive** `?` → `?` (write): writes public.boards; reads public.board_shares
- **boardCreate** `?` → `?` (write): writes public.boards
- **boardGeneral** `?` → `?` (write): writes public.boards; reads public.board_shares
- **boardSave** `?` → `?` (write): writes public.boards; reads public.board_shares, public.notes
- **boardShare** `?` → `?` (write): writes public.board_shares; reads public.boards
- **boards** `?` → `?` (read): writes public.boards; reads public.board_shares
- **capture** `?` → `?` (write): writes public.note_links, public.note_mentions, public.note_shares, public.note_updates, public.note_versions, public.notes; reads public.boards, public.inbox_notes, public.note_comments
  - outside: npm lib0, yjs
- **cardChips** `?` → `?` (read): reads public.board_shares, public.boards, public.note_shares, public.notes
- **cardsPropose** `?` → `?` (write)
- **comment** `?` → `?` (write): writes public.note_comments, public.note_mentions; reads public.inbox_notes, public.notes
- **commentDelete** `?` → `?` (write): writes public.note_comments; reads public.notes
- **commentEdit** `?` → `?` (write): writes public.note_comments, public.note_mentions; reads public.inbox_notes, public.notes
- **comments** `?` → `?` (read): reads public.note_comments, public.notes
- **compare** `?` → `?` (read): reads public.note_versions, public.notes
- **create** `?` → `?` (write): writes public.note_links, public.note_shares, public.note_updates, public.note_versions, public.notes; reads public.boards
  - outside: npm yjs
- **drive** `?` → `?` (read)
- **driveTitle** `?` → `?` (read)
- **file** `?` → `?` (read)
- **general** `?` → `?` (write): writes public.notes; reads public.boards
- **home** `?` → `?` (read): reads public.board_shares, public.boards, public.note_seen, public.note_shares, public.note_stars, public.notes, public.notes_settings
- **mentions** `?` → `?` (read): reads public.board_shares, public.boards, public.inbox_notes, public.note_comments, public.note_mentions, public.note_shares, public.notes
- **mentionsRead** `?` → `?` (write)
- **mentionsUnread** `?` → `?` (write)
- **move** `?` → `?` (write): writes public.notes; reads public.boards
- **nameVersion** `?` → `?` (write): writes public.note_versions; reads public.notes
- **needsYou** `?` → `?` (read): reads public.boards, public.notes, public.task_blocks
- **open** `?` → `?` (read): writes public.note_mentions, public.note_seen; reads public.board_shares, public.boards, public.inbox_notes, public.note_comments, public.note_shares, public.note_versions, public.notes
- **people** `?` → `?` (read): reads public.board_shares, public.boards, public.clients, public.note_shares, public.notes
- **recordsExport** `?` → `?` (read): reads public.custom_field_values, public.custom_fields, public.draft_events, public.draft_outcomes, public.draft_people
- **recordsGet** `?` → `?` (read): reads public.changes, public.custom_field_values, public.custom_fields, public.runs
- **recordsList** `?` → `?` (read): reads public.custom_field_values, public.custom_fields
- **recordsStats** `?` → `?` (read): reads public.custom_field_values, public.custom_fields
- **recordsTypes** `?` → `?` (read): reads public.board_shares, public.boards, public.note_shares, public.notes
- **rename** `?` → `?` (write): writes public.note_links, public.note_mentions, public.note_updates, public.note_versions, public.notes; reads public.boards, public.inbox_notes, public.note_comments
  - outside: npm lib0, yjs
- **resolve** `?` → `?` (write): writes public.note_comments; reads public.notes
- **restore** `?` → `?` (write): writes public.note_links, public.note_mentions, public.note_updates, public.note_versions, public.notes; reads public.boards, public.inbox_notes, public.note_comments
  - outside: npm lib0, yjs
- **settings** `?` → `?` (read): reads public.notes_settings
- **share** `?` → `?` (write): writes public.note_shares; reads public.clients, public.notes
- **star** `?` → `?` (write): writes public.note_stars; reads public.notes
- **sync** `?` → `?` (read): writes public.note_links, public.note_mentions, public.note_updates, public.note_versions, public.notes; reads public.boards, public.inbox_notes, public.note_comments
  - outside: npm lib0, yjs
- **task** `?` → `?` (read): reads public.board_shares, public.boards, public.notes, public.task_blocks
- **taskAdd** `?` → `?` (write): writes public.boards, public.note_links, public.note_shares, public.note_updates, public.note_versions, public.notes, public.task_blocks, public.task_moves; reads public.board_shares
  - outside: npm yjs
- **taskBlock** `?` → `?` (write): writes public.task_blocks; reads public.boards, public.notes
- **taskClose** `?` → `?` (write): writes public.notes, public.task_moves; reads public.boards
- **taskEdit** `?` → `?` (write): writes public.notes, public.task_moves; reads public.board_shares, public.boards
- **taskExport** `?` → `?` (read): reads public.board_shares, public.boards, public.note_shares, public.notes, public.task_blocks
- **taskFromLine** `?` → `?` (write): writes public.boards, public.note_links, public.note_shares, public.note_updates, public.note_versions, public.notes, public.task_blocks, public.task_moves; reads public.board_shares
  - outside: npm yjs
- **taskImport** `?` → `?` (write): writes public.note_links, public.note_shares, public.note_updates, public.note_versions, public.notes, public.task_blocks, public.task_moves; reads public.board_shares, public.boards
  - outside: npm yjs
- **taskMove** `?` → `?` (write): writes public.notes, public.task_moves; reads public.boards
- **taskMoves** `?` → `?` (read): reads public.boards, public.notes, public.task_moves
- **toDraft** `Parameters<NotesApi["drafting"]>[0]` → `{ started: boolean; }` (serviceHandler)
- **toSop** `?` → `?` (write)
- **train** `?` → `?` (write): writes public.notes; reads public.boards
- **transfer** `?` → `?` (write): writes public.note_shares, public.notes; reads public.boards
- **upload** `?` → `?` (write)
- **version** `?` → `?` (read): reads public.note_versions, public.notes
- **versions** `?` → `?` (read): reads public.note_versions, public.notes
- **workspaceTrain** `?` → `?` (write): writes public.notes_settings
