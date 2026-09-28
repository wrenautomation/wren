---
type: object
cluster: content
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/content/src/schema.ts:55
---

# draft

One idea rendered for one platform, waiting for a person, then a slot, then the wire. Table `content_drafts`. Not an email `messages.state = draft`.

## Why this shape

The model proposes, the code disposes: a draft over the platform's length, missing a required title, or unparseable is never stored (`draft.ts:1`). An edit puts an approved draft back to `draft`, so what goes out is always something a person approved as written (`review.ts:1`). `claim` moves `approved → publishing` in the selecting statement, so nothing posts twice (`queue.ts:37`). `llm` keeps the call record for costs.

## Shape

- `idea_id`, `platform`, `text`, `title`, `media`, `extra` (e.g. reddit `subreddit`), `status` (`DRAFT_STATUSES`, `:28`), `edited`, `scheduled_for`, `approved_at`, `published_at`, `published_id`, `url`, `error`, `redraft_of`, `note`, `prompt_version`, `llm` (`schema.ts:59`–`88`)

Citations: `packages/content/src/schema.ts:55`

## Connected to

- **owned-by:** [[content/idea]], [[content/platform]]
- **owns:** [[content/content-metric]]
- **joins:** [[content/media]] (a stored object as `s3://`), the `Content` service (publish)

## If you change this

- **Hits:** `draft.ts:164`, `review.ts:70`, `queue.ts`, `slots.ts`, `restate/scheduler.ts`, `restate/desk.ts`, `costs.ts`, `lessons.ts` (reads notes and winners), `wren content *`
- **Does not hit:** the platform adapters (they take a `Post`, not a row: `packages/core/src/content/index.ts:122`)

## Surfaces

| Surface | Role |
|---|---|
| `ContentDesk.draft/redraft` | writes |
| `wren content approve/reject/edit` | writes |
| `ContentScheduler/default` | moves to published/failed |
| `ContentPlanner`, `ContentMetrics` | read |

## See

- Source: `packages/content/src/draft.ts`
