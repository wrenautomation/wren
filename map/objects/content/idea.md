---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-06 @ f25d7ac + 2026-11-02 WA-999 (campaign)
entity: packages/starling/inbound/src/schema.ts:43
---

# idea

One thing to say, with optional media. Table `content_ideas`. The loop's only input: William's words, or one the planner made.

## Why this shape

Nothing is ever drafted from nothing: blank text is refused (`ideas.ts:7`). `source` records who added it (cli | api | ads | build_log | question, `schema.ts:30`), so an idea AdSpendGuard minted from a winning ad is visible as such (`packages/starling/channels/meta/src/bridge.ts:1`). The planner makes two kinds itself (O5): a reader's `question` comment (`ideas/questions.ts`), and last a chapter of a video that is up on YouTube, built from the words he said in it (`ideas/chapters.ts`, source `promo`, Wren only). The build log (a day's commits as a post, source `build_log`) was retired 2026-10-14: technical updates gave readers little; old rows keep the source. `ref` (`comment:<id>`, `chapter:<edit>:<n>`, unique) makes each once (`ideas.ts:21`). A post written about a video (Write's `?from=video:<id>`, Studio's "Write a post about it") gets ref `video:<id>/post:<8 hex>` (`refFrom`, `own.ts`; `addIdea`'s `ref`; `ContentDesk.write` `from`), so Pieces nests it under the video (designs/2026-10-14-content-types.md).

## Shape

- `text`, `media`, `source`, `status` (open | drafted | archived), `ref` (`schema.ts:43`–`53`)
- `line`, `angle`: his Studio mark (`IdeaMark`, `ideas.ts`)
- `campaign`: the metro campaign it is written for ([[platform/campaign]]), null = the default. Its drafts inherit it through `idea_id`, so a redraft keeps it. Only that campaign's planner sweep drafts it (`nextIdea`); the default never does. Set by `--campaign` on `wren content add` and `wren write` (checked against the newest shape), or the desk's `add`/`write` input (taken as given). Migration 0356

Citations: `packages/starling/inbound/src/schema.ts:43`, `packages/starling/inbound/src/ideas.ts:7`, `packages/starling/inbound/src/plan.ts:128`

## Connected to

- **owns:** [[content/draft]] (`idea_id`, cascade)
- **reads:** [[content/comment]] (`sort = question`, by SQL: content does not depend on outreach), [[content/piece]] (`video_edits` chapters and words of a published video, `ideas/chapters.ts`)
- **looks-like-but-is-not:** `content_drafts.note` (a redraft instruction on a draft)
- **joins:** [[content/funnel]] (a promo's idea, ref `promo:<draft>`)

## If you change this

- **Hits:** `ideas.ts`, `ideas/`, `draft.ts`, `ContentDesk.add/draft`, `wren content add`, `nextIdea`, `campaignSlots` and the planner's "ideas to draft" count (`plan.ts`)
- **Does not hit:** published drafts

## Surfaces

| Surface | Role |
|---|---|
| `wren content add` | writes |
| `AdSpendGuard` (source ads) | writes |
| `PostPlan` with `draft` on (question, chapter) | writes, then drafts through `ContentDesk` |
| `ContentDesk.draft` | reads, sets drafted |

## See

- Source: `packages/starling/inbound/src/ideas.ts`, `packages/starling/inbound/src/ideas/`
