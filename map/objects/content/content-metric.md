---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-11 @ ec72a24a (+ look tiers)
entity: packages/content/src/schema.ts:127
---

# content-metric

One look at what a published draft did. Table `content_metrics`.

## Why this shape

Snapshots for a post's first 30 days (`metrics.ts:16`), so "what worked" is a query over rows, and the lesson feeds the next draft's prompt (`lessons.ts:1`). Learning beyond that is still a person's job. A daily look showed a new post a day behind the platform (temp note, 2026-10-11), so on free API reads (`FAST_LOOKS`, `metrics.ts:31`) a post is looked at hourly for 2 days, every 6 h to a week, then daily (`LOOK_TIERS`, `:23`). X bills each read and LinkedIn and Reddit read through a browser: daily. The loop runs hourly (`restate/metrics.ts:49`).

## Shape

- `draft_id` (cascade), `as_of`, `views`, `reactions`, `comments`, `shares`, `follows` (null: no `metrics` read fills it now; a post's follows are its `follows` insights day rows, which `draft_outcomes` reads), `fetched_with` (`schema.ts:131`–`171`)

Citations: `packages/content/src/schema.ts:127`

## Connected to

- **owned-by:** [[content/draft]]
- **reads through:** the `Content.metrics` handler and each platform adapter
- **looks-like-but-is-not:** [[content/post-metric-day]], every other number the platform answers, per day

## If you change this

- **Hits:** `metricsDue` (`metrics.ts:38`), `recordMetrics` (`:84`); `restate/metrics.ts`; `lessons.ts`; `wren content results`

## Surfaces

| Surface | Role |
|---|---|
| `ContentMetrics/default` | writes |
| `wren content results`, drafting prompt | read |

## See

- Source: `packages/content/src/metrics.ts`
