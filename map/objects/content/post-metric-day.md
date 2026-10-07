---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-07 @ d4d285c5
entity: packages/content/src/schema.ts:276
---

# post-metric-day

A post's platform insights for one day, one row per metric and key. Table `post_metric_days`, with its siblings `account_metric_days`, `metric_sources` and `content_digests`. The product word is "a post's numbers".

## Why this shape

Every number a platform answers is kept per day and never overwritten across days (a second look the same day replaces that day only: `store.ts:51`). A metric the token can't read is not a missing row but a `metric_sources` state with the platform's words (`store.ts:22`); the step that fixes it comes from the catalog (`analytics/catalog.ts`), which is the truth the doc's Counts table is tested against.

## Shape

- `post_metric_days`: `draft_id`, `day`, `metric`, `key` ("" for a plain number; the fraction of the video for `retention`, the source for `traffic_source`, the words for `search_term`), `value`, `fetched_at` (`schema.ts:276`)
- `account_metric_days`: the same per `platform` and day (`schema.ts:297`)
- `metric_sources`: per platform and metric, `state` (live, needs_scope, needs_william, not_built, no_api, error), `why`, `checked_at`, `live_at`; an account's metrics are prefixed `account.` (`schema.ts:324`)
- `content_digests`: Monday's "what worked" lines per platform, first kept (`schema.ts:346`)

Citations: `packages/content/src/schema.ts:276`, `packages/content/src/analytics/store.ts:51`, `packages/content/src/analytics/digest.ts:262`

## Connected to

- **owned-by:** [[content/draft]]
- **joins:** `link_days` (channel-search, `schema.ts:272`) by `content` = the draft id's first 8, or a long video's footer campaign
- **looks-like-but-is-not:** [[content/content-metric]], the four counts per look; this one holds everything else the platform answers

## If you change this

- **Hits:** `restate/metrics.ts:141` (the look writes insights after counts); `analytics/records.ts` (`postAnalytics`, the conversation, digest, cadence and metric records and their views in `0187_content_analytics`); the portal's `marketing/analytics.tsx`; the drafting prompt via `latestDigest` (`digest.ts:276`)
- **Does not hit:** `content_metrics` or `wren content results`

## Surfaces

| Surface | Role |
|---|---|
| `ContentMetrics/default` | writes, through `Content.insights` and `Content.accountInsights` |
| Marketing → Posts and a post's page, Overview tops, Inbox overview | read |
| drafting prompt | reads the latest digest |

## See

- Source: `packages/content/src/analytics/`
- Design: `designs/2026-10-07-content-analytics.md`
