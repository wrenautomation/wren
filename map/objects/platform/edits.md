---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-06 @ 5714dc3
entity: packages/core/src/edits.ts:120
---

# edits

A record's `edits` declaration and the `changes` table under it: inline edit, History, Undo and Ask Claude for any record type that declares them (designs/2026-10-06-edits-claude-templates.md, steps 1 and 2).

## Why this shape

One edit path, so no page builds its own save, history or undo. Every write is compare-and-swap on a hash of the editable values (`versionOf`), so two editors can't overwrite each other. Claude's patch is not a second path: Accept sends it through `editRecord` with its run id, so History and Undo cover it.

## Shape

- `RecordEdits {fields, patch (zod, partial and strict), check?(patch, now, db, id), read, write, context?, about?, needs?}` (`needs`: `run` by default, `manage` for settings; checked at Wren and sent to the UI as `editNeeds`) on `defineRecord` or `withEdits` (`packages/core/src/records.ts:304`, `:523`); `checkEdits` (`:509`) refuses unknown fields, a kind outside `EDITABLE`, or a patch that won't take `{}`
- `editRecord` (`packages/core/src/edits.ts:120`): schema, read (404), version (409), check (400), write, re-read, one `changes` row; an unchanged patch is a no-op with `change: null`. `undoChange` (`:159`) writes the before back once (`uq_changes_undoes`) and only while what it set still stands
- `changes` (`packages/core/src/schema.ts:336`, migration 0129): record, record_id, before, after, version, by, via `person|claude`, run_id, undoes
- Ask Claude: `ConsolePortal.recordsAsk` opens a runs row (command `record-ask`, argv holds the prompt from `askPrompt`, `:355`), then `Ask.edit` (`packages/core/src/ask.ts:114`) asks the desk's `claude` and finishes the run with `{reply, patch}`; `askTurns` (`:277`) reads them back with each patch checked as a diff (`proposalOf`, `:242`)
- served by `ConsolePortal{recordsEdit,recordsUndo,recordsAsk}` (`packages/core/src/console.ts:1320`), need `wren:run`; `recordsGet` adds `edit: {values, version, history, asks}` (`editState`, `:412`)
- drawn by `EditFields`, `History`, `AskClaude` (`packages/ui/src/edits.tsx:207`, `:386`, `:447`) inside `RecordBody`; ⌘K reads the open record through `useOpenRecord` (`packages/ui/src/records.tsx:1588`)
- declared on: `console.setting` (Wren's settings, `needs: "manage"`, [[platform/settings]]), `marketing.text_copy` and `marketing.dm_copy` (`apps/worker/src/record-edits.ts`, `copyRecords`); a keyword reply refuses here and keeps the Edit action, since it also sets the provider's answer

## Connected to

- **owns:** `changes`
- **owned-by:** [[platform/records]]
- **joins:** [[ledger/run]] (Claude's asks), [[email/template]] (the copy writes publish through the template store)
- **looks-like-but-is-not:** `audit_changes` / `console.change` ([[platform/audit-log]]): row-level trigger audit of every table, not per-record edits; `DraftAsk` (drafts' own Save/Ask/Undo, not yet moved)

## If you change this

- **Hits:** every record that declares `edits`, the panel's Details and History tabs, the Ask desk, the local preview (`apps/portal/scripts/preview.ts` maps `recordsAsk` to `recordsAskOpen`)
- **Does not hit:** list, export or stats; records without `edits`

## Surfaces

| Surface | Role |
|---|---|
| portal record panel | writes (edit, undo, accept), reads history and asks |
| ⌘K | asks Claude about the open record |

## See

- Source: `packages/core/src/edits.ts`, `packages/ui/src/edits.tsx`
- Tests: `packages/core/test/integration/edits.test.ts`, `packages/ui/src/edits.test.ts`
