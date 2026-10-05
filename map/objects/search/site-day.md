---
type: object
cluster: search
universe: live
status: verified
verified: 2026-10-05 @ fa06f2a
entity: packages/channel-search/src/schema.ts:223
---

# site-day

The lander's visits for one day, channel and campaign, by the visitor's first touch. Table `site_days`; the Marketing app reads it as `marketing.site_day`.

## Why this shape

Counts only, never a visitor id, so nothing about a person is stored. The whole `/api/export` is rolled up per day and upserted, so a re-read overwrites the day, never adds (`packages/channel-search/src/site-days.ts:28`, `:79`). One step in `SearchWatch`'s daily pass, never failing it (`packages/channel-search/src/restate/watch.ts:95`). `bookings` are booking-link clicks, not booked calls.

## Shape

- key (`day`, `channel`, `campaign`); `visits`, `first_touches`, `forms`, `bookings`, `watch_plays` (`packages/channel-search/src/schema.ts:223`); channels `SITE_CHANNELS` (`:206`), from `touchChannel` in core
- view `marketing_site_day_records` (`packages/channel-search/src/schema.ts:339`)

Citations: `packages/channel-search/src/site-days.ts:28`

## Connected to

- **joins:** lander `functions/api/export.ts` (outside the tree), [[platform/records]] (`marketing.site_day`)
- **looks-like-but-is-not:** [[email/call-booking]] (a booked call, email-attributed)

## If you change this

- **Hits:** `rollupSite`, the view (migration), `records.ts`, the Marketing app's Site page, tiles and weekly chart
- **Does not hit:** `wren email clicks`, which reads the export itself

## Surfaces

| Surface | Role |
|---|---|
| `SearchWatch` daily pass | writes |
| Marketing app (`/marketing/site`, Overview) | reads |

## See

- Source: `packages/channel-search/src/site-days.ts`
