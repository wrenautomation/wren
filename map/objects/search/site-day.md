---
type: object
cluster: search
universe: live
status: verified
verified: 2026-10-05 @ fa06f2a
entity: packages/starling/search/src/schema.ts:223
---

# site-day

The lander's visits for one day, channel and campaign, by the visitor's first touch. Table `site_days`; the Marketing app reads it as `marketing.site_day` and, summed per window, `marketing.funnel`.

## Why this shape

Counts only, never a visitor id, so nothing about a person is stored. The whole `/api/export` is rolled up per day and upserted, so a re-read overwrites the day, never adds (`packages/starling/search/src/site-days.ts:43`, `:116`). The main step of `SiteRollup`'s daily pass (`packages/starling/search/src/restate/rollup.ts`), stopped since the 11-04 split. `bookings` are booking-link clicks. `calls` are real cal.com bookings: email when the link carried a code, else the first touch of the application with that email, else `other`. `paid` counts an engagement on its first paid invoice's day under its own `source_channel` (`callsAndPaid`, `:140`).

## Shape

- key (`day`, `channel`, `campaign`); `visits`, `first_touches`, `forms`, `bookings`, `watch_plays`, `calls`, `paid` (`packages/starling/search/src/schema.ts:223`); channels `SITE_CHANNELS` (`:206`), from `touchChannel` in core
- views `marketing_site_day_records` (`packages/starling/search/src/schema.ts:343`) and `marketing_funnel_records` (`:368`, 30d/90d/all per channel)
- `marketing.session` (`packages/starling/search/src/records.ts:224`) is not stored: it reads the lander's `replays` export live and signs each S3 chunk on open

Citations: `packages/starling/search/src/site-days.ts:43`

## Connected to

- **joins:** lander `functions/api/export.ts` (outside the tree), [[platform/records]] (`marketing.site_day`, `marketing.funnel`), [[email/call-booking]] (`calls`)
- **looks-like-but-is-not:** [[email/call-booking]] (one booking with its person; here only a count)

## If you change this

- **Hits:** `rollupSite`, both views (migration), `records.ts`, the client report tiles
- **Does not hit:** `EmailClickPull` and `wren email clicks` ([[email/email-click]]), which read the export's `hits` themselves

## Surfaces

| Surface | Role |
|---|---|
| `SiteRollup` daily pass (stopped) | writes |
| No page since 11-04: the records stay for the experiments phase | reads |

## See

- Source: `packages/starling/search/src/site-days.ts`
