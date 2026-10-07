---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-06 @ d5f6aa3
entity: packages/core/src/library.ts:1
---

# library

The Library app's own records (designs/2026-10-06-library-and-views.md, step 3): Snippets the team inserts into any draft or reply box, Media (every rendered cut, Short and thumbnail), SOPs (the content loop's playbooks) and Workflows (each a link onto the Workflows canvas). Templates and Sequences are [[platform/template-store]]'s.

## Why this shape

Each tab is a record type on the list template, so filters, saved views, the side panel, History and Undo come free. Snippets are plain words with no slots, so Insert pastes them as they are. Favorites are a pref, not a column, so each viewer keeps his own without a table.

## Shape

- `snippets` (`packages/core/src/schema.ts:420`, migration 0130): workspace, title, body, tags (text[]), channel (null = anywhere), created_by, updated_at
- `snippetRecord(seen)` `library.snippet`: edits title, words, tags and fits in place; tags in use are facets (`snippetTags`, read on each types call, plain text when none or the read fails)
- `ConsolePortal{snippets,snippetAdd,snippetRemove}`: list is team `read`, add and remove need `wren:run`, never the demo (`teamWriter`, `packages/core/src/console.ts`)
- `workflowRecord(workflows, parts)` `library.workflow`: read only; its load gives the steps and `/workflows/canvas?path=<id>` (a part's inside opens as the part). Saved templates (`workflow_templates`, [[platform/spine]]) list after the code's, `from` saved, their link `/marketplace/catalog/<id>`
- `mediaRecord(signer)` `library.media` and `sopRecord` `library.sop` (`packages/content/src/library.ts`), registered in `apps/worker/src/services.ts` and the local preview; media's load signs the file
- Insert: `InsertSnippet` (`packages/ui/src/snippets.tsx`) in an edited prose field, the action ask box and the DraftBox; favorites first, filtered to the box's channel; goes at the cursor once he has placed it, else at the end as a new paragraph. The portal's `SnippetsProvider` source is team only, favorites at pref `favorites:library.snippet` at Wren (`snippetsFor`, `apps/portal/web/src/App.tsx`)

## Connected to

- **owns:** `snippets`
- **owned-by:** [[platform/records]]
- **joins:** [[platform/saved-views]] (favorites pref), [[platform/edits]] (snippet edits)
- **looks-like-but-is-not:** [[platform/template-store]] (templates have slots, versions and numbers; a snippet is fixed words)

## If you change this

- **Hits:** the Library's four tabs, every draft and reply box's Insert, `console.test.ts`'s record list
- **Does not hit:** sending (Insert only changes the box's text), templates

## Surfaces

| Surface | Role |
|---|---|
| portal Library: Snippets | write (add, edit, delete, favorite), read |
| portal Library: Media, SOPs, Workflows | read |
| any draft, reply or long-text edit | read (Insert) |

## See

- Source: `packages/core/src/library.ts`, `packages/content/src/library.ts`, `packages/ui/src/snippets.tsx`, `apps/portal/web/src/modules/library/`
- Tests: `packages/core/test/integration/library.test.ts`, `packages/ui/src/snippets.test.ts`
