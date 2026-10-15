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

Snapshots for a post's first 30 days (`metrics.ts:16`), so "what worked" is a query over rows, and the lesson feeds the next draft's prompt (`lessons.ts:1`). Learning beyond that is still a person's job. A daily look showed a new post a day behind the platform (temp note, 2026-10-11); hourly then proved more reads than the numbers earn (rate limits, 2026-10-14). So on free API reads (`FAST_LOOKS`, `metrics.ts:39`) a post is looked at every 6 h for 2 days, daily to a week, then weekly to day 30 (`LOOK_TIERS`, `:27`): about 15 looks, from 67. X bills each read and LinkedIn and Reddit read through a browser: daily for a week, then weekly (`SLOW_LOOK_TIERS`, `:32`; about 11 looks, from 35). The loop still runs hourly (`restate/metrics.ts:53`) to find what is due; a platform's report read (YouTube's reach report) waits 6 h after one that found nothing new. A look is one read of the post where it can be: the counts read's answer rides to `insights` as `Metrics.read` (YouTube's length, X's and Reddit's own numbers; an X video asks again for its media fields).

## Shape

- `draft_id` (cascade), `as_of`, `views`, `reactions`, `comments`, `shares`, `follows` (null: no `metrics` read fills it now; a post's follows are its `follows` insights day rows, which `draft_outcomes` reads), `fetched_with` (`schema.ts:131`–`171`)

Citations: `packages/content/src/schema.ts:127`

## Connected to

- **owned-by:** [[content/draft]]
- **reads through:** the `Content.metrics` handler and each platform adapter
- **looks-like-but-is-not:** [[content/post-metric-day]], every other number the platform answers, per day

## If you change this

- **Hits:** `metricsDue` (`metrics.ts:46`), `recordMetrics` (`:97`); `restate/metrics.ts`; `lessons.ts`; `wren content results`

## Surfaces

| Surface | Role |
|---|---|
| `ContentMetrics/default` | writes |
| `wren content results`, drafting prompt | read |

## See

- Source: `packages/content/src/metrics.ts`
