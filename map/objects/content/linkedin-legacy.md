---
type: object
cluster: content
universe: leftover
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-linkedin/src/schema.ts:128
---

# linkedin-legacy

The first LinkedIn pipeline's tables: `posts`, `post_ideas`, `competitors`, `competitor_posts`, `research_runs`, `post_metrics`. Present in the schema, no writer in this tree.

## Why this shape

Ported from Python with the schema so legacy rows survive. The content loop (`packages/content`) took over drafting and publishing for every platform, including LinkedIn through `channel-linkedin/src/content.ts`. Only `status.ts` still reads `posts` and `research_runs` (`status.ts:58`, `:64`).

## Shape

- tables at `schema.ts:39`, `:53`, `:77`, `:96`, `:128`, `:156`
- no `insert(posts|postIdeas|competitors|competitorPosts|researchRuns|postMetrics)` under `packages/*/src` or `apps/*/src`

Citations: `packages/channel-linkedin/src/schema.ts:128`

## Connected to

- **joins:** [[content/linkedin-note]] (`used_by_post_id`), [[ledger/llm-call]] (`posts.llm_call_id`)
- **looks-like-but-is-not:** [[content/draft]] and [[content/content-metric]], which are live

## If you change this

- **Hits:** `wren status` (`status.ts`); a migration if dropped; the `notes` and `llm_calls` foreign keys
- **Does not hit:** anything that posts today

## Surfaces

| Surface | Role |
|---|---|
| `wren status` | reads |
| none | writes |

## See

- Source: `packages/channel-linkedin/src/status.ts`
