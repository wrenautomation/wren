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

The model proposes, the code disposes: a draft over the platform's length, missing a required title, or unparseable is never stored (`draft.ts:1`). An edit puts an approved draft back to `draft`, so what goes out is always something a person approved as written (`review.ts:1`). `claim` moves `approved → publishing` in the selecting statement, so nothing posts twice (`queue.ts:37`). `llm` keeps the call record for costs. On a `draft` row `scheduled_for` is the slot the planner gave it: inert until approved, kept by an edit and a redraft, and approve schedules into it while it is ahead and free (`review.ts:100`). A slot takes at most 2 redrafts a day (`draft.ts:139`); a superseded row keeps its slot so they count.

## Shape

- `idea_id`, `platform`, `text`, `title`, `media`, `extra` (e.g. reddit `subreddit`), `status` (`DRAFT_STATUSES`, `:28`), `edited`, `scheduled_for`, `approved_at`, `published_at`, `published_id`, `url`, `error`, `redraft_of`, `note`, `prompt_version`, `playbook_id` (the [[content/playbook]] the prompt carried), `llm` (`schema.ts:76`–`112`)

Citations: `packages/content/src/schema.ts:76`

## Connected to

- **owned-by:** [[content/idea]], [[content/platform]]
- **owns:** [[content/content-metric]]
- **joins:** [[content/media]] (a stored object as `s3://`), the `Content` service (publish)

## If you change this

- **Hits:** `draft.ts:164`, `review.ts:70`, `queue.ts`, `slots.ts`, `restate/scheduler.ts`, `restate/desk.ts`, `costs.ts`, `lessons.ts` (reads notes and winners), `playbook.ts`, `wren content *`
- **Does not hit:** the platform adapters (they take a `Post`, not a row: `packages/core/src/content/index.ts:122`)

## Surfaces

| Surface | Role |
|---|---|
| `ContentDesk.draft/redraft` | writes |
| `wren content approve/reject/edit`, `ContentDesk.approve/reject/edit` (the console) | writes |
| `marketing.draft` (`marketing_draft_records`, every status but published), `marketing.post` | read; their `load` adds the preview's text, cap and feed cut (`PLATFORM_SPECS.feed`) |
| `DraftAsk/ask` (Claude's rewrite), `DraftAsk/undo`, `wren drafts set draft:<id>` | write `text` through `editDraft`, one `runs` row each (`draft-ask`/`draft-set`/`draft-undo`, keeps the text replaced); `marketing.draft`'s `load` adds the thread (`draftTurns`, `packages/core/src/ask.ts`). Kinds: `packages/content/src/draft-ask.ts` |
| `ContentScheduler/default` | moves to published/failed |
| `ContentPlanner` | reads slots; with `draft` on, gives each new draft its slot |
| `ContentMetrics` | reads |
| `wren status` (`packages/content/src/status.ts`) | reads counts, oldest draft, this month's tokens |

## See

- Source: `packages/content/src/draft.ts`
