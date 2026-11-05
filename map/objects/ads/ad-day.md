---
type: object
cluster: ads
universe: live
status: verified
verified: 2026-10-05 @ fa06f2a
entity: packages/starling/channels/meta/src/schema.ts:59
---

> Cut 2026-11-04 (stripdown): the code this card cites is gone; the tables stay. Git tag `pre-cut-2026-11-04`.

# ad-day

One ad set's numbers for one day, as Meta's insights gave them. Table `ad_days`; the Marketing app reads it as `marketing.ad_day`.

## Why this shape

Meta's insights are read every pass and were thrown away. A row per ad set and day, upserted, keeps them: a re-read or a revised day overwrites, never adds (`packages/starling/channels/meta/src/days.ts:23`). Written only by the step `AdSpendGuard` already runs, so no new loop (`packages/starling/channels/meta/src/watch.ts:84`). Days exist only while a launch is active.

## Shape

- key (`adset_id`, `day`); `campaign_id`, names, `currency`, `spend`, `impressions`, `reach`, `clicks`, `leads` (`leadsOf`), `results` (`packages/starling/channels/meta/src/schema.ts:59`)
- view `marketing_ad_day_records`: cost per lead, the launch's state for pause and resume, age (`packages/starling/channels/meta/src/schema.ts:93`)

Citations: `packages/starling/channels/meta/src/days.ts:23`, `packages/starling/channels/meta/src/records.ts:1`

## Connected to

- **owned-by:** [[ads/ad-launch]] (state joins on `campaign_id`)
- **joins:** [[platform/records]] (`marketing.ad_day`)

## If you change this

- **Hits:** `watch.ts` (the step), the view (migration), `records.ts`, the Marketing app's Ads page and spend tile
- **Does not hit:** `AdSpendGuard`'s verdicts, which read the insights, not this table

## Surfaces

| Surface | Role |
|---|---|
| `AdSpendGuard/default` | writes |
| Marketing app (`/marketing/ads`) | reads |

## See

- Source: `packages/starling/channels/meta/src/days.ts`
