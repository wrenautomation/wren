---
type: object
cluster: search
universe: live
status: verified
verified: 2026-10-05 @ fa06f2a
entity: packages/channel-search/src/schema.ts:223
---

# site-day

The lander's visits for one day, channel and campaign, by the visitor's first touch. Table `site_days`; the Marketing app reads it as `marketing.site_day` and, summed per window, `marketing.funnel`.

## Why this shape

Counts only, never a visitor id, so nothing about a person is stored. The whole `/api/export` is rolled up per day and upserted, so a re-read overwrites the day, never adds (`packages/channel-search/src/site-days.ts:43`, `:116`). One step in `SearchWatch`'s daily pass, never failing it (`packages/channel-search/src/restate/watch.ts:95`). `bookings` are booking-link clicks. `calls` are real cal.com bookings: email when the link carried a code, else the first touch of the application with that email, else `other`. `paid` counts an engagement on its first paid invoice's day under its own `source_channel` (`callsAndPaid`, `:140`).

## Shape

- key (`day`, `channel`, `campaign`); `visits`, `first_touches`, `forms`, `bookings`, `watch_plays`, `calls`, `paid` (`packages/channel-search/src/schema.ts:223`); channels `SITE_CHANNELS` (`:206`), from `touchChannel` in core
- views `marketing_site_day_records` (`packages/channel-search/src/schema.ts:343`) and `marketing_funnel_records` (`:368`, 30d/90d/all per channel)
- `marketing.session` (`packages/channel-search/src/records.ts:224`) is not stored: it reads the lander's `replays` export live and signs each S3 chunk on open

Citations: `packages/channel-search/src/site-days.ts:43`

## Connected to

- **joins:** lander `functions/api/export.ts` (outside the tree), [[platform/records]] (`marketing.site_day`, `marketing.funnel`), [[email/call-booking]] (`calls`)
- **looks-like-but-is-not:** [[email/call-booking]] (one booking with its person; here only a count)

## If you change this

- **Hits:** `rollupSite`, both views (migration), `records.ts`, the Marketing app's Site and Funnel pages, tiles and weekly chart
- **Does not hit:** `wren email clicks`, which reads the export itself

## Surfaces

| Surface | Role |
|---|---|
| `SearchWatch` daily pass | writes |
| Marketing app (`/marketing/site`, `/marketing/funnel`, Overview) | reads |
| Marketing app (`/marketing/sessions`) | reads the lander live, plays replays |

## See

- Source: `packages/channel-search/src/site-days.ts`
