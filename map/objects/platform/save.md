---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-14 @ 9c940774
entity: packages/ui/src/save/engine.ts:159
---

# save

The portal's one save engine: everything a person types into (a draft box, a record field, a dialog) saves through `useSaved`, shows one `SaveStatus`, and keeps unsaved typing on the device (designs/2026-10-14-saving-and-ui-audit.md).

## Why this shape

Each box once had its own save, and two raced: a save's answer written back over new typing, and a read that left before a save landing after it. One engine owns the rules, so a box only draws `value` and calls `set`. The core is plain TypeScript (fake timers, storage and locks in tests); the React part is a thin hook.

## Shape

- `Saver<T>` (`packages/ui/src/save/engine.ts:159`): value, base, version, status `clean|edited|saving|saved|waiting|conflict|failed`. A save's answer never touches `value`; a read that left before the newest save answered, or lands while one is out, is ignored (fences per key, this tab). Saves coalesce to one in flight plus the newest, one at a time per key across tabs (`withLock`, `packages/ui/src/save/lock.ts:10`, Web Locks with an in-tab fallback). Autosave after 1.2 s, on hide, pagehide, close and `flush`. Offline, 408, 429, 5xx, TypeError and a 20 s timeout retry with backoff and on `online`, one request id per value and base. A 409 that says it changed (or `code: "conflict"`) is a conflict: Keep mine / Use theirs
- journal (`packages/ui/src/save/journal.ts:46`): `wren.unsaved:<key>` written on each `set`, a week; a reload over the same base saves it, over a moved base opens a conflict; a tab never clears another tab's unsaved entry. Dialog typing under `wren.form:<key>` (`useKeptForm`, `packages/ui/src/save/react.tsx:171`)
- write-through (`packages/ui/src/save/cache.ts:47`): a landed save patches every cached answer in a scope, what's mounted, and reads still out (`patchedSince`, `:59`). `useLoad` (`packages/ui/src/records.tsx:287`) keeps its answers there and returns `at`, the tick its read left; `patchRecord` (`packages/ui/src/record-patch.ts:59`) patches a record's row in its detail and lists; the portal's `useCall` and `patchCalls` (`apps/portal/web/src/load.ts:65`, `:22`)
- one action per press: `Once`/`ACTIONS` (`packages/ui/src/save/once.ts:9`), `callOnce` (`packages/ui/src/action.tsx:481`) adds `requestId`; `useRun` (`:497`) sends every action through it
- React: `useSaved`, `SaveStatus`, `SaveConflict` (`packages/ui/src/save/react.tsx:27`, `:77`, `:114`)
- on it: `DraftBox` (`packages/ui/src/draft.tsx:179`, and the custom editors through its `editor` prop), `EditField` (`packages/ui/src/edits.tsx:105`, flush only, the record version from a live ref in `RecordBody`), `useRun` dialogs. A save never re-reads: `DraftBox` patches its row (`wrote`), `RecordBody`'s edit patches the row, version and a History line; a re-read only on a conflict, an ask or an undo. The live words a preview reads (`useDraftText`) are a store (`liveText`, `packages/ui/src/draft-save.ts`), so typing draws the box and its preview, not the page

## Connected to

- **owned-by:** [[platform/records]]
- **joins:** [[platform/edits]] (version expect, 409 as conflict)
- **looks-like-but-is-not:** Notes' Yjs sync ([[platform/notes]]), which keeps its own; [[platform/saved-views]] (`useSavedViews`, a list's saved tabs)

## If you change this

- **Hits:** every draft box, record field edit and action dialog in the portal; the record panel's re-reads (saves no longer re-read or wash)
- **Does not hit:** the server; a handler that ignores `requestId` still runs each try (idempotency per id is the server's)

## Surfaces

| Surface | Role |
|---|---|
| portal draft boxes, record fields, action dialogs | write |

## See

- Source: `packages/ui/src/save/`, its header `packages/ui/src/save/index.ts`
- Tests: `packages/ui/src/save/engine.test.ts` (William's 10-14 repro by name), `packages/ui/src/save/once.test.ts`, `packages/ui/src/record-patch.test.ts`, `packages/ui/src/draft-save.test.ts` (calls per 40-key burst)
