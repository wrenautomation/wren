# Save paths outside Marketing (2026-10-14)

Lane C of `2026-10-14-saving-and-ui-audit.md`. Every portal edit surface outside Marketing and
Notes, how it saves, what was wrong, and what fixed it. Notes keep their Yjs sync.

## The contract

- **Request id.** An action's body carries `requestId` (8 to 100 of `A-Za-z0-9_-`). The Worker
  strips it and sends `idempotency-key: portal:<sha256(email, client, host, requestId)>` to the
  ingress, so Restate runs the handler once per id and answers a retry with the first result.
  The engine's `ACTIONS.run` / `callOnce` keep one id per press until an answer comes back. A
  records action on several ids sends `<id>-<n>` per record.
- **Version.** An editor sends `expect`: the version it opened on (an ISO `updatedAt`, or the
  prior text for notes). The handler writes in one `UPDATE ... WHERE id AND version RETURNING`;
  no row means it moved. A save answers its new `version`.
- **Refusals.** Plain words, an optional `field`, never an id. A stale save is
  `staleRefusal(what)`: 409, "This <what> changed since you opened it. Look again.", with
  `code: "conflict"` in the ingress metadata. `ApiError.code` carries it; the engine reads it.
  A bad `expect` is 400 on field `expect`.

## Paths

Trigger: when it calls the server. Before: what went wrong. Now: the fix. Owner A = lane A's
`packages/ui`, C = here.

| Surface | Trigger | Before | Now |
|---|---|---|---|
| Workflow editor (`wren/workflows.tsx`, `editor.tsx`) | Save, Publish, Discard | stale closure base; setState after await; typing lost on reload; double publish | `useSaved` journal, `expect` base checked under a lock (`checkWorkflowBase`), publish/discard via `ACTIONS.run` |
| Automations, doors, made, tester, ask (`wren/`) | buttons | double submit, state-only guards | ref guards, request ids |
| Documents draft and new (`documents.tsx`) | Save, Save and send | no version; new doc made twice on retry; typing lost on reload | one `useSaved` over all fields, `expect`; a new one made once (`ACTIONS.run`, id kept) |
| Document templates | Save | no version | `useSaved`, `expect`; single UPDATE |
| Site copy (`sites/detail.tsx`) | Save | double submit | `useSaved` journal, `expect` + `requestId` |
| Site notes | Save (click only) | lost on reload; no version | `useSaved`, autosave 1.2 s, `expect` = prior text |
| Site forms and form tests (`sites/forms.tsx`) | Save | no version; lost on reload | `useSaved`, flush on Save, `expect` |
| Page split weights, ship (`sites/split.tsx`) | Save, Ship | no version; double ship | `expect`; claim the split first (serializable), a second ship refused |
| Deals board (`deals/board.tsx`) | drag | a refetch reverted a move; rollback undid a later move | moves queued per deal, request ids, overlay held until a read agrees |
| Pipelines (`deals/pipelines.tsx`) | Save | no version; double submit | `expect`, ref guard, request id |
| Library templates (`library/templates.tsx`) | Save | typing lost on reload; double submit | `useKeptForm` journal, ref guard, request id |
| Broadcasts (`people/broadcasts.tsx`) | Save, Ask | state-only guard; no version; new one twice | ref guard, `expect` (detail `version`), request id |
| Segments (`people/segments.tsx`) | Save | same | same |
| Import (`people/import.tsx`) | Import | a column change mid-import hid the result; double import | ref guard, request id, result always shown |
| Collections (`learn/menus.tsx`) | New collection | made twice | ref guard, request id |
| Learn SaveBox, Follow, texts ask, Stripe | buttons | clobbered newer typing; double submit | ref guards, clear only if unchanged |
| Work comments, forms (`work/bits.tsx`) | Post, Save | duplicate comment; `form.reset` wiped newer typing | ref guard, request id; `resetSent` resets only unchanged fields |
| Account webhooks, fields, AI tools, accounts, vendors | buttons | state-only guards; resets wiped typing; archive sent the old label | ref guards, request ids, `resetSent`; archive sends no label |
| Booking (`book.tsx`) | Book | double press; a retry after a lost answer said "taken" | ref guard; the server answers the booker's own booking (`heldBy`) |
| Client review (delivery) | star | a new star wiped the words and consent | only sent fields change |
| Deliverable decision | Approve, Ask for changes | a stale page flipped someone else's decision | only from waiting or the same answer, else 409 |
| Survey (`survey.tsx`) | tap | first tap wins silently | left as is: one answer per person by design |
| Record fields (`EditField`), DraftBox, `useRun` | A | see lane A | A |

## Speed

- Typing never calls the server per keystroke on these surfaces. A 40-character burst is 1 save
  with the 1.2 s debounce (gaps of 80, 250 and 600 ms alike), 0 with flush-only editors until
  Save, then 1. Before, most of these saved on click only, and lost the typing on a reload.
- Two search boxes read per keystroke: Automations and a workflow's runs. They read once the
  words hold still for 250 ms now (`useSettled` in `load.ts`), as list search and ⌘K do.
- Handler time on the test Postgres, median of 35 saves: document update 2.7 ms reading first,
  1.8 ms as one UPDATE (all fields sent, as the editor does); template save 1.4 ms; site notes
  1.7 ms; form save 2.1 ms.
- Hot list reads all hit an index (EXPLAIN with seq scans off): docs by client and created, deals
  by pipeline and stage and by client and status, site pages and forms by client, the broadcast
  and segment views, calls by person. No new index needed.

## Left

- Broadcast Approve can't yet carry the version the approver saw: a records action sends no
  `expect`. Lane A: actions on a record send its version.
- Reactivation "called" inserts a call per press; the request id now covers a retry, a second
  deliberate press is a second call by design.
- `answerAsk` and `answerAccess` replace the answer by design (the audit log keeps both).
- Marketing draft refusals (lane B) should use `staleRefusal` so they carry `code: "conflict"`.

## Log

- 2026-10-14: written with the fixes (branch `lane-c-saves`).
