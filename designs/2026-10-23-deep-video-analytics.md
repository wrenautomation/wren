# Deep video analytics

Living doc. Started 2026-10-23. William's ask: deep Instagram, TikTok and YouTube numbers in wren. That means hook quality, skip rate, retention curves, engagement and audience demographics. The aim is better A/B tests. The API comes first. The browser reads a platform's own page when no API gives the number, or when we have no access yet.

## Target (cost zero)

Each video post's page shows, for every platform:

- **Hook**: the share of viewers who did not swipe away. Compare it per variant.
- **Retention curve**: the share still watching across the video (0 to 1), on one scale for all platforms.
- **Skip rate**, **average watch**, **full watches**, and **traffic sources**.
- **Audience**: age, gender, country, and followers vs others, as a percent of views.
- **Variants**: each title, thumbnail or hook window, with its hook and retention beside its views.
- **Posts list**: a Hook column, so posts sort and compare by hook.

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
- Instagram demographics: the account has 12 followers. Meta answers nothing under 100. The `follower_demographics` call is honored (a bad breakdown gets a 400), so the answer is empty, not refused.
- YouTube Studio reader: proved on a live Short (`viewedPct` 29.13, so skip rate 70.87).
- TikTok Studio reader: proved at 0 views. Keys seen: the overview, sources ("For You", "Follow", "Search"), age ("18-24" to "55+") and gender ("male_vv", "female_vv", "other_vv"). Retention, location and the follower shares answered none. Their shape is a guess until a video has 100 views. The code takes a 0..1 share or a percent.

The other platforms (2026-10-23, William: "every platform that we work with"):

| Number | LinkedIn | X | Facebook | Threads | Reddit |
|---|---|---|---|---|---|
| Retention curve | none | from playback quartiles (API) | Reel `post_video_retention_graph` (API) | none | none |
| Finish rate | none | 100% quartile over starts (API) | none | none | none |
| Hold at 3 s and 30 s | none | none | from the Reel curve | none | none |
| Video views, watch time, average watch | analytics page, video block (browser) | `view_count` (API) | Reel `video_insights` (API) | none | none |
| Reach | analytics page "members reached" (browser) | none | `post_total_media_view_unique` (API) | none | none |
| Link clicks | none | `non_public_metrics` (API) | none | post `clicks` (API) | none |
| Audience | analytics page said "not available yet" | none | none | `follower_demographics`, at 100 followers (API) | none |
| Account by day | dashboard (browser) | followers | Page views, reach, follows (API) | profile views, likes, replies, clicks, followers (API) | followers |

Checked live on 2026-10-23:

- LinkedIn posts had no look: `socialActions` answers 501 (no leg without r_organization_social), and that failure skipped the analytics page read. Now a 501 still runs the analytics page, and the look is built from its numbers (`lookOf`). The post's tier timing then applies, so the page read does not repeat every hour against the 10 a day cap.
- LinkedIn analytics page: proved on a live post (72 impressions, 16 reached). The video block reads "Video views", "Watch time" and "Average watch time".
- LinkedIn post page counts: a browser read found no counts bar in 2 live tries. Reverted (autobrowse 0742623).
- LinkedIn post page counts, second build (autobrowse 0186572, 29433eb): `linkedin/post-stats` listens to the page's own calls, then reads the HTML, then the bar. Live on a ugcPost: 0 reactions, 1 comment, 0 reposts, which matches the stored comment. A share post's page holds no counts for its own ids in 2 tries, so it answers 502. The loop then takes the look from the analytics page, the same as for a 501. The comments read fills the counts cache, so a counts read after it in the hour spends nothing.
- Facebook: every number on the Page is 0 so far. The retention graph's keys are unproven: the code takes the last key as the end.
- Threads: profile `views` come as a day series cut at Pacific midnight, so the read takes the last day. `clicks` come per link and are summed. Demographics answer 400 under 100 followers, so the read waits.
- Reddit: views go to the author only. No API. Parked with the platform.

## Decisions

1. `skip_rate` is the percent that swiped away. YouTube gives the percent that stayed (VTR), so we store 100 − VTR.
2. One curve key for all: `retention` keyed `"0.00"`–`"1.00"`, the share of the video. TikTok's seconds are divided by the video's length.
3. Hook = 100 − `skip_rate` when the platform gives a skip rate. Else hook = `hold_3s`, the curve at 3 seconds. `hold_3s` and `hold_30s` stay shares (0..1), like the curve they come from. The page shows them as percents.
4. New metrics, each keyed by bucket, value = percent of views: `viewer_age` (`18-24`), `viewer_gender` (`female`), `viewer_country` (ISO code), `viewer_follower` (`follower`, `other`), `viewer_return` (`new`, `returning`). Also `finish_rate`, the percent of views watched to the end.
5. Instagram demographics are the account's, not the post's. They go in `account_metric_days`, with the same names.
6. The browser readers listen to the page's own calls. They never replay them: both Studios run bot checks on their calls.
7. Browser reads share one schedule and one failure rule (`browserRead` in core). A post reads on days 1, 3, 7, 14 and 28 after it went up. A day over the box's cap (429) reads nothing. Any other failure is a gap, never a retry. A day with no read writes nothing, so the last numbers stand.
8. A/B tests keep today's model (`post_variants`, windows over time). A platform's own split test (Instagram Trial Reels, YouTube Test and compare) has no API. We read the winner only as a new window.
9. No per-window hook yet. The skip rate and the holds are lifetime numbers, read on browser days only. A window's own hook needs a day-by-day read, and no platform gives one. Compare hooks across posts instead (the Hook column).

## Build

1. Instagram `reels_skip_rate` (API). Catalog row goes live. Built.
2. YouTube demographics (API): age, gender, country, followers vs others. Built.
3. YouTube Shorts skip rate: autobrowse flow `google/youtube-studio-analytics`, route `GET /studio/videos/{id}/analytics` on the youtube site. Built.
4. TikTok Studio reader: autobrowse flow `tiktok/video-analytics`, route `GET /web/videos/{id}/analytics`. Built. Saves and profile visits stay on the Business API.
5. Instagram follower demographics (API), in `account_metric_days`. Built. Waiting until 100 followers.
6. LinkedIn video stats from the analytics page (autobrowse e015a46). The loop builds a look from the analytics page when the counts read has no leg. Built.
7. Facebook post reach, Reel watch numbers and curve, Page days (API). Built. Waiting on reach.
8. Threads post link clicks, profile days, demographics from 100 followers (API). Built.
9. X retention curve and finish rate from the playback quartiles (API). Built.
10. Post page: a Hook cell, a "Who watched" section (one bar chart per audience metric), and labels for the new metrics. Posts list: a Hook column (migration 0327). Built.

## Open

- Instagram's web dashboard (Meta Business Suite) may show the Reel curve and sources. Not checked. If it does, a browser reader can fill those rows.
- TikTok: all posts since 10-20 show 0 views in TikTok Studio. No penalty flag shows. William to look.
- The desk runs the autobrowse build from before the two Studio routes. Its deploy waits on another session's work in autobrowse `src/`. Until then each Studio read gets a 404, shown as "not built".
- LinkedIn post page counts (hourly reactions and comments between analytics days): map the page in explore when the desk frees `linkedin@wren`.
- The account page does not show the followers' make-up yet. Build it when Instagram has 100 followers.

## Decision log

- 2026-10-23: API first, browser where the API is missing or not yet approved. William.
- 2026-10-23: skip rate, retention graphs and audience demographics are in scope. William.
- 2026-10-23: deep numbers on every platform we post to: LinkedIn, X, Facebook, Threads; Reddit stays parked. William.
