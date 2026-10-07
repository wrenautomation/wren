---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-06 @ f25d7ac (Ask Claude rows: content-desk-ask)
entity: packages/content/src/schema.ts:76
---

# draft

One idea rendered for one platform, waiting for a person, then a slot, then the wire. Table `content_drafts`. Not an email `messages.state = draft`.

## Why this shape

The model proposes, the code disposes: a draft over the platform's length, missing a required title, or unparseable is never stored (`draft.ts:1`). An edit puts an approved draft back to `draft`, so what goes out is always something a person approved as written (`review.ts:1`). `claim` moves `approved → publishing` in the selecting statement, so nothing posts twice (`queue.ts:37`). `llm` keeps the call record for costs. On a `draft` row `scheduled_for` is the slot the planner gave it: inert until approved, kept by an edit and a redraft, and approve schedules into it while it is ahead and free (`review.ts:100`), else into the platform's next free slot from the planner's settings. Unapproved drafts with no slot in the day don't count toward tomorrow's plan. An Instagram row can be a Short's Reel (`promptVersion` `video`, idea `ref` `video:<id>/short:<n>`). A slot takes at most 2 redrafts a day; a superseded row keeps its slot so they count. The prompt (`v4`) claims no experience the idea doesn't give, and `askGuarded` (`draft.ts:129`) runs the facts guard (`@wren/core/grounded`) with the idea as his own words: made up twice, no row.

Per client: the same table in the client's own database. `ContentPlanner/<c>/daily` drafts through `ContentDesk/<c>/desk` as the client (its About, on its `models` gate, only its login platforms), into its To approve. `ContentScheduler/<c>/posts` holds due drafts (`held`) until `sendsOn(client, "content.posting")`; then posts through `Content.publish` with `client`, on its own login (`packages/content/src/clients.ts`).

## Shape

- `idea_id`, `platform`, `text`, `title`, `media`, `extra` (the platform's post shape, `SHAPES` in `packages/core/src/content/shapes.ts`: checked by `setFields` on save, by approve for required fields, by `postOf` before publish), `status` (`DRAFT_STATUSES`, `:28`), `edited`, `scheduled_for`, `approved_at`, `published_at`, `published_id`, `url`, `error`, `redraft_of`, `note`, `prompt_version`, `playbook_id` (the [[content/playbook]] the prompt carried), `llm` (`schema.ts:76`–`112`)

Citations: `packages/content/src/schema.ts:76`

## Connected to

- **owned-by:** [[content/idea]], [[content/platform]]
- **owns:** [[content/content-metric]]
- **recorded in:** [[content/draft-event]] (every step, who, the words)
- **joins:** [[content/media]] (a stored object as `s3://`), the `Content` service (publish)

## If you change this

- **Hits:** `draft.ts:164`, `review.ts:70`, `queue.ts`, `slots.ts`, `restate/scheduler.ts`, `restate/desk.ts`, `costs.ts`, `lessons.ts` (reads notes and winners), `playbook.ts`, `wren content *`
- **Does not hit:** the platform adapters (they take a `Post`, not a row: `packages/core/src/content/index.ts:122`)

## Surfaces

| Surface | Role |
|---|---|
| `ContentDesk.draft/redraft` | writes |
| `ContentDesk.approveVideo`, `wren video approve` ([[content/video-edit]]) | write an approved, private YouTube draft of a rendered video |
| `wren content approve/reject/edit`, `ContentDesk.approve/reject/edit` (the console) | writes; reject takes an optional `reason` and `note`, kept in [[content/draft-event]] |
| `marketing.draft` (`marketing_draft_records`, every status but published), `marketing.post` | read; their `load` adds the preview's text, cap and feed cut (`PLATFORM_SPECS.feed`). Marketing → Content → Today (a Day page, `apps/portal/web/src/modules/marketing/index.ts`) shows scheduled drafts by `scheduled`, posts by `published`, waiting drafts by `created` (carried onto today) with Approve; every Content page has the platform switch |
| the detail's draft box (`DraftAsk/set`, who = the signed-in person), `DraftAsk/ask` (Claude's rewrite), `DraftAsk/undo`, `wren drafts set draft:<id>` | write `text` through `editDraft`, one `runs` row each (`draft-ask`/`draft-set`/`draft-undo`, keeps the text replaced); `marketing.draft`'s `load` adds the thread (`draftTurns`, `packages/core/src/ask.ts`). The `draft-set` rows are his edits: `draftEdits`/`editsFor` feed the last 5 per kind to every drafting call and the Ask Claude prompt, `wren drafts edits` prints them. Kinds: `packages/content/src/draft-ask.ts` |
| `ContentDesk.fields` / `attach` (`marketing/draftFields`, `marketing/draftAttach`), `wren content fields <id> key=value` | write `extra` and the title through `setFields`; attach puts a thumbnail, cover or subtitles file (2 MB) in [[content/media]] first. The detail's `shape` (`shapeView`, `packages/content/src/shape-view.ts`) feeds the field editor (Basics, Media, Details) and the live platform preview on Drafts, To approve and Posts (`withShape` in `apps/portal/web/src/modules/marketing/fields.tsx`, previews in `shape-preview.tsx`); the record detail draws it as `RecordExtras.form` and `aside` (`packages/ui/src/records.tsx`, `Beside`: two columns on a wide page, Preview button on a phone) |
| `ContentScheduler/default`, `ContentScheduler/<c>/posts` | moves to published/failed; a client's waits on its live flag |
| `ContentPlanner` | reads slots; with `draft` on, gives each new draft its slot |
| `ContentMetrics` | reads |
| `wren status` (`packages/content/src/status.ts`) | reads counts, oldest draft, this month's tokens |

## See

- Source: `packages/content/src/draft.ts`
