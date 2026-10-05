---
type: object
cluster: ads
universe: live
status: verified
verified: 2026-10-05 @ fa06f2a
entity: packages/channel-meta/src/schema.ts:59
---

# ad-day

One ad set's numbers for one day, as Meta's insights gave them. Table `ad_days`; the Marketing app reads it as `marketing.ad_day`.

## Why this shape

Meta's insights are read every pass and were thrown away. A row per ad set and day, upserted, keeps them: a re-read or a revised day overwrites, never adds (`packages/channel-meta/src/days.ts:23`). Written only by the step `AdsWatch` already runs, so no new loop (`packages/channel-meta/src/watch.ts:84`). Days exist only while a launch is active.

## Shape

- key (`adset_id`, `day`); `campaign_id`, names, `currency`, `spend`, `impressions`, `reach`, `clicks`, `leads` (`leadsOf`), `results` (`packages/channel-meta/src/schema.ts:59`)
- view `marketing_ad_day_records`: cost per lead, the launch's state for pause and resume, age (`packages/channel-meta/src/schema.ts:93`)

Citations: `packages/channel-meta/src/days.ts:23`, `packages/channel-meta/src/records.ts:1`

## Connected to

- **owned-by:** [[ads/ad-launch]] (state joins on `campaign_id`)
- **joins:** [[platform/records]] (`marketing.ad_day`)

## If you change this

- **Hits:** `watch.ts` (the step), the view (migration), `records.ts`, the Marketing app's Ads page and spend tile
- **Does not hit:** `AdsWatch`'s verdicts, which read the insights, not this table

## Surfaces

| Surface | Role |
|---|---|
| `AdsWatch/default` | writes |
| Marketing app (`/marketing/ads`) | reads |

## See

- Source: `packages/channel-meta/src/days.ts`
