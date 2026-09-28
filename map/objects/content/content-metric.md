---
type: object
cluster: content
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/content/src/schema.ts:104
---

# content-metric

One daily look at what a published draft did. Table `content_metrics`.

## Why this shape

One snapshot per post per day for its first 30 days (`metrics.ts:15`, `:17`), so "what worked" is a query over rows, and the lesson feeds the next draft's prompt (`lessons.ts:1`). Learning beyond that is still a person's job.

## Shape

- `draft_id` (cascade), `as_of`, `views`, `reactions`, `comments`, `shares`, `fetched_with` (`schema.ts:108`–`117`)

Citations: `packages/content/src/schema.ts:104`

## Connected to

- **owned-by:** [[content/draft]]
- **reads through:** the `Content.metrics` handler and each platform adapter

## If you change this

- **Hits:** `metrics.ts:50`, `:97`; `restate/metrics.ts`; `lessons.ts`; `wren content results`
- **Does not hit:** leftover `post_metrics`

## Surfaces

| Surface | Role |
|---|---|
| `ContentMetrics/default` | writes |
| `wren content results`, drafting prompt | read |

## See

- Source: `packages/content/src/metrics.ts`
