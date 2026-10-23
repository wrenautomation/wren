# Deep video analytics

Living doc. Started 2026-10-23. William's ask: deep Instagram, TikTok and YouTube numbers in wren. That means hook quality, skip rate, retention curves, engagement and audience demographics. The aim is better A/B tests. The API comes first. The browser reads a platform's own page when no API gives the number, or when we have no access yet.

## Target (cost zero)

Each video post's page shows, for every platform:

- **Hook**: the share of viewers who did not swipe away. Compare it per variant.
- **Retention curve**: the share still watching across the video (0 to 1), on one scale for all platforms.
- **Skip rate**, **average watch**, **full watches**, and **traffic sources**.
- **Audience**: age, gender, country, and followers vs others, as a percent of views.
- **Variants**: each title, thumbnail or hook window, with its hook and retention beside its views.

## Where each number comes from

| Number | YouTube | Instagram | TikTok |
|---|---|---|---|
| Skip rate | Shorts: Studio page, "viewed vs swiped away" (browser) | Graph `reels_skip_rate` (API) | none; hook from the curve |
| Retention curve | Analytics API `elapsedVideoTimeRatio` | app only | Studio page (browser) |
| Hold at 3 s and 30 s | from the curve | none | from the curve |
| Average watch, watch time | Analytics API | Graph (Reels) | Studio page (browser) |
| Full watches | none | none | Studio page `finish_rate` (browser) |
| Traffic sources, search terms | Analytics API | app only | Studio page (browser) |
| Age, gender | Analytics API `ageGroup,gender` per video | account only, at 100 followers (API) | Studio page, Viewers tab (browser) |
| Country | Analytics API `country` per video | account only, at 100 followers (API) | Studio page, Viewers tab (browser) |
| Followers vs others | Analytics API `subscribedStatus` | none | Studio page, Viewers tab (browser) |

Checked live on 2026-10-23:

- YouTube Analytics API: all three demographic reports answer per video.
- Instagram `reels_skip_rate`: answers a percent (62.6 on one Reel).
- YouTube Studio: `yta_web/get_cards` holds `shortsFeedImpressionsVtr`.
- TikTok Studio: `/aweme/v2/data/insight/` holds every TikTok field above. TikTok shows a field only at 100 views. Our posts have 0 views now, so the TikTok reader is not proved on live numbers yet.
- Instagram demographics: the account has 12 followers. Meta answers nothing under 100.

## Decisions

1. `skip_rate` is the percent that swiped away. YouTube gives the percent that stayed (VTR), so we store 100 − VTR.
2. One curve key for all: `retention` keyed `"0.00"`–`"1.00"`, the share of the video. TikTok's seconds are divided by the video's length.
3. Hook = 100 − `skip_rate` when the platform gives a skip rate. Else hook = `hold_3s`, the curve at 3 seconds.
4. New metrics, each keyed by bucket, value = percent of views: `viewer_age` (`18-24`), `viewer_gender` (`female`), `viewer_country` (ISO code), `viewer_follower` (`follower`, `other`).
5. Instagram demographics are the account's, not the post's. They go in `account_metric_days`, with the same names.
6. The browser readers listen to the page's own calls. They never replay them: both Studios run bot checks on their calls.
7. Browser reads are metered as the LinkedIn post analytics read is: one per post per look, under a day cap.
8. A/B tests keep today's model (`post_variants`, windows over time). Each window gains the hook and retention read in it. A platform's own split test (Instagram Trial Reels, YouTube Test and compare) has no API. We read the winner only as a new window.

## Build

1. Instagram `reels_skip_rate` (API). Catalog row goes live.
2. YouTube demographics (API): age, gender, country, followers vs others.
3. YouTube Shorts skip rate: autobrowse flow `google/youtube-studio-analytics`, route `GET /studio/videos/{id}/analytics` on the youtube site.
4. TikTok Studio reader: autobrowse flow `tiktok/video-analytics`, route `GET /web/videos/{id}/analytics`.
5. Instagram account demographics (API). Not proved until 100 followers.
6. Post page: Hook, Audience, and per-variant hook.

## Open

- Instagram's web dashboard (Meta Business Suite) may show the Reel curve and sources. Not checked. If it does, a browser reader can fill those rows.
- TikTok: all posts since 10-20 show 0 views in TikTok Studio. No penalty flag shows. William to look.

## Decision log

- 2026-10-23: API first, browser where the API is missing or not yet approved. William.
- 2026-10-23: skip rate, retention graphs and audience demographics are in scope. William.
