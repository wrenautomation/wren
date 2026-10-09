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

Every number a platform answers is kept per day and never overwritten across days (a second look the same day replaces that day only: `store.ts:59`). A platform's report rows (YouTube's reach report) land on the report's own day: `impressions_day`/`ctr_day` per day, `impressions`/`ctr` rebuilt to date from them; a later report for a day replaces it (`store.ts:142`). A metric the token can't read is not a missing row but a `metric_sources` state with the platform's words (`store.ts:22`); the step that fixes it comes from the catalog (`analytics/catalog.ts`), which is the truth the doc's Counts table is tested against. A catalog row built but not yet read is `waiting` and turns Live on its first number: a followers day writes `account.followers` live (`social/store.ts` `keepDay`), and a DM we sent on a platform makes its comment-to-DM row live (`readSources` in `analytics/records.ts`).

## Shape

- `post_metric_days`: `draft_id`, `day`, `metric`, `key` ("" for a plain number; the fraction of the video for `retention`, the source for `traffic_source`, the words for `search_term`), `value`, `fetched_at` (`schema.ts:276`)
- `account_metric_days`: the same per `platform` and day (`schema.ts:297`)
- `metric_sources`: per platform and metric, `state` (live, needs_scope, needs_william, not_built, no_api, error, waiting), `why`, `checked_at`, `live_at`; an account's metrics are prefixed `account.` (`schema.ts:324`)
- `post_variants`: a post's titles, thumbnails and hooks over time (`field`, `value`, `state` proposed/live/ended/rejected, `source` publish/swap, `started_at`, `ended_at`; one live per field), migration `0203`. Kept at publish (`queue.ts` `markPublished` → `keepFirstVariants`); a swap (`wren content swap`, a post's "Try a new title") waits in To approve as `swap:<id>` and on his yes `ContentDesk.swapApprove` calls `Content.update` (YouTube only: `videos.update`, `thumbnails.set`). `variantWindows` reads each one's views a day, impressions and CTR from the days here; the swap's own day counts for neither (`analytics/variants.ts`)
- LinkedIn's dashboard (autobrowse `GET /analytics/dashboard` as `linkedin@wren`) lands `profile_visits` and `search_appearances` on `account_metric_days` on the day read; they are LinkedIn's window totals (90 days, last week), shown as Followers columns
- `content_digests`: Monday's "what worked" lines per platform, first kept (`schema.ts:346`)

Citations: `packages/content/src/schema.ts:276`, `packages/content/src/analytics/store.ts:59`, `packages/content/src/analytics/digest.ts:262`

## Connected to

- **owned-by:** [[content/draft]] (also `post_variants`)
- **joins:** [[content/draft-event]] (`draft_activity` shows a started swap; `draft_outcomes` takes YouTube follows from these days when the snapshot has none)
- **joins:** `link_days` (channel-search, `schema.ts:272`) by `content` = the draft id's first 8, or a long video's footer campaign (`marketing_link_day_records` names the post for both since `0195`)
- **looks-like-but-is-not:** [[content/content-metric]], the four counts per look; this one holds everything else the platform answers

## If you change this

- **Hits:** `restate/metrics.ts:152` (the look writes insights after counts, passing the draft's media kind: X reads a video's plays and playback quartiles only on a video post; LinkedIn reads the post's analytics page as `linkedin@wren` on days 1, 3, 7, 14, 28), `restate/metrics.ts:184` (report days every pass, cursor per platform); `analytics/records.ts` (`postAnalytics`, the conversation, digest, cadence and metric records and their views in `0188_content_analytics`); the portal's `marketing/analytics.tsx`; the drafting prompt via `latestDigest` (`digest.ts:276`)
- **Does not hit:** `content_metrics` or `wren content results`

## Surfaces

| Surface | Role |
|---|---|
| `ContentMetrics/default` | writes, through `Content.insights`, `Content.accountInsights` and `Content.reportDays` |
| Marketing → Posts and a post's page, Overview tops, Inbox overview | read |
| drafting prompt | reads the latest digest |

## See

- Source: `packages/content/src/analytics/`
- Design: `designs/2026-10-07-content-analytics.md`
