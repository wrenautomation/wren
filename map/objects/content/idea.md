---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-06 @ f25d7ac
entity: packages/content/src/schema.ts:43
---

# idea

One thing to say, with optional media. Table `content_ideas`. The loop's only input: William's words, or one the planner made.

## Why this shape

Nothing is ever drafted from nothing: blank text is refused (`ideas.ts:7`). `source` records who added it (cli | api | ads | build_log | question, `schema.ts:30`), so an idea AdsWatch minted from a winning ad is visible as such (`packages/channel-meta/src/bridge.ts:1`). The planner makes two kinds itself (O5): a day's commits in the public repos (`ideas/build-log.ts`) and a reader's `question` comment (`ideas/questions.ts`). `ref` (`build_log:<day>`, `comment:<id>`, unique) makes each once (`ideas.ts:21`).

## Shape

- `text`, `media`, `source`, `status` (open | drafted | archived), `ref` (`schema.ts:43`–`53`)

Citations: `packages/content/src/schema.ts:43`, `packages/content/src/ideas.ts:7`, `packages/content/src/plan.ts:128`

## Connected to

- **owns:** [[content/draft]] (`idea_id`, cascade)
- **reads:** [[content/comment]] (`sort = question`, by SQL: content does not depend on outreach)
- **looks-like-but-is-not:** `content_drafts.note` (a redraft instruction on a draft)

## If you change this

- **Hits:** `ideas.ts`, `ideas/`, `draft.ts`, `ContentDesk.add/draft`, `wren content add`, `nextIdea` and the planner's "ideas to draft" count (`plan.ts`)
- **Does not hit:** published drafts

## Surfaces

| Surface | Role |
|---|---|
| `wren content add` | writes |
| `AdsWatch` (source ads) | writes |
| `ContentPlanner` with `draft` on (build_log, question) | writes, then drafts through `ContentDesk` |
| `ContentDesk.draft` | reads, sets drafted |

## See

- Source: `packages/content/src/ideas.ts`, `packages/content/src/ideas/`
